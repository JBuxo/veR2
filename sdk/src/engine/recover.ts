import type { Manifest, PendingOp, VersionRecord } from "../meta/types.js";
import type { ObjectInfo } from "../storage/types.js";
import type { EngineContext } from "./context.js";
import { isOwnVersionObject, sameContent } from "./evidence.js";
import { syncLive } from "./live.js";
import { commit } from "./manifest.js";

export type RecoveryOutcome = "none" | "in-progress" | "rolled-forward" | "rolled-back" | "stuck" | "accepted-live";

export interface RecoveryResult {
  key: string;
  outcome: RecoveryOutcome;
  opId?: string;
  reason?: string;
  /** rolled-forward: the record that was committed and the live ETag it was committed with. */
  committed?: { record: VersionRecord; liveEtag: string | null };
}

export interface RecoverOptions {
  /** Report what would happen without writing. */
  dryRun?: boolean;
  /** Resolve a stuck op by adopting whatever is live now as an external version. */
  acceptLive?: boolean;
  /** Settle even inside the lease. Only for the writer that owns the op (with `onlyOpId`). */
  ignoreLease?: boolean;
  /** Act only if the pending op has this id; otherwise report "none". */
  onlyOpId?: string;
}

interface Decision {
  outcome: "rolled-forward" | "rolled-back" | "stuck";
  next: Manifest;
  committed?: { record: VersionRecord; liveEtag: string | null };
  reason?: string;
  /** Uncommitted version object to delete after a roll-back. */
  orphan?: string;
}

/** Finish or undo an interrupted operation using only evidence from storage. `key` must be canonical. */
export async function recover(ctx: EngineContext, key: string, options: RecoverOptions = {}): Promise<RecoveryResult> {
  const snap = await ctx.meta.read(key);
  const op = snap?.manifest.pending;
  if (!snap || !op) return { key, outcome: "none" };
  if (options.onlyOpId !== undefined && op.opId !== options.onlyOpId) return { key, outcome: "none" };
  const { manifest, rev } = snap;
  const live = await ctx.store.head(key);

  if (op.stuck) {
    if (!options.acceptLive) return { key, outcome: "stuck", opId: op.opId, reason: op.stuck };
    if (!options.dryRun) {
      let versions = manifest.versions;
      // Keep the stuck put's bytes: they may have been live and someone may have read them.
      if (op.type === "put" && op.record.objectKey) {
        const obj = await ctx.store.head(op.record.objectKey);
        if (obj) versions = [...versions, { ...op.record, etag: obj.etag, unconfirmed: true }];
      }
      await commit(ctx, key, await syncLive(ctx, key, { ...manifest, versions, pending: null }, live), rev);
    }
    return { key, outcome: "accepted-live", opId: op.opId };
  }
  if (!options.ignoreLease && ctx.now().getTime() - Date.parse(op.startedAt) < ctx.leaseMs) {
    return { key, outcome: "in-progress", opId: op.opId };
  }

  const decision = await decide(ctx, manifest, op, live);
  if (!options.dryRun) {
    await commit(ctx, key, decision.next, rev);
    if (decision.orphan && isOwnVersionObject(ctx, key, decision.orphan)) {
      await ctx.store.delete(decision.orphan).catch(() => undefined);
    }
  }
  return { key, outcome: decision.outcome, opId: op.opId, reason: decision.reason, committed: decision.committed };
}

async function decide(ctx: EngineContext, manifest: Manifest, op: PendingOp, live: ObjectInfo | null): Promise<Decision> {
  const liveEtag = live?.etag ?? null;
  const cleared: Manifest = { ...manifest, pending: null };

  if (op.type === "delete") {
    if (live === null) {
      return {
        outcome: "rolled-forward",
        next: { ...cleared, versions: [...manifest.versions, op.record], current: null, liveEtag: null },
        committed: { record: op.record, liveEtag: null },
      };
    }
    if (liveEtag === op.expectedLiveEtag) return { outcome: "rolled-back", next: cleared };
  } else if (op.record.objectKey) {
    const objectKey = op.record.objectKey;
    const obj = await ctx.store.head(objectKey);
    // Same content (bytes and headers), not just same ETag: a headers-only put keeps the ETag.
    if (obj && live && sameContent(live, obj)) {
      const record = { ...op.record, etag: obj.etag };
      return {
        outcome: "rolled-forward",
        next: { ...cleared, versions: [...manifest.versions, record], current: record.versionId, liveEtag: live.etag },
        committed: { record, liveEtag: live.etag },
      };
    }
    if (liveEtag === op.expectedLiveEtag) {
      return { outcome: "rolled-back", next: cleared, orphan: op.type === "put" && obj ? objectKey : undefined };
    }
  }

  const reason = `live object is ${liveEtag ?? "absent"}, which is neither the state before the ${op.type} (${op.expectedLiveEtag ?? "absent"}) nor its result`;
  return { outcome: "stuck", reason, next: { ...manifest, pending: { ...op, stuck: reason } } };
}
