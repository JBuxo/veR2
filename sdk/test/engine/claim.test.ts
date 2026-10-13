import { describe, expect, it } from "vitest";
import { claim } from "../../src/engine/claim.js";
import { put } from "../../src/engine/put.js";
import { ConcurrencyConflictError, OperationIncompleteError } from "../../src/errors.js";
import { emptyManifest, type Manifest } from "../../src/meta/types.js";
import { crashOn, KEY, MANIFEST_KEY, setup } from "../helpers.js";

const manifestPut = (op: string, key: string, phase: string) => op === "put" && key === MANIFEST_KEY && phase === "before";

describe("write admission", () => {
  it("refuses a key that another writer claimed right after recovery settled it", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    crashOn(t.store, manifestPut, 2);
    await expect(put(t.ctx, KEY, "two")).rejects.toBeInstanceOf(OperationIncompleteError);
    t.advance(61_000);

    // Writer B claims the key the moment recovery's commit lands.
    let injected = false;
    t.store.fault = (op, key, phase) => {
      if (op === "put" && key === MANIFEST_KEY && phase === "after" && !injected) {
        injected = true;
        t.store.fault = undefined;
        const m = JSON.parse(new TextDecoder().decode(t.store.objects.get(MANIFEST_KEY)!.bytes)) as Manifest;
        const record = { versionId: "B-v", kind: "put" as const, source: "ver2" as const, createdAt: t.ctx.now().toISOString() };
        m.pending = { opId: "B", type: "put", record, expectedLiveEtag: m.liveEtag, startedAt: t.ctx.now().toISOString() };
        t.store.putDirect(MANIFEST_KEY, JSON.stringify(m), { contentType: "application/json" });
      }
    };
    await expect(put(t.ctx, KEY, "A")).rejects.toBeInstanceOf(ConcurrencyConflictError);
    expect(injected).toBe(true);
    expect((await t.manifest())?.pending?.opId).toBe("B");
    expect(t.live()).toBe("two");
  });

  it("claim refuses a manifest that already carries a pending op", async () => {
    const t = setup();
    const record = { versionId: "v", kind: "put" as const, source: "ver2" as const, createdAt: "2026-01-01T00:00:00.000Z" };
    const op = { opId: "op", type: "put" as const, record, expectedLiveEtag: null, startedAt: "2026-01-01T00:00:00.000Z" };
    const busy = { ...emptyManifest(KEY), pending: { ...op, opId: "other" } };
    await expect(claim(t.ctx, KEY, busy, null, op)).rejects.toBeInstanceOf(ConcurrencyConflictError);
    expect(await t.manifest()).toBeUndefined();
    const rev = await claim(t.ctx, KEY, emptyManifest(KEY), null, op);
    expect(rev).toEqual(expect.any(String));
    expect((await t.manifest())?.pending?.opId).toBe("op");
  });
});
