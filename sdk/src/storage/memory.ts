import { sha256Hex, toBytes } from "../hash.js";
import {
  type CopyOptions,
  type GetOptions,
  type ListResult,
  type ObjectHeaders,
  type ObjectInfo,
  type ObjectStore,
  type PutOptions,
  StoreError,
} from "./types.js";

export type StoreOp = "head" | "get" | "put" | "copy" | "delete" | "list";

/**
 * Called around every operation. Throw in "before" to fail the request; throw
 * in "after" to simulate a request that succeeded but whose response was lost.
 * `copy` reports the destination key; `list` reports the prefix.
 */
export type FaultHook = (op: StoreOp, key: string, phase: "before" | "after") => void;

interface Entry {
  bytes: Uint8Array;
  etag: string;
  headers: ObjectHeaders;
  lastModified: Date;
}

const etagOf = (bytes: Uint8Array) => `"${sha256Hex(bytes).slice(0, 32)}"`;
const precondition = (key: string) => new StoreError("precondition-failed", `precondition failed for ${key}`, 412);

function info(key: string, e: Entry): ObjectInfo {
  return { key, etag: e.etag, size: e.bytes.byteLength, lastModified: new Date(e.lastModified), headers: structuredClone(e.headers) };
}

/**
 * In-memory ObjectStore with R2's verified semantics plus fault injection. For tests and local experiments.
 *
 * Known gaps: list order is JS UTF-16 code-unit order, while R2 uses UTF-8 byte order (they differ only for
 * supplementary characters vs U+E000-U+FFFF). NFC/NFD key equivalence is not modeled because `canonicalKey`
 * normalizes keys before any I/O.
 */
export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, Entry>();
  fault: FaultHook | undefined;

  constructor(options: { fault?: FaultHook } = {}) {
    this.fault = options.fault;
  }

  /** Write straight into the bucket, bypassing faults and conditions: simulates a non-veR2 client. */
  putDirect(key: string, data: Uint8Array | string, headers: ObjectHeaders = {}): string {
    const bytes = toBytes(data).slice();
    const etag = etagOf(bytes);
    this.objects.set(key, { bytes, etag, headers: structuredClone(headers), lastModified: new Date() });
    return etag;
  }

  // The hook stays synchronous so conditional operations remain atomic; an async hook would silently not be awaited.
  private callFault(op: StoreOp, key: string, phase: "before" | "after"): void {
    const r: unknown = this.fault?.(op, key, phase);
    if (r !== null && typeof r === "object" && typeof (r as { then?: unknown }).then === "function") {
      throw new Error("FaultHook must be synchronous");
    }
  }

  private async run<T>(op: StoreOp, key: string, fn: () => T): Promise<T> {
    this.callFault(op, key, "before");
    const result = fn();
    this.callFault(op, key, "after");
    return result;
  }

  head(key: string): Promise<ObjectInfo | null> {
    return this.run("head", key, () => {
      const e = this.objects.get(key);
      return e ? info(key, e) : null;
    });
  }

  get(key: string, options: GetOptions = {}): Promise<{ info: ObjectInfo; body: ReadableStream<Uint8Array> } | null> {
    return this.run("get", key, () => {
      const e = this.objects.get(key);
      if (!e) return null;
      if (options.ifMatch !== undefined && options.ifMatch !== e.etag) throw precondition(key);
      const bytes = e.bytes.slice();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(bytes);
          c.close();
        },
      });
      return { info: info(key, e), body };
    });
  }

  put(key: string, body: Uint8Array, options: PutOptions = {}): Promise<{ etag: string }> {
    return this.run("put", key, () => {
      const existing = this.objects.get(key);
      if (options.ifNoneMatch === "*" && existing) throw precondition(key);
      if (options.ifMatch !== undefined && existing?.etag !== options.ifMatch) throw precondition(key);
      const bytes = body.slice();
      const entry: Entry = { bytes, etag: etagOf(bytes), headers: structuredClone(options.headers ?? {}), lastModified: new Date() };
      this.objects.set(key, entry);
      return { etag: entry.etag };
    });
  }

  copy(sourceKey: string, destKey: string, options: CopyOptions = {}): Promise<{ etag: string }> {
    return this.run("copy", destKey, () => {
      const src = this.objects.get(sourceKey);
      if (!src) throw new StoreError("not-found", `no such key ${sourceKey}`, 404);
      if (options.sourceIfMatch !== undefined && options.sourceIfMatch !== src.etag) throw precondition(sourceKey);
      const dst = this.objects.get(destKey);
      if (options.destIfNoneMatch === "*" && dst) throw precondition(destKey);
      if (options.destIfMatch !== undefined && dst?.etag !== options.destIfMatch) throw precondition(destKey);
      this.objects.set(destKey, {
        bytes: src.bytes.slice(),
        etag: src.etag,
        headers: structuredClone(src.headers),
        lastModified: new Date(),
      });
      return { etag: src.etag };
    });
  }

  delete(key: string): Promise<void> {
    return this.run("delete", key, () => {
      this.objects.delete(key);
    });
  }

  list(prefix: string, options: { cursor?: string; limit?: number } = {}): Promise<ListResult> {
    return this.run("list", prefix, () => {
      const after = options.cursor;
      const limit = Math.min(1000, Math.max(1, Math.trunc(options.limit ?? 1000))); // R2 caps pages at 1000
      const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix) && (after === undefined || k > after)).sort();
      const page = keys.slice(0, limit);
      return { keys: page, cursor: keys.length > limit ? page[page.length - 1] : undefined };
    });
  }
}
