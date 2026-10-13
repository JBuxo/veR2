import { ConcurrencyConflictError, OperationIncompleteError } from "../errors.js";
import type { Manifest, PendingOp, VersionRecord } from "../meta/types.js";
import { StoreError } from "../storage/types.js";
import type { EngineContext } from "./context.js";
import { isOwnVersionObject } from "./evidence.js";
import { commit } from "./manifest.js";
import { recover } from "./recover.js";

export interface Claim {
  /** Manifest as it was before `pending` was set (includes any adoptions). */
  manifest: Manifest;
  /** Revision of the claimed manifest (the one with `pending`). */
  rev: string;
  op: PendingOp;
}

/** What recovery committed when it settled our op forward. */
export interface SettledForward {
  record: VersionRecord;
  liveEtag: string | null;
}

const MAYBE_SETTLED = "the operation may already have been settled by recovery";

/**
 * True when storage answered the request with an error status, so it definitely did not apply.
 * Without a response (network error, timeout, anything that isn't a StoreError) the request may
 * still land later: R2 often completes aborted requests.
 */
const answered = (e: unknown): boolean => e instanceof StoreError && e.status !== undefined;

/**
 * Run the storage half of a claimed operation, then commit `committed(result)`.
 * ConcurrencyConflict → release the claim, clean up, rethrow. A storage error that came with
 * an HTTP status → settle our own op from evidence right away: rolled back → rethrow the
 * original error (the key is free and a retryable error stays retryable); otherwise
 * OperationIncomplete. No response → OperationIncomplete, leaving `pending` for recovery
 * once the lease expires (settling now could race the request still in flight).
 * When settling rolls forward, the op did complete: `settled` turns the committed state into
 * the normal result (without it, OperationIncomplete says the result was not returned).
 */
export async function runClaimed<T>(
  ctx: EngineContext,
  key: string,
  claim: Claim,
  work: () => Promise<T>,
  committed: (result: T) => Manifest,
  settled?: (s: SettledForward) => T,
): Promise<T> {
  let result: T;
  try {
    result = await work();
  } catch (e) {
    if (e instanceof ConcurrencyConflictError) {
      await abandon(ctx, key, claim);
      throw e;
    }
    if (!answered(e)) throw new OperationIncompleteError(key, claim.op.opId, e instanceof Error ? e.message : String(e), { cause: e });
    return settleOwn(ctx, key, claim.op, e, settled);
  }
  try {
    await commit(ctx, key, committed(result), claim.rev);
  } catch (e) {
    const reason = e instanceof ConcurrencyConflictError ? `the manifest changed before the commit; ${MAYBE_SETTLED}` : String(e);
    throw new OperationIncompleteError(key, claim.op.opId, reason, { cause: e });
  }
  return result;
}

/** Settle our own op after an answered storage failure: return the op's result or throw. */
async function settleOwn<T>(
  ctx: EngineContext,
  key: string,
  op: PendingOp,
  error: unknown,
  settled: ((s: SettledForward) => T) | undefined,
): Promise<T> {
  const message = error instanceof Error ? error.message : String(error);
  let result;
  try {
    result = await recover(ctx, key, { ignoreLease: true, onlyOpId: op.opId });
  } catch {
    throw new OperationIncompleteError(key, op.opId, message, { cause: error });
  }
  const outcome = result.outcome;
  if (outcome === "rolled-back") throw error;
  if (outcome === "rolled-forward") {
    if (settled && result.committed) return settled(result.committed);
    throw new OperationIncompleteError(
      key,
      op.opId,
      "the operation completed (verified from storage) but its result was not returned; check versions.list",
      { cause: error },
    );
  }
  const reason = outcome === "none" ? `${message}; ${MAYBE_SETTLED}` : message;
  throw new OperationIncompleteError(key, op.opId, reason, { cause: error });
}

async function abandon(ctx: EngineContext, key: string, claim: Claim): Promise<void> {
  try {
    await ctx.meta.write(key, { ...claim.manifest, pending: null }, claim.rev);
  } catch {
    return; // leave the claim; recovery will roll it back once the lease expires
  }
  // Only a put owns its version object; restores share theirs with an older version.
  const objectKey = claim.op.record.objectKey;
  if (claim.op.type === "put" && objectKey && isOwnVersionObject(ctx, key, objectKey)) {
    await ctx.store.delete(objectKey).catch(() => undefined);
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
