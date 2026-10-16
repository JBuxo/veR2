import { ConcurrencyConflictError } from "../errors.js";
import { sha256OfStream } from "../hash.js";
import type { Manifest, VersionRecord } from "../meta/types.js";
import { isPreconditionFailed, type ObjectInfo, StoreError } from "../storage/types.js";
import type { EngineContext } from "./context.js";
import { sameContent } from "./evidence.js";

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
  const etag = await preserve(ctx, key, live, objectKey);
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

/** Copy the live object to `objectKey`, guarded so we preserve exactly what we inspected. Returns the copy's ETag. */
async function preserve(ctx: EngineContext, key: string, live: ObjectInfo, objectKey: string): Promise<string> {
  try {
    return (await ctx.store.copy(key, objectKey, { sourceIfMatch: live.etag, destIfNoneMatch: "*" })).etag;
  } catch (e) {
    if (e instanceof StoreError && e.kind === "not-found") {
      throw new ConcurrencyConflictError(key, "the live object was deleted while it was being preserved");
    }
    if (!isPreconditionFailed(e)) throw e;
    // A retried copy can 412 because its first attempt already landed at our fresh key.
    const obj = await ctx.store.head(objectKey);
    if (obj && sameContent(obj, live)) return obj.etag;
    throw new ConcurrencyConflictError(key, "the live object changed while it was being preserved");
  }
}
