import { describe, expect, it } from "vitest";
import { syncLive } from "../../src/engine/live.js";
import { ConcurrencyConflictError } from "../../src/errors.js";
import { emptyManifest } from "../../src/meta/types.js";
import { StoreError } from "../../src/storage/types.js";
import { crashOn, KEY, setup, text } from "../helpers.js";

describe("syncLive", () => {
  it("leaves a manifest alone when live matches", async () => {
    const t = setup();
    const etag = t.store.putDirect(KEY, "x");
    const manifest = { ...emptyManifest(KEY), liveEtag: etag, current: "v1" };
    expect(await syncLive(t.ctx, KEY, manifest, await t.store.head(KEY))).toBe(manifest);
  });

  it("leaves a manifest alone when nothing exists", async () => {
    const t = setup();
    const manifest = emptyManifest(KEY);
    expect(await syncLive(t.ctx, KEY, manifest, null)).toBe(manifest);
  });

  it("adopts a direct write as an external version", async () => {
    const t = setup();
    t.store.putDirect(KEY, "direct", { contentType: "text/plain" });
    const live = await t.store.head(KEY);
    const next = await syncLive(t.ctx, KEY, emptyManifest(KEY), live);
    const [record] = next.versions;
    expect(record).toMatchObject({ kind: "put", source: "external", size: 6, headers: { contentType: "text/plain" } });
    expect(next.current).toBe(record?.versionId);
    expect(next.liveEtag).toBe(live?.etag);
    expect(await text((await t.store.get(record!.objectKey!))!.body)).toBe("direct");
  });

  it("records a direct delete as an external delete marker", async () => {
    const t = setup();
    const next = await syncLive(t.ctx, KEY, { ...emptyManifest(KEY), current: "v1", liveEtag: '"gone"' }, null);
    expect(next.versions.at(-1)).toMatchObject({ kind: "delete", source: "external" });
    expect(next).toMatchObject({ current: null, liveEtag: null });
  });

  it("refuses to adopt an object that changes during the copy", async () => {
    const t = setup();
    t.store.putDirect(KEY, "first");
    const live = await t.store.head(KEY);
    t.store.fault = (op, _key, phase) => {
      if (op === "copy" && phase === "before") {
        t.store.fault = undefined;
        t.store.putDirect(KEY, "second");
      }
    };
    await expect(syncLive(t.ctx, KEY, emptyManifest(KEY), live)).rejects.toBeInstanceOf(ConcurrencyConflictError);
  });

  it("treats a live object deleted during the adoption copy as a conflict", async () => {
    const t = setup();
    t.store.putDirect(KEY, "first");
    const live = await t.store.head(KEY);
    t.store.fault = (op, _key, phase) => {
      if (op === "copy" && phase === "before") {
        t.store.fault = undefined;
        t.store.objects.delete(KEY);
      }
    };
    await expect(syncLive(t.ctx, KEY, emptyManifest(KEY), live)).rejects.toBeInstanceOf(ConcurrencyConflictError);
  });

  it("treats a 412 on an adoption copy that already landed as success", async () => {
    const t = setup();
    t.store.putDirect(KEY, "direct", { contentType: "text/plain", metadata: { a: "1" } });
    const live = await t.store.head(KEY);
    crashOn(t.store, (op, _key, phase) => op === "copy" && phase === "after", 1, new StoreError("precondition-failed", "retry saw 412", 412));
    const next = await syncLive(t.ctx, KEY, emptyManifest(KEY), live);
    const [record] = next.versions;
    expect(record).toMatchObject({ kind: "put", source: "external", size: 6, etag: live?.etag });
    expect(next).toMatchObject({ current: record?.versionId, liveEtag: live?.etag });
  });

  it("refuses an adoption copy whose 412 came from a different object at the version key", async () => {
    const t = setup();
    t.store.putDirect(KEY, "direct");
    const live = await t.store.head(KEY);
    t.store.fault = (op, key, phase) => {
      if (op === "copy" && phase === "before") {
        t.store.fault = undefined;
        t.store.putDirect(key, "not the live bytes");
      }
    };
    await expect(syncLive(t.ctx, KEY, emptyManifest(KEY), live)).rejects.toBeInstanceOf(ConcurrencyConflictError);
  });
});
