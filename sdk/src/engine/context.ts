import type { KeyPolicy } from "../keys.js";
import type { Layout } from "../layout.js";
import type { MetadataStore } from "../meta/types.js";
import type { ObjectStore } from "../storage/types.js";

export interface EngineContext {
  store: ObjectStore;
  meta: MetadataStore;
  paths: Layout;
  policy: KeyPolicy;
  /** A pending op older than this is presumed crashed and may be recovered. */
  leaseMs: number;
  now: () => Date;
  /**
   * Must return unique ASCII ids of at most 26 characters (a ULID): version keys embed the id,
   * and the key policy reserves exactly 26 bytes for it.
   */
  newId: () => string;
}
