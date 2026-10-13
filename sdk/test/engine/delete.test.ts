import { describe, expect, it } from "vitest";
import { remove } from "../../src/engine/delete.js";
import { put } from "../../src/engine/put.js";
import { recover } from "../../src/engine/recover.js";
import { ConcurrencyConflictError, OperationIncompleteError } from "../../src/errors.js";
import type { Manifest } from "../../src/meta/types.js";
import { StoreError } from "../../src/storage/types.js";
import { crashOn, KEY, MANIFEST_KEY, setup, text } from "../helpers.js";

describe("remove", () => {
  it("deletes the live object but keeps its bytes and records a marker", async () => {
    const t = setup();
    const v1 = await put(t.ctx, KEY, "one");
    const r = await remove(t.ctx, KEY);
    expect(t.live()).toBeNull();
    const m = await t.manifest();
    expect(m).toMatchObject({ current: null, liveEtag: null, pending: null });
    expect(m?.versions.at(-1)).toMatchObject({ versionId: r.versionId, kind: "delete", source: "ver2" });
    const kept = m?.versions.find((v) => v.versionId === v1.versionId);
    expect(await text((await t.store.get(kept!.objectKey!))!.body)).toBe("one");
  });

  it("is a no-op for a key that never existed", async () => {
    const t = setup();
    expect(await remove(t.ctx, KEY)).toEqual({ key: KEY, versionId: null });
    expect(t.store.objects.size).toBe(0);
  });

  it("records a direct delete it finds", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    await t.store.delete(KEY);
    const r = await remove(t.ctx, KEY);
    expect(r.versionId).not.toBeNull();
    expect((await t.manifest())?.versions.at(-1)).toMatchObject({ kind: "delete", source: "external" });
  });

  it("preserves a direct write before deleting it", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    t.store.putDirect(KEY, "direct");
    await remove(t.ctx, KEY);
    const external = (await t.manifest())?.versions.find((v) => v.source === "external");
    expect(await text((await t.store.get(external!.objectKey!))!.body)).toBe("direct");
  });

  it("rolls forward a delete whose commit failed", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    crashOn(t.store, (op, key, phase) => op === "put" && key === MANIFEST_KEY && phase === "before", 2);
    await expect(remove(t.ctx, KEY)).rejects.toBeInstanceOf(OperationIncompleteError);
    t.advance(61_000);
    expect((await recover(t.ctx, KEY)).outcome).toBe("rolled-forward");
    expect((await t.manifest())?.current).toBeNull();
  });

  it("rolls back a delete that never reached storage", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    crashOn(t.store, (op, key, phase) => op === "delete" && key === KEY && phase === "before");
    await expect(remove(t.ctx, KEY)).rejects.toBeInstanceOf(OperationIncompleteError);
    t.advance(61_000);
    expect((await recover(t.ctx, KEY)).outcome).toBe("rolled-back");
    expect(t.live()).toBe("one");
  });

  it("does not delete once half its lease has passed", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    t.store.fault = (op, key, phase) => {
      if (op === "put" && key === MANIFEST_KEY && phase === "after") {
        t.store.fault = undefined;
        t.advance(31_000); // the claim landed, then the writer stalled
      }
    };
    await expect(remove(t.ctx, KEY)).rejects.toThrow(/lease expired/);
    expect(t.live()).toBe("one");
    expect((await t.manifest())?.pending).toBeNull();
  });

  it("does not delete when another writer took over the claim", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    t.store.fault = (op, key, phase) => {
      if (op === "put" && key === MANIFEST_KEY && phase === "after") {
        t.store.fault = undefined;
        const m = JSON.parse(new TextDecoder().decode(t.store.objects.get(MANIFEST_KEY)!.bytes)) as Manifest;
        m.pending = { ...m.pending!, opId: "B" };
        t.store.putDirect(MANIFEST_KEY, JSON.stringify(m), { contentType: "application/json" });
      }
    };
    await expect(remove(t.ctx, KEY)).rejects.toBeInstanceOf(ConcurrencyConflictError);
    expect(t.live()).toBe("one");
    expect((await t.manifest())?.pending?.opId).toBe("B");
  });

  it("succeeds when the DELETE was answered with an error after it applied", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    crashOn(t.store, (op, key, phase) => op === "delete" && key === KEY && phase === "after", 1, new StoreError("other", "internal error", 500));
    const r = await remove(t.ctx, KEY);
    expect(t.live()).toBeNull();
    expect(await t.manifest()).toMatchObject({ current: null, liveEtag: null, pending: null });
    expect((await t.manifest())?.versions.at(-1)?.versionId).toBe(r.versionId);
  });
});
