import { ConcurrencyConflictError } from "../errors.js";
import { type Manifest, MetaConflictError } from "../meta/types.js";
import type { EngineContext } from "./context.js";

/** CAS-write a manifest, translating a lost race into ConcurrencyConflictError. */
export async function commit(ctx: EngineContext, key: string, manifest: Manifest, rev: string | null): Promise<string> {
  try {
    return await ctx.meta.write(key, manifest, rev);
  } catch (e) {
    if (e instanceof MetaConflictError) throw new ConcurrencyConflictError(key, "the manifest changed concurrently");
    throw e;
  }
}
