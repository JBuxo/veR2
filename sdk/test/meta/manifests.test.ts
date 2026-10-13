import { describe, expect, it } from "vitest";
import { layout } from "../../src/layout.js";
import { ObjectStoreManifests } from "../../src/meta/object-store-manifests.js";
import { emptyManifest, MetaConflictError } from "../../src/meta/types.js";
import { MemoryObjectStore } from "../../src/storage/memory.js";

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
