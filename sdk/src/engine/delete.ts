import { canonicalKey } from "../keys.js";
import type { PendingOp, VersionRecord } from "../meta/types.js";
import { claim, loadForWrite } from "./claim.js";
import type { EngineContext } from "./context.js";
import { syncLive } from "./live.js";
import { commit } from "./manifest.js";
import { assertLeaseHeld, confirmClaim, runClaimed } from "./run-claimed.js";

export interface DeleteResult {
  key: string;
  /** The delete marker, or null when there was nothing to delete. */
  versionId: string | null;
}

/**
 * Logical delete. The live bytes are already a version object (write-through), so
 * nothing is copied. R2 ignores conditions on DELETE: a direct write landing between
 * the HEAD and the DELETE is lost. This is a documented limitation.
 */
export async function remove(ctx: EngineContext, rawKey: string): Promise<DeleteResult> {
  const key = canonicalKey(rawKey, ctx.policy);
  const loaded = await loadForWrite(ctx, key);
  const live = await ctx.store.head(key);
  const manifest = await syncLive(ctx, key, loaded.manifest, live);

  if (live === null) {
    if (manifest === loaded.manifest) return { key, versionId: null };
    await commit(ctx, key, manifest, loaded.rev);
    return { key, versionId: manifest.versions[manifest.versions.length - 1]?.versionId ?? null };
  }

  const record: VersionRecord = { versionId: ctx.newId(), kind: "delete", source: "ver2", createdAt: ctx.now().toISOString() };
  const op: PendingOp = {
    opId: ctx.newId(),
    type: "delete",
    record,
    expectedLiveEtag: live.etag,
    startedAt: ctx.now().toISOString(),
  };
  const rev = await claim(ctx, key, manifest, loaded.rev, op);
  await runClaimed(
    ctx,
    key,
    { manifest, rev, op },
    async () => {
      // DELETE takes no conditions on R2, so fence it: our lease must be fresh and our claim must still hold.
      assertLeaseHeld(ctx, key, op);
      await confirmClaim(ctx, key, op.opId);
      assertLeaseHeld(ctx, key, op);
      await ctx.store.delete(key);
    },
    () => ({ ...manifest, versions: [...manifest.versions, record], current: null, liveEtag: null, pending: null }),
    () => undefined,
  );
  return { key, versionId: record.versionId };
}
