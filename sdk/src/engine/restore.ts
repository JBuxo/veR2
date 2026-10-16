import { CorruptManifestError, VersionNotFoundError } from "../errors.js";
import { canonicalKey } from "../keys.js";
import type { PendingOp, VersionRecord } from "../meta/types.js";
import { claim, loadForWrite } from "./claim.js";
import type { EngineContext } from "./context.js";
import { isOwnVersionObject } from "./evidence.js";
import { syncLive } from "./live.js";
import { promote } from "./promote.js";
import type { PutResult } from "./put.js";
import { assertLeaseHeld, runClaimed } from "./run-claimed.js";

/** Promote an existing version object back to live, recorded as a new version. */
export async function restore(ctx: EngineContext, rawKey: string, versionId: string): Promise<PutResult> {
  const key = canonicalKey(rawKey, ctx.policy);
  const loaded = await loadForWrite(ctx, key);
  const source = loaded.manifest.versions.find((v) => v.versionId === versionId && v.kind === "put");
  const objectKey = source?.objectKey;
  const objectEtag = source?.etag;
  const sha256 = source?.sha256;
  const size = source?.size;
  if (!source || !objectKey || !objectEtag || sha256 === undefined || size === undefined) {
    throw new VersionNotFoundError(key, versionId);
  }
  // The manifest names the object we copy onto the live key: never let it point elsewhere.
  if (!isOwnVersionObject(ctx, key, objectKey)) {
    throw new CorruptManifestError(key, `version ${versionId} points outside this key's history`);
  }

  const live = await ctx.store.head(key);
  const manifest = await syncLive(ctx, key, loaded.manifest, live);
  // The restored record is confirmed by its own commit; don't inherit accept-live's flag.
  const { unconfirmed: _unconfirmed, ...copied } = source;
  const record: VersionRecord = {
    ...copied,
    versionId: ctx.newId(),
    source: "restore",
    restoredFrom: versionId,
    createdAt: ctx.now().toISOString(),
  };
  const op: PendingOp = {
    opId: ctx.newId(),
    type: "restore",
    record,
    expectedLiveEtag: live?.etag ?? null,
    startedAt: ctx.now().toISOString(),
  };
  const rev = await claim(ctx, key, manifest, loaded.rev, op);

  const liveEtag = await runClaimed(
    ctx,
    key,
    { manifest, rev, op },
    async () => {
      assertLeaseHeld(ctx, key, op);
      return promote(ctx, key, objectKey, objectEtag, op.expectedLiveEtag);
    },
    (etag) => ({ ...manifest, versions: [...manifest.versions, record], current: record.versionId, liveEtag: etag, pending: null }),
    (s) => s.liveEtag ?? objectEtag,
  );
  return { key, versionId: record.versionId, sha256, size, etag: liveEtag };
}
