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

  it("refuses a racing direct write with the same bytes but different headers", async () => {
    const t = setup();
    t.store.fault = (op, key, phase) => {
      if (op === "copy" && key === KEY && phase === "before") {
        t.store.fault = undefined;
        t.store.putDirect(KEY, "mine", { contentType: "application/octet-stream" });
      }
    };
    await expect(put(t.ctx, KEY, "mine", { headers: { contentType: "text/plain" } })).rejects.toBeInstanceOf(ConcurrencyConflictError);
    expect((await t.store.head(KEY))?.headers.contentType).toBe("application/octet-stream");
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

  it("settles its own op on a failed promote and surfaces the original error", async () => {
    const t = setup();
    const throttled = new StoreError("rate-limited", "slow down", 429);
    crashOn(t.store, (op, key, phase) => op === "copy" && key === KEY && phase === "before", 1, throttled);
    await expect(put(t.ctx, KEY, "one")).rejects.toBe(throttled);
    expect((await t.manifest())?.pending).toBeNull();
    expect(t.versionObjects()).toEqual([]);
    expect(t.live()).toBeNull();
    await put(t.ctx, KEY, "two"); // the key is not locked
    expect(t.live()).toBe("two");
  });

  it("leaves its op pending when the promote fails without an HTTP response (it may still land)", async () => {
    for (const error of [new Error("socket hang up"), new StoreError("network", "ECONNRESET")]) {
      const t = setup();
      crashOn(t.store, (op, key, phase) => op === "copy" && key === KEY && phase === "before", 1, error);
      await expect(put(t.ctx, KEY, "one")).rejects.toBeInstanceOf(OperationIncompleteError);
      expect((await t.manifest())?.pending?.type).toBe("put");
      expect(t.versionObjects()).toHaveLength(1);
    }
  });

  it("succeeds when the promote landed but answered with an error (settled forward from evidence)", async () => {
    const t = setup();
    crashOn(t.store, (op, key, phase) => op === "copy" && key === KEY && phase === "after", 1, new StoreError("other", "internal error", 500));
    const r = await put(t.ctx, KEY, "one");
    expect(t.live()).toBe("one");
    const m = await t.manifest();
    expect(m).toMatchObject({ current: r.versionId, liveEtag: r.etag, pending: null });
    expect(m?.versions).toHaveLength(1);
    expect(r.etag).toBe((await t.store.head(KEY))?.etag);
  });

  it("says the op may already be settled when the commit loses its CAS", async () => {
    const t = setup();
    let puts = 0;
    t.store.fault = (op, key, phase) => {
      if (op === "put" && key === MANIFEST_KEY && phase === "before" && ++puts === 2) {
        t.store.fault = undefined;
        t.store.putDirect(MANIFEST_KEY, JSON.stringify({ schema: 1, key: KEY, current: null, liveEtag: null, versions: [], pending: null }));
      }
    };
    await expect(put(t.ctx, KEY, "one")).rejects.toThrow(/may already have been settled by recovery/);
  });

  it("leaves a recoverable journal entry when the commit fails", async () => {
    const t = setup();
    crashOn(t.store, (op, key, phase) => op === "put" && key === MANIFEST_KEY && phase === "before", 2);
    await expect(put(t.ctx, KEY, "one")).rejects.toBeInstanceOf(OperationIncompleteError);
    expect(t.live()).toBe("one");
    expect((await t.manifest())?.pending?.type).toBe("put");
  });
});
