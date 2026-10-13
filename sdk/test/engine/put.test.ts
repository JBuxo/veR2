import { describe, expect, it } from "vitest";
import { put } from "../../src/engine/put.js";
import { ConcurrencyConflictError, InvalidKeyError, OperationIncompleteError } from "../../src/errors.js";
import { StoreError } from "../../src/storage/types.js";
import { crashOn, KEY, MANIFEST_KEY, setup, text } from "../helpers.js";

describe("put", () => {
  it("creates the live object, an immutable version and a manifest", async () => {
    const t = setup();
    const r = await put(t.ctx, KEY, "one", { headers: { contentType: "text/plain" } });
    expect(r).toMatchObject({ key: KEY, size: 3 });
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(t.live()).toBe("one");
    expect((await t.store.head(KEY))?.headers.contentType).toBe("text/plain");
    const m = await t.manifest();
    expect(m).toMatchObject({ current: r.versionId, liveEtag: r.etag, pending: null });
    expect(m?.versions).toHaveLength(1);
    expect(await text((await t.store.get(m!.versions[0]!.objectKey!))!.body)).toBe("one");
  });

  it("keeps every version's bytes", async () => {
    const t = setup();
    const v1 = await put(t.ctx, KEY, "one");
    await put(t.ctx, KEY, "two");
    const m = await t.manifest();
    expect(m?.versions.map((v) => v.versionId)[0]).toBe(v1.versionId);
    expect(t.live()).toBe("two");
    expect(await text((await t.store.get(m!.versions[0]!.objectKey!))!.body)).toBe("one");
  });

  it("preserves a direct write before overwriting it", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    t.store.putDirect(KEY, "direct");
    await put(t.ctx, KEY, "three");
    const m = await t.manifest();
    expect(m?.versions.map((v) => v.source)).toEqual(["ver2", "external", "ver2"]);
    expect(await text((await t.store.get(m!.versions[1]!.objectKey!))!.body)).toBe("direct");
  });

  it("rejects invalid keys before touching storage", async () => {
    const t = setup();
    await expect(put(t.ctx, "a/../b", "x")).rejects.toBeInstanceOf(InvalidKeyError);
    expect(t.store.objects.size).toBe(0);
  });

  it("is busy while another operation holds the key", async () => {
    const t = setup();
    crashOn(t.store, (op, key, phase) => op === "put" && key === MANIFEST_KEY && phase === "before", 2);
    await expect(put(t.ctx, KEY, "one")).rejects.toBeInstanceOf(OperationIncompleteError);
    await expect(put(t.ctx, KEY, "two")).rejects.toBeInstanceOf(ConcurrencyConflictError);
  });

  it("refuses to clobber a direct write that races the promote", async () => {
    const t = setup();
    t.store.fault = (op, key, phase) => {
      if (op === "copy" && key === KEY && phase === "before") {
        t.store.fault = undefined;
        t.store.putDirect(KEY, "racer");
      }
    };
    await expect(put(t.ctx, KEY, "mine")).rejects.toBeInstanceOf(ConcurrencyConflictError);
    expect(t.live()).toBe("racer");
    expect((await t.manifest())?.pending).toBeNull();
    expect(t.versionObjects()).toEqual([]);
  });

  it("treats a 412 on a retried promote that already landed as success", async () => {
    const t = setup();
    crashOn(
      t.store,
      (op, key, phase) => op === "copy" && key === KEY && phase === "after",
      1,
      new StoreError("precondition-failed", "retry saw 412", 412),
    );
    const r = await put(t.ctx, KEY, "one");
    expect((await t.manifest())?.current).toBe(r.versionId);
  });

  it("leaves a recoverable journal entry when the commit fails", async () => {
    const t = setup();
    crashOn(t.store, (op, key, phase) => op === "put" && key === MANIFEST_KEY && phase === "before", 2);
    await expect(put(t.ctx, KEY, "one")).rejects.toBeInstanceOf(OperationIncompleteError);
    expect(t.live()).toBe("one");
    expect((await t.manifest())?.pending?.type).toBe("put");
  });
});
