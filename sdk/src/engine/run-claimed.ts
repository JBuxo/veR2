import { ConcurrencyConflictError, OperationIncompleteError } from "../errors.js";
import type { Manifest, PendingOp } from "../meta/types.js";
import type { EngineContext } from "./context.js";
import { commit } from "./manifest.js";

export interface Claim {
  /** Manifest as it was before `pending` was set (includes any adoptions). */
  manifest: Manifest;
  /** Revision of the claimed manifest (the one with `pending`). */
  rev: string;
  op: PendingOp;
}

/**
 * Run the storage half of a claimed operation, then commit `committed(result)`.
 * ConcurrencyConflict → release the claim, clean up, rethrow. Anything else →
 * OperationIncomplete, leaving `pending` for recovery to settle from evidence.
 */
export async function runClaimed<T>(
  ctx: EngineContext,
  key: string,
  claim: Claim,
  work: () => Promise<T>,
  committed: (result: T) => Manifest,
): Promise<T> {
  let result: T;
  try {
    result = await work();
  } catch (e) {
    if (e instanceof ConcurrencyConflictError) {
      await abandon(ctx, key, claim);
      throw e;
    }
    throw new OperationIncompleteError(key, claim.op.opId, e instanceof Error ? e.message : String(e), { cause: e });
  }
  try {
    await commit(ctx, key, committed(result), claim.rev);
  } catch (e) {
    const reason = e instanceof ConcurrencyConflictError ? "the manifest changed before the commit" : String(e);
    throw new OperationIncompleteError(key, claim.op.opId, reason, { cause: e });
  }
  return result;
}

async function abandon(ctx: EngineContext, key: string, claim: Claim): Promise<void> {
  try {
    await ctx.meta.write(key, { ...claim.manifest, pending: null }, claim.rev);
  } catch {
    return; // leave the claim; recovery will roll it back once the lease expires
  }
  // Only a put owns its version object; restores share theirs with an older version.
  if (claim.op.type === "put" && claim.op.record.objectKey) {
    await ctx.store.delete(claim.op.record.objectKey).catch(() => undefined);
  }
}

/**
 * Fence a live-key mutation: refuse once half the lease has passed, so a stalled writer
 * cannot change the live object after recovery may have started settling its op.
 * Call immediately before every mutation of the live key.
 */
export function assertLeaseHeld(ctx: EngineContext, key: string, op: PendingOp): void {
  if (ctx.now().getTime() - Date.parse(op.startedAt) > ctx.leaseMs / 2) {
    throw new ConcurrencyConflictError(key, "lease expired before the live object was changed");
  }
}

/** Re-read the manifest and require that `opId` still holds the key (for unguarded mutations such as DELETE). */
export async function confirmClaim(ctx: EngineContext, key: string, opId: string): Promise<void> {
  const snap = await ctx.meta.read(key);
  if (snap?.manifest.pending?.opId !== opId) {
    throw new ConcurrencyConflictError(key, `operation ${opId} no longer holds the key`);
  }
}
