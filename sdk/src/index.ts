export { createVer2, toPublicError, Ver2, type Ver2Options } from "./client.js";
export * from "./errors.js";
export { canonicalKey, type KeyPolicy, maxKeyBytes, validateNamespace } from "./keys.js";
export { type Layout, layout } from "./layout.js";
export { ObjectStoreManifests } from "./meta/object-store-manifests.js";
export {
  type Manifest,
  type ManifestSnapshot,
  MetaConflictError,
  type MetadataStore,
  type PendingOp,
  type VersionRecord,
} from "./meta/types.js";
export {
  type CopyOptions,
  type GetOptions,
  type ListResult,
  type ObjectHeaders,
  type ObjectInfo,
  type ObjectStore,
  type PutOptions as StorePutOptions,
  StoreError,
} from "./storage/types.js";
export type { DeleteResult } from "./engine/delete.js";
export type { PutOptions, PutResult } from "./engine/put.js";
export type { RecoverOptions, RecoveryOutcome, RecoveryResult } from "./engine/recover.js";
export type { DownloadResult } from "./engine/versions.js";

export const VERSION = "0.1.0";
