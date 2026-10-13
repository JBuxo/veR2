import { describe, expect, it } from "vitest";
import { sameContent } from "../../src/engine/evidence.js";
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

    it("copy preserves all content headers and metadata exactly (sameContent evidence)", async () => {
      const { store, prefix } = setup();
      const src = `${prefix}contract/same-src`;
      const dst = `${prefix}contract/same-dst`;
      const bare = `${prefix}contract/same-bare`;
      const headers = {
        contentType: "text/plain; charset=utf-8",
        contentDisposition: 'attachment; filename="report.txt"',
        cacheControl: "public, max-age=300",
        contentEncoding: "identity",
        contentLanguage: "en-US",
        metadata: { owner: "ver2", rev: "7" },
      };
      await store.put(src, enc("same content"), { headers });
      await store.copy(src, dst);
      const [a, b] = [await store.head(src), await store.head(dst)];
      expect(a?.headers).toMatchObject(headers);
      expect(sameContent(a!, b!)).toBe(true);
      // Same bytes without the headers is a different content.
      await store.put(bare, enc("same content"));
      expect(sameContent(a!, (await store.head(bare))!)).toBe(false);
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

    it("copy destIfMatch onto an absent destination fails and writes nothing", async () => {
      const { store, prefix } = setup();
      const src = `${prefix}contract/dm-absent-src`;
      const dst = `${prefix}contract/dm-absent-dst`;
      const { etag } = await store.put(src, enc("SOURCE"));
      expect(await failure(store.copy(src, dst, { destIfMatch: etag }))).toBe("precondition-failed");
      expect(await store.head(dst)).toBeNull();
    });

    it("get with ifMatch on a missing key returns null", async () => {
      const { store, prefix } = setup();
      expect(await store.get(`${prefix}contract/get-missing-cond`, { ifMatch: BOGUS })).toBeNull();
    });

    it("a metadata-only rewrite keeps the etag", async () => {
      const { store, prefix } = setup();
      const k = `${prefix}contract/meta-only`;
      const a = await store.put(k, enc("same bytes"), { headers: { contentType: "text/plain" } });
      const b = await store.put(k, enc("same bytes"), { headers: { contentType: "text/html", metadata: { x: "1" } } });
      expect(b.etag).toBe(a.etag);
      expect((await store.head(k))?.headers).toMatchObject({ contentType: "text/html", metadata: { x: "1" } });
    });

    it("a put without headers replaces earlier headers instead of merging", async () => {
      const { store, prefix } = setup();
      const k = `${prefix}contract/replace-headers`;
      await store.put(k, enc("one"), { headers: { cacheControl: "max-age=60", metadata: { owner: "ver2" } } });
      await store.put(k, enc("two"));
      const headers = (await store.head(k))?.headers;
      expect(headers?.cacheControl).toBeUndefined();
      expect(headers?.metadata ?? {}).toEqual({});
    });

    it("get returns headers in info", async () => {
      const { store, prefix } = setup();
      const k = `${prefix}contract/get-headers`;
      await store.put(k, enc("h"), { headers: { contentType: "text/plain", metadata: { a: "b" } } });
      const res = await store.get(k);
      expect(res?.info.headers).toMatchObject({ contentType: "text/plain", metadata: { a: "b" } });
      await res!.body.cancel();
    });

    it("list excludes siblings that merely share the string prefix", async () => {
      const { store, prefix } = setup();
      const base = `${prefix}contract/sib/`;
      await store.put(`${base}in`, enc("in"));
      await store.put(`${prefix}contract/sib2/out`, enc("out"));
      expect((await store.list(base)).keys).toEqual([`${base}in`]);
    });

    it("handles keys with special characters", async () => {
      const { store, prefix } = setup();
      const dir = `${prefix}contract/sp ace+plus%pct?q#h/${String.fromCodePoint(0xfc)}/${String.fromCodePoint(0x1f600)}/`;
      const a = `${dir}x`;
      const b = `${dir}y`;
      await store.put(a, enc("special"));
      await store.copy(a, b);
      expect((await store.head(b))?.size).toBe(7);
      const res = await store.get(b);
      expect(await text(res!.body)).toBe("special");
      expect((await store.list(dir)).keys).toEqual([a, b]);
      // a guarded copy onto an existing special-char key must fail and leave it untouched
      await expect(store.copy(a, b, { destIfNoneMatch: "*" })).rejects.toMatchObject({ kind: "precondition-failed" });
      expect(await text((await store.get(b))!.body)).toBe("special");
    });
  });
}
