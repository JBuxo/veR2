import { describe, expect, it } from "vitest";
import { type ObjectStore, StoreError } from "../../src/storage/types.js";

export interface ContractTarget {
  store: ObjectStore;
  /** Prefix every key with this so runs against a shared bucket don't collide. */
  prefix: string;
}

const enc = (s: string) => new TextEncoder().encode(s);
const text = (s: ReadableStream<Uint8Array>) => new Response(s).text();
const BOGUS = '"00000000000000000000000000000000"';

async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof StoreError ? e.kind : `unexpected ${String(e)}`;
  }
}

export function objectStoreContract(name: string, setup: () => ContractTarget) {
  describe(`ObjectStore contract: ${name}`, () => {
    it("put then head reports etag, size and headers", async () => {
      const { store, prefix } = setup();
      const k = `${prefix}contract/basic`;
      const { etag } = await store.put(k, enc("hello"), {
        headers: { contentType: "text/plain", cacheControl: "max-age=60", metadata: { owner: "ver2" } },
      });
      const info = await store.head(k);
      expect(info?.etag).toBe(etag);
      expect(info?.size).toBe(5);
      expect(info?.headers).toMatchObject({ contentType: "text/plain", cacheControl: "max-age=60", metadata: { owner: "ver2" } });
    });

    it("head and get of a missing key return null", async () => {
      const { store, prefix } = setup();
      expect(await store.head(`${prefix}contract/missing`)).toBeNull();
      expect(await store.get(`${prefix}contract/missing`)).toBeNull();
    });

    it("get returns the bytes and honors ifMatch", async () => {
      const { store, prefix } = setup();
      const k = `${prefix}contract/get`;
      const { etag } = await store.put(k, enc("body"));
      const res = await store.get(k, { ifMatch: etag });
      expect(await text(res!.body)).toBe("body");
      expect(await failure(store.get(k, { ifMatch: BOGUS }))).toBe("precondition-failed");
    });

    it("put ifNoneMatch '*' only creates", async () => {
      const { store, prefix } = setup();
      const k = `${prefix}contract/create`;
      expect(await failure(store.put(k, enc("first"), { ifNoneMatch: "*" }))).toBe("ok");
      expect(await failure(store.put(k, enc("second"), { ifNoneMatch: "*" }))).toBe("precondition-failed");
      expect(await text((await store.get(k))!.body)).toBe("first");
    });

    it("put ifMatch overwrites only the expected version", async () => {
      const { store, prefix } = setup();
      const k = `${prefix}contract/if-match`;
      const { etag } = await store.put(k, enc("v1"));
      expect(await failure(store.put(k, enc("v2"), { ifMatch: etag }))).toBe("ok");
      expect(await failure(store.put(k, enc("v3"), { ifMatch: etag }))).toBe("precondition-failed");
      expect(await failure(store.put(`${prefix}contract/if-match-missing`, enc("x"), { ifMatch: etag }))).toBe(
        "precondition-failed",
      );
      expect(await text((await store.get(k))!.body)).toBe("v2");
    });

    it("identical bytes produce identical etags", async () => {
      const { store, prefix } = setup();
      const a = await store.put(`${prefix}contract/same-a`, enc("same"));
      const b = await store.put(`${prefix}contract/same-b`, enc("same"));
      expect(a.etag).toBe(b.etag);
    });

    it("copy preserves bytes, headers and the single-part etag", async () => {
      const { store, prefix } = setup();
      const src = `${prefix}contract/copy-src`;
      const dst = `${prefix}contract/copy-dst`;
      const headers = { contentType: "image/png", contentDisposition: 'inline; filename="a.png"', metadata: { rev: "7" } };
      const { etag } = await store.put(src, enc("payload"), { headers });
      expect((await store.copy(src, dst)).etag).toBe(etag);
      expect((await store.head(dst))?.headers).toMatchObject(headers);
      expect(await text((await store.get(dst))!.body)).toBe("payload");
    });

    it("copy sourceIfMatch rejects a changed source", async () => {
      const { store, prefix } = setup();
      const src = `${prefix}contract/src-cond`;
      const dst = `${prefix}contract/src-cond-dst`;
      await store.put(src, enc("x"));
      expect(await failure(store.copy(src, dst, { sourceIfMatch: BOGUS }))).toBe("precondition-failed");
      expect(await store.head(dst)).toBeNull();
    });

    it("copy destIfNoneMatch '*' never overwrites", async () => {
      const { store, prefix } = setup();
      const src = `${prefix}contract/dnm-src`;
      const dst = `${prefix}contract/dnm-dst`;
      await store.put(src, enc("SOURCE"));
      await store.put(dst, enc("ORIGINAL"));
      expect(await failure(store.copy(src, dst, { destIfNoneMatch: "*" }))).toBe("precondition-failed");
      expect(await text((await store.get(dst))!.body)).toBe("ORIGINAL");
      expect(await failure(store.copy(src, `${prefix}contract/dnm-absent`, { destIfNoneMatch: "*" }))).toBe("ok");
    });

    it("copy destIfMatch guards the destination", async () => {
      const { store, prefix } = setup();
      const src = `${prefix}contract/dm-src`;
      const dst = `${prefix}contract/dm-dst`;
      await store.put(src, enc("SOURCE"));
      const { etag } = await store.put(dst, enc("ORIGINAL"));
      expect(await failure(store.copy(src, dst, { destIfMatch: BOGUS }))).toBe("precondition-failed");
      expect(await text((await store.get(dst))!.body)).toBe("ORIGINAL");
      expect(await failure(store.copy(src, dst, { destIfMatch: etag }))).toBe("ok");
      expect(await text((await store.get(dst))!.body)).toBe("SOURCE");
    });

    it("copy of a missing source is not-found", async () => {
      const { store, prefix } = setup();
      expect(await failure(store.copy(`${prefix}contract/nope`, `${prefix}contract/nope-dst`))).toBe("not-found");
    });

    it("delete removes the key and tolerates missing keys", async () => {
      const { store, prefix } = setup();
      const k = `${prefix}contract/delete`;
      await store.put(k, enc("x"));
      await store.delete(k);
      expect(await store.head(k)).toBeNull();
      await expect(store.delete(k)).resolves.toBeUndefined();
    });

    it("list pages through keys under a prefix", async () => {
      const { store, prefix } = setup();
      const base = `${prefix}contract/list/`;
      for (const n of ["a", "b", "c"]) await store.put(base + n, enc(n));
      const first = await store.list(base, { limit: 2 });
      expect(first.keys).toEqual([`${base}a`, `${base}b`]);
      expect(first.cursor).toBeDefined();
      const second = await store.list(base, { limit: 2, cursor: first.cursor });
      expect(second.keys).toEqual([`${base}c`]);
      expect(second.cursor).toBeUndefined();
    });
  });
}
