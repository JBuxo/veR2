import { describe, expect, it } from "vitest";
import { claim } from "../../src/engine/claim.js";
import { put } from "../../src/engine/put.js";
import { assertLeaseHeld, confirmClaim } from "../../src/engine/run-claimed.js";
import { ConcurrencyConflictError } from "../../src/errors.js";
import { emptyManifest, type PendingOp } from "../../src/meta/types.js";
import type { StoreOp } from "../../src/storage/memory.js";
import { KEY, MANIFEST_KEY, setup } from "../helpers.js";

const op = (opId: string, startedAt: string): PendingOp => ({
  opId,
  type: "put",
  record: { versionId: "v", kind: "put", source: "ver2", createdAt: startedAt },
  expectedLiveEtag: null,
  startedAt,
});

describe("put ordering", () => {
  it("uploads the version object before claiming the key", async () => {
    const t = setup();
    const calls: [StoreOp, string][] = [];
    t.store.fault = (o, key, phase) => {
      if (phase === "before" && o === "put") calls.push([o, key]);
    };
    await put(t.ctx, KEY, "one");
    const firstVersion = calls.findIndex(([, k]) => k.startsWith(".ver2/o/"));
    const firstManifest = calls.findIndex(([, k]) => k === MANIFEST_KEY);
    expect(firstVersion).toBeGreaterThanOrEqual(0);
    expect(firstVersion).toBeLessThan(firstManifest);
  });

  it("deletes the uploaded version object when the claim loses", async () => {
    const t = setup();
    t.store.fault = (o, key, phase) => {
      if (o === "put" && key === MANIFEST_KEY && phase === "before") {
        t.store.fault = undefined;
        t.store.putDirect(MANIFEST_KEY, JSON.stringify({ ...emptyManifest(KEY), current: "other" }));
      }
    };
    await expect(put(t.ctx, KEY, "one")).rejects.toBeInstanceOf(ConcurrencyConflictError);
    expect(t.versionObjects()).toEqual([]);
    expect(t.live()).toBeNull();
  });
});

describe("lease fencing", () => {
  it("assertLeaseHeld allows up to half the lease and refuses after", () => {
    const t = setup();
    const started = op("a", t.ctx.now().toISOString());
    t.advance(30_000);
    expect(() => assertLeaseHeld(t.ctx, KEY, started)).not.toThrow();
    t.advance(1);
    expect(() => assertLeaseHeld(t.ctx, KEY, started)).toThrow(ConcurrencyConflictError);
    expect(() => assertLeaseHeld(t.ctx, KEY, started)).toThrow(/lease expired before the live object was changed/);
  });

  it("put does not promote once half its lease has passed", async () => {
    const t = setup();
    t.store.fault = (o, key, phase) => {
      if (o === "put" && key === MANIFEST_KEY && phase === "after") {
        t.store.fault = undefined;
        t.advance(31_000); // the claim landed, then the writer stalled
      }
    };
    await expect(put(t.ctx, KEY, "one")).rejects.toThrow(/lease expired/);
    expect(t.live()).toBeNull();
    expect((await t.manifest())?.pending).toBeNull();
    expect(t.versionObjects()).toEqual([]);
  });

  it("confirmClaim passes only while our op holds the key", async () => {
    const t = setup();
    await expect(confirmClaim(t.ctx, KEY, "a")).rejects.toBeInstanceOf(ConcurrencyConflictError);
    const rev = await claim(t.ctx, KEY, emptyManifest(KEY), null, op("a", t.ctx.now().toISOString()));
    await expect(confirmClaim(t.ctx, KEY, "a")).resolves.toBeUndefined();
    await expect(confirmClaim(t.ctx, KEY, "b")).rejects.toBeInstanceOf(ConcurrencyConflictError);
    await t.ctx.meta.write(KEY, emptyManifest(KEY), rev);
    await expect(confirmClaim(t.ctx, KEY, "a")).rejects.toBeInstanceOf(ConcurrencyConflictError);
  });
});
