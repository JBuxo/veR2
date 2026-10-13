import { ConcurrencyConflictError } from "../errors.js";
import { sha256OfStream } from "../hash.js";
import type { Manifest, VersionRecord } from "../meta/types.js";
import { isPreconditionFailed, type ObjectInfo, StoreError } from "../storage/types.js";
import type { EngineContext } from "./context.js";

/**
 * Reconcile the manifest with the object actually at `key` (`live`, from a HEAD).
 * Direct writes become `external` versions (bytes preserved first); direct deletes
 * become `external` delete markers. Returns the same manifest when nothing changed.
 */
export async function syncLive(ctx: EngineContext, key: string, manifest: Manifest, live: ObjectInfo | null): Promise<Manifest> {
  if (live === null) {
    if (manifest.liveEtag === null) return manifest;
    const marker: VersionRecord = {
      versionId: ctx.newId(),
      kind: "delete",
      source: "external",
      createdAt: ctx.now().toISOString(),
    };
    return { ...manifest, versions: [...manifest.versions, marker], current: null, liveEtag: null };
  }
  if (live.etag === manifest.liveEtag) return manifest;

  const versionId = ctx.newId();
  const objectKey = ctx.paths.versionKey(key, versionId);
  let etag: string;
  try {
    ({ etag } = await ctx.store.copy(key, objectKey, { sourceIfMatch: live.etag, destIfNoneMatch: "*" }));
  } catch (e) {
    if (isPreconditionFailed(e)) throw new ConcurrencyConflictError(key, "the live object changed while it was being preserved");
    throw e;
  }
  const preserved = await ctx.store.get(objectKey);
  if (!preserved) throw new StoreError("other", `preserved copy ${objectKey} disappeared`);
  const { sha256, size } = await sha256OfStream(preserved.body);
  const record: VersionRecord = {
    versionId,
    kind: "put",
    objectKey,
    sha256,
    size,
    etag,
    headers: live.headers,
    source: "external",
    createdAt: live.lastModified.toISOString(),
  };
  return { ...manifest, versions: [...manifest.versions, record], current: versionId, liveEtag: live.etag };
}
