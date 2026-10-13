import type { EngineContext } from "../src/engine/context.js";
import { layout } from "../src/layout.js";
import { ObjectStoreManifests } from "../src/meta/object-store-manifests.js";
import type { Manifest } from "../src/meta/types.js";
import { type FaultHook, MemoryObjectStore, type StoreOp } from "../src/storage/memory.js";

export const KEY = "doc.txt";
export const MANIFEST_KEY = `.ver2/m/${KEY}`;

export const enc = (s: string) => new TextEncoder().encode(s);

/** Read a stream to a string, propagating the stream's own error unchanged (Response may wrap it). */
export async function text(s: ReadableStream<Uint8Array>): Promise<string> {
  const reader = s.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out + decoder.decode();
    out += decoder.decode(value, { stream: true });
  }
}

/** Deterministic engine context over a fresh in-memory bucket. */
export function setup(options: { fault?: FaultHook } = {}) {
  const store = new MemoryObjectStore(options);
  const paths = layout(".ver2");
  let t = Date.parse("2026-01-01T00:00:00.000Z");
  let n = 0;
  const ctx: EngineContext = {
    store,
    meta: new ObjectStoreManifests(store, paths),
    paths,
    policy: { namespace: ".ver2" },
    leaseMs: 60_000,
    now: () => new Date(t),
    newId: () => `id${String(++n).padStart(4, "0")}`,
  };
  return {
    ctx,
    store,
    advance: (ms: number) => {
      t += ms;
    },
    live: (key = KEY) => {
      const e = store.objects.get(key);
      return e ? new TextDecoder().decode(e.bytes) : null;
    },
    manifest: async (key = KEY): Promise<Manifest | undefined> => (await ctx.meta.read(key))?.manifest,
    versionObjects: () => [...store.objects.keys()].filter((k) => k.startsWith(".ver2/o/")),
  };
}

/** Throw once, on the nth matching store call. */
export function crashOn(
  store: MemoryObjectStore,
  match: (op: StoreOp, key: string, phase: "before" | "after") => boolean,
  nth = 1,
  error: Error = new Error("simulated crash"),
) {
  let seen = 0;
  store.fault = (op, key, phase) => {
    if (match(op, key, phase) && ++seen === nth) {
      store.fault = undefined;
      throw error;
    }
  };
}

/**
 * Simulate the process dying at the nth matching store call: that call and every later one
 * fail, so nothing (not even in-process cleanup) reaches storage. Returns `revive`.
 */
export function dieOn(
  store: MemoryObjectStore,
  match: (op: StoreOp, key: string, phase: "before" | "after") => boolean,
  nth = 1,
): () => void {
  let seen = 0;
  let dead = false;
  store.fault = (op, key, phase) => {
    if (dead || (match(op, key, phase) && ++seen === nth)) {
      dead = true;
      throw new Error("simulated crash");
    }
  };
  return () => {
    store.fault = undefined;
  };
}
