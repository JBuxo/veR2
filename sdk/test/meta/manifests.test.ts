import { describe, expect, it } from "vitest";
import { layout } from "../../src/layout.js";
import { ObjectStoreManifests } from "../../src/meta/object-store-manifests.js";
import { emptyManifest, MetaConflictError } from "../../src/meta/types.js";
import { MemoryObjectStore } from "../../src/storage/memory.js";
import type { ObjectStore } from "../../src/storage/types.js";

function setup() {
  const store = new MemoryObjectStore();
  return { store, meta: new ObjectStoreManifests(store, layout(".ver2")) };
}

describe("ObjectStoreManifests", () => {
  it("reads null for an unknown key", async () => {
    expect(await setup().meta.read("a")).toBeNull();
  });

  it("creates with expectedRev null and reads back", async () => {
    const { meta, store } = setup();
    const rev = await meta.write("docs/a.txt", emptyManifest("docs/a.txt"), null);
    expect(store.objects.has(".ver2/m/docs/a.txt")).toBe(true);
    expect(await meta.read("docs/a.txt")).toEqual({ manifest: emptyManifest("docs/a.txt"), rev });
  });

  it("refuses a second create", async () => {
    const { meta } = setup();
    await meta.write("a", emptyManifest("a"), null);
    await expect(meta.write("a", { ...emptyManifest("a"), current: "x" }, null)).rejects.toBeInstanceOf(MetaConflictError);
  });

  it("updates only from the current revision", async () => {
    const { meta } = setup();
    const rev1 = await meta.write("a", emptyManifest("a"), null);
    const rev2 = await meta.write("a", { ...emptyManifest("a"), current: "v1" }, rev1);
    await expect(meta.write("a", { ...emptyManifest("a"), current: "v2" }, rev1)).rejects.toBeInstanceOf(MetaConflictError);
    expect((await meta.read("a"))?.rev).toBe(rev2);
  });

  it("treats a retried write that already landed as success", async () => {
    const { meta } = setup();
    const rev1 = await meta.write("a", emptyManifest("a"), null);
    const next = { ...emptyManifest("a"), current: "v1" };
    const rev2 = await meta.write("a", next, rev1);
    expect(await meta.write("a", next, rev1)).toBe(rev2);
  });

  it("lists keys without the internal prefix", async () => {
    const { meta } = setup();
    for (const k of ["docs/a", "docs/b", "img/c"]) await meta.write(k, emptyManifest(k), null);
    expect((await meta.list()).keys).toEqual(["docs/a", "docs/b", "img/c"]);
    expect((await meta.list({ prefix: "docs/" })).keys).toEqual(["docs/a", "docs/b"]);
  });
});

describe("ObjectStoreManifests read validation", () => {
  const corrupt = async (raw: string, reason: RegExp) => {
    const { store, meta } = setup();
    store.putDirect(".ver2/m/a", raw);
    await expect(meta.read("a")).rejects.toMatchObject({ code: "MANIFEST_INVALID", details: { key: "a", reason: expect.stringMatching(reason) } });
  };
  const valid = { ...emptyManifest("a") };

  it("rejects invalid JSON", () => corrupt("{not json", /invalid JSON/));
  it("rejects a non-object", () => corrupt("[1]", /not a JSON object/));
  it("rejects a newer schema", () => corrupt(JSON.stringify({ ...valid, schema: 2 }), /unsupported schema 2 \(upgrade veR2\)/));
  it("rejects a missing schema", () => corrupt(JSON.stringify({ ...valid, schema: undefined }), /^unsupported schema$/));
  it("rejects a manifest for another key", () => corrupt(JSON.stringify({ ...valid, key: "b" }), /belongs to "b"/));
  it("rejects versions that is not an array", () => corrupt(JSON.stringify({ ...valid, versions: {} }), /versions/));
  it("rejects a bad pending", () => corrupt(JSON.stringify({ ...valid, pending: 5 }), /pending/));
  it("rejects a bad current", () => corrupt(JSON.stringify({ ...valid, current: 5 }), /current/));
  it("rejects a bad liveEtag", () => corrupt(JSON.stringify({ ...valid, liveEtag: 5 }), /liveEtag/));

  it("classifies a failing body stream as a network StoreError", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("socket hang up");
      },
    });
    const store = {
      get: async () => ({ info: { etag: "e" }, body }),
    } as unknown as ObjectStore;
    const meta = new ObjectStoreManifests(store, layout(".ver2"));
    await expect(meta.read("a")).rejects.toMatchObject({ name: "StoreError", kind: "network" });
    await expect(meta.read("a").catch((e: Error) => e.message)).resolves.toMatch(/^read manifest a: /);
  });
});
