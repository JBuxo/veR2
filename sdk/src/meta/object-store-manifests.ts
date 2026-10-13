import { toBytes } from "../hash.js";
import type { Layout } from "../layout.js";
import { isPreconditionFailed, type ObjectStore } from "../storage/types.js";
import { type Manifest, type ManifestSnapshot, MetaConflictError, type MetadataStore } from "./types.js";

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
    return { manifest: JSON.parse(await new Response(res.body).text()) as Manifest, rev: res.info.etag };
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
