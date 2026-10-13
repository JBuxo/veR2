import { ConcurrencyConflictError } from "../errors.js";
import { isPreconditionFailed } from "../storage/types.js";
import type { EngineContext } from "./context.js";

/**
 * Copy a version object onto the live key, but only if the live key is still in the
 * state we inspected (R2 cf-copy-destination-* guards). Returns the new live ETag.
 */
export async function promote(
  ctx: EngineContext,
  key: string,
  objectKey: string,
  objectEtag: string,
  expectedLiveEtag: string | null,
): Promise<string> {
  const guard = expectedLiveEtag === null ? { destIfNoneMatch: "*" as const } : { destIfMatch: expectedLiveEtag };
  try {
    return (await ctx.store.copy(objectKey, key, { sourceIfMatch: objectEtag, ...guard })).etag;
  } catch (e) {
    if (!isPreconditionFailed(e)) throw e;
    // A retried copy can 412 because its first attempt already landed.
    // Phase 1 versions are single-part, so a landed copy has the version's ETag.
    const live = await ctx.store.head(key);
    if (live && live.etag === objectEtag) return live.etag;
    throw new ConcurrencyConflictError(key, "the live object changed during the operation");
  }
}
