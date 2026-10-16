import { ConcurrencyConflictError, OperationIncompleteError } from "../errors.js";
import { emptyManifest, type Manifest, type PendingOp } from "../meta/types.js";
import type { EngineContext } from "./context.js";
import { commit } from "./manifest.js";
import { recover } from "./recover.js";

/**
 * Load the manifest for a write. A pending op that is stuck → OperationIncomplete;
 * still within its lease → ConcurrencyConflict; expired → recovered first.
 * Never returns a manifest that carries someone else's pending op.
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
    // Another writer can claim the key between recovery's commit and this read.
    const next = snap?.manifest.pending;
    if (next) throw new ConcurrencyConflictError(key, `operation ${next.opId} claimed the key during recovery`);
  }
  return { manifest: snap?.manifest ?? emptyManifest(key), rev: snap?.rev ?? null };
}

/**
 * Take the per-key lock: CAS-write `manifest` with `pending = op`. `manifest` must be unclaimed;
 * returns the claimed revision.
 */
export async function claim(ctx: EngineContext, key: string, manifest: Manifest, rev: string | null, op: PendingOp): Promise<string> {
  if (manifest.pending !== null) {
    throw new ConcurrencyConflictError(key, `operation ${manifest.pending.opId} already holds the key`);
  }
  return commit(ctx, key, { ...manifest, pending: op }, rev);
}
