import { toBytes } from "../hash.js";
import type { Layout } from "../layout.js";
import { CorruptManifestError } from "../errors.js";
import { isPreconditionFailed, type ObjectStore, StoreError } from "../storage/types.js";
import { type Manifest, type ManifestSnapshot, MetaConflictError, type MetadataStore } from "./types.js";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStringOrNull = (v: unknown) => v === null || typeof v === "string";

function validateManifest(key: string, m: unknown): Manifest {
  if (!isObject(m)) throw new CorruptManifestError(key, "not a JSON object");
  if (m.schema !== 1) {
    throw new CorruptManifestError(
      key,
      typeof m.schema === "number" && m.schema > 1 ? `unsupported schema ${m.schema} (upgrade veR2)` : "unsupported schema",
    );
  }
  if (m.key !== key) throw new CorruptManifestError(key, `manifest belongs to ${JSON.stringify(m.key)}`);
  if (!Array.isArray(m.versions)) throw new CorruptManifestError(key, "versions is not an array");
  if (m.pending !== null && !isObject(m.pending)) throw new CorruptManifestError(key, "pending is not null or an object");
  if (!isStringOrNull(m.current)) throw new CorruptManifestError(key, "current is not a string or null");
  if (!isStringOrNull(m.liveEtag)) throw new CorruptManifestError(key, "liveEtag is not a string or null");
  return m as unknown as Manifest;
}

/** Manifests stored as JSON objects in the bucket; the object ETag is the CAS revision. */
export class ObjectStoreManifests implements MetadataStore {
  private readonly store: ObjectStore;
  private readonly paths: Layout;

  constructor(store: ObjectStore, paths: Layout) {
    this.store = store;
    this.paths = paths;
  }

  async read(key: string): Promise<ManifestSnapshot | null> {
    const res = await this.store.get(this.paths.manifestKey(key));
    if (!res) return null;
    let text: string;
    try {
      text = await new Response(res.body).text();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new StoreError("network", `read manifest ${key}: ${message}`, undefined, { cause: e });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new CorruptManifestError(key, "invalid JSON");
    }
    return { manifest: validateManifest(key, parsed), rev: res.info.etag };
  }

  async write(key: string, manifest: Manifest, expectedRev: string | null): Promise<string> {
    const condition = expectedRev === null ? { ifNoneMatch: "*" as const } : { ifMatch: expectedRev };
    try {
      const { etag } = await this.store.put(this.paths.manifestKey(key), toBytes(JSON.stringify(manifest)), {
        headers: { contentType: "application/json" },
        ...condition,
      });
      return etag;
    } catch (e) {
      if (!isPreconditionFailed(e)) throw e;
      // A retried request can fail its precondition because its first attempt landed.
      const current = await this.read(key);
      if (current && JSON.stringify(current.manifest) === JSON.stringify(manifest)) return current.rev;
      throw new MetaConflictError(key);
    }
  }

  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}): Promise<{ keys: string[]; cursor?: string }> {
    const base = this.paths.manifestPrefix;
    const page = await this.store.list(base + (options.prefix ?? ""), { cursor: options.cursor, limit: options.limit });
    return { keys: page.keys.map((k) => k.slice(base.length)), cursor: page.cursor };
  }
}
