import type { ObjectHeaders } from "../storage/types.js";

export interface VersionRecord {
  versionId: string;
  kind: "put" | "delete";
  /** put: where the bytes live. Restores share the object of the version they restore. */
  objectKey?: string;
  sha256?: string;
  size?: number;
  /** ETag of `objectKey`. */
  etag?: string;
  headers?: ObjectHeaders;
  /** ver2: written through veR2 · external: adopted from a direct bucket write · restore: re-promoted. */
  source: "ver2" | "external" | "restore";
  restoredFrom?: string;
  createdAt: string;
}

/** The journal entry for an in-flight operation. Its presence locks the key. */
export interface PendingOp {
  opId: string;
  type: "put" | "delete" | "restore";
  /** The record to append on commit (`etag` may be filled in at commit time). */
  record: VersionRecord;
  /** ETag of the live object when the op started; null if absent. */
  expectedLiveEtag: string | null;
  startedAt: string;
  /** Set when recovery could not decide. Needs `reconcile --accept-live`. */
  stuck?: string;
}

export interface Manifest {
  schema: 1;
  key: string;
  current: string | null;
  liveEtag: string | null;
  versions: VersionRecord[];
  pending: PendingOp | null;
}

export interface ManifestSnapshot {
  manifest: Manifest;
  /** Opaque revision for compare-and-swap. */
  rev: string;
}

export class MetaConflictError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`manifest for ${JSON.stringify(key)} changed concurrently`);
    this.name = "MetaConflictError";
    this.key = key;
  }
}

/** Per-key manifest storage with compare-and-swap. */
export interface MetadataStore {
  read(key: string): Promise<ManifestSnapshot | null>;
  /** Write if the stored revision is `expectedRev` (null = must not exist). Returns the new revision. */
  write(key: string, manifest: Manifest, expectedRev: string | null): Promise<string>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ keys: string[]; cursor?: string }>;
}

export const emptyManifest = (key: string): Manifest => ({
  schema: 1,
  key,
  current: null,
  liveEtag: null,
  versions: [],
  pending: null,
});
