import { ConcurrencyConflictError, OperationIncompleteError } from "../errors.js";
import { emptyManifest, type Manifest } from "../meta/types.js";
import type { EngineContext } from "./context.js";
import { recover } from "./recover.js";

/**
 * Load the manifest for a write. A pending op that is stuck → OperationIncomplete;
 * still within its lease → ConcurrencyConflict; expired → recovered first.
 */
export async function loadForWrite(ctx: EngineContext, key: string): Promise<{ manifest: Manifest; rev: string | null }> {
  let snap = await ctx.meta.read(key);
  const op = snap?.manifest.pending;
  if (snap && op) {
    if (op.stuck) throw new OperationIncompleteError(key, op.opId, op.stuck);
    const result = await recover(ctx, key);
    if (result.outcome === "in-progress") throw new ConcurrencyConflictError(key, `operation ${op.opId} is in progress`);
    if (result.outcome === "stuck") throw new OperationIncompleteError(key, op.opId, result.reason ?? "recovery could not decide");
    snap = await ctx.meta.read(key);
  }
  return { manifest: snap?.manifest ?? emptyManifest(key), rev: snap?.rev ?? null };
}
