import { remove, type DeleteResult } from "./engine/delete.js";
import type { EngineContext } from "./engine/context.js";
import { put, type PutOptions, type PutResult } from "./engine/put.js";
import { recover, type RecoverOptions, type RecoveryResult } from "./engine/recover.js";
import { restore } from "./engine/restore.js";
import { download, type DownloadResult, listVersions } from "./engine/versions.js";
import { ConcurrencyConflictError, StorageError, Ver2Error } from "./errors.js";
import { ulid } from "./ids.js";
import { canonicalKey, validateNamespace } from "./keys.js";
import { layout } from "./layout.js";
import { ObjectStoreManifests } from "./meta/object-store-manifests.js";
import { MetaConflictError, type MetadataStore, type VersionRecord } from "./meta/types.js";
import { type ObjectStore, StoreError } from "./storage/types.js";

export interface Ver2Options {
  store: ObjectStore;
  /** Defaults to manifests stored in the bucket (Lite tier). */
  meta?: MetadataStore;
  /** Reserved key prefix for veR2's own objects. Default ".ver2". */
  namespace?: string;
  /** How long an in-flight operation holds a key before it is presumed crashed. Default 60 s. */
  leaseMs?: number;
  now?: () => Date;
  newId?: () => string;
}

/** Convert anything thrown below the facade into a public Ver2Error. */
export function toPublicError(e: unknown): Error {
  if (e instanceof Ver2Error) return e;
  if (e instanceof StoreError) {
    const retryable = e.kind === "rate-limited" || e.kind === "network" || (e.status ?? 0) >= 500;
    return new StorageError(e.message, { status: e.status, retryable }, { cause: e });
  }
  if (e instanceof MetaConflictError) return new ConcurrencyConflictError(e.key, "the manifest changed concurrently");
  return new StorageError(e instanceof Error ? e.message : String(e), { retryable: false }, { cause: e });
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toPublicError(e);
  }
}

export class Ver2 {
  readonly versions: {
    list(key: string): Promise<VersionRecord[]>;
    restore(key: string, versionId: string): Promise<PutResult>;
    download(key: string, versionId?: string): Promise<DownloadResult>;
  };
  private readonly ctx: EngineContext;

  constructor(options: Ver2Options) {
    const namespace = validateNamespace(options.namespace ?? ".ver2");
    const paths = layout(namespace);
    const ctx: EngineContext = {
      store: options.store,
      meta: options.meta ?? new ObjectStoreManifests(options.store, paths),
      paths,
      policy: { namespace },
      leaseMs: options.leaseMs ?? 60_000,
      now: options.now ?? (() => new Date()),
      newId: options.newId ?? (() => ulid()),
    };
    this.ctx = ctx;
    this.versions = {
      list: (key) => guard(() => listVersions(ctx, key)),
      restore: (key, versionId) => guard(() => restore(ctx, key, versionId)),
      download: (key, versionId) => guard(() => download(ctx, key, versionId)),
    };
  }

  put(key: string, data: Uint8Array | string, options?: PutOptions): Promise<PutResult> {
    return guard(() => put(this.ctx, key, data, options));
  }

  delete(key: string): Promise<DeleteResult> {
    return guard(() => remove(this.ctx, key));
  }

  /** Keys veR2 has a history for (including currently deleted ones). */
  list(prefix = "", options: { cursor?: string; limit?: number } = {}): Promise<{ keys: string[]; cursor?: string }> {
    return guard(() => this.ctx.meta.list({ prefix, ...options }));
  }

  recover(key: string, options?: RecoverOptions): Promise<RecoveryResult> {
    return guard(() => recover(this.ctx, canonicalKey(key, this.ctx.policy), options));
  }

  /** Recover every key with a pending operation; yields only keys that needed attention. */
  async *recoverAll(options?: RecoverOptions): AsyncGenerator<RecoveryResult> {
    let cursor: string | undefined;
    do {
      const page = await this.list("", { cursor });
      for (const key of page.keys) {
        const result = await this.recover(key, options);
        if (result.outcome !== "none") yield result;
      }
      cursor = page.cursor;
    } while (cursor);
  }
}

export const createVer2 = (options: Ver2Options): Ver2 => new Ver2(options);
