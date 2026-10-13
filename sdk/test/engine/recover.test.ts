import { describe, expect, it } from "vitest";
import { put } from "../../src/engine/put.js";
import { recover } from "../../src/engine/recover.js";
import { ConcurrencyConflictError, OperationIncompleteError } from "../../src/errors.js";
import { crashOn, KEY, MANIFEST_KEY, setup } from "../helpers.js";

const manifestPut = (op: string, key: string, phase: string) => op === "put" && key === MANIFEST_KEY && phase === "before";
const LEASE = 61_000;

/** v1 committed, then a put of "two" crashes after promoting but before committing. */
async function crashedAfterPromote() {
  const t = setup();
  await put(t.ctx, KEY, "one");
  crashOn(t.store, manifestPut, 2);
  await expect(put(t.ctx, KEY, "two")).rejects.toBeInstanceOf(OperationIncompleteError);
  return t;
}

describe("recover", () => {
  it("does nothing without a pending operation", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    expect((await recover(t.ctx, KEY)).outcome).toBe("none");
  });

  it("leaves operations inside their lease alone", async () => {
    const t = await crashedAfterPromote();
    expect((await recover(t.ctx, KEY)).outcome).toBe("in-progress");
  });

  it("rolls a put forward when the promote landed", async () => {
    const t = await crashedAfterPromote();
    const pending = (await t.manifest())?.pending;
    t.advance(LEASE);
    expect((await recover(t.ctx, KEY)).outcome).toBe("rolled-forward");
    const m = await t.manifest();
    expect(m).toMatchObject({ current: pending?.record.versionId, pending: null });
    expect(m?.versions).toHaveLength(2);
  });

  it("rolls a put back when the promote never happened, deleting the orphan", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    crashOn(t.store, (op, key, phase) => op === "copy" && key === KEY && phase === "before");
    await expect(put(t.ctx, KEY, "two")).rejects.toBeInstanceOf(OperationIncompleteError);
    t.advance(LEASE);
    expect((await recover(t.ctx, KEY)).outcome).toBe("rolled-back");
    expect(t.live()).toBe("one");
    expect(t.versionObjects()).toHaveLength(1);
    expect((await t.manifest())?.pending).toBeNull();
  });

  it("marks the op stuck when the evidence is ambiguous, and accept-live resolves it", async () => {
    const t = await crashedAfterPromote();
    t.store.putDirect(KEY, "someone else");
    t.advance(LEASE);
    expect((await recover(t.ctx, KEY)).outcome).toBe("stuck");
    expect((await t.manifest())?.pending?.stuck).toBeDefined();
    await expect(put(t.ctx, KEY, "three")).rejects.toBeInstanceOf(OperationIncompleteError);

    expect((await recover(t.ctx, KEY, { acceptLive: true })).outcome).toBe("accepted-live");
    const m = await t.manifest();
    expect(m?.pending).toBeNull();
    expect(m?.versions.at(-1)?.source).toBe("external");
  });

  it("dry-run reports without writing", async () => {
    const t = await crashedAfterPromote();
    t.advance(LEASE);
    expect((await recover(t.ctx, KEY, { dryRun: true })).outcome).toBe("rolled-forward");
    expect((await t.manifest())?.pending).not.toBeNull();
  });

  it("put waits for the lease, then recovers and proceeds", async () => {
    const t = await crashedAfterPromote();
    await expect(put(t.ctx, KEY, "three")).rejects.toBeInstanceOf(ConcurrencyConflictError);
    t.advance(LEASE);
    await put(t.ctx, KEY, "three");
    expect((await t.manifest())?.versions).toHaveLength(3);
    expect(t.live()).toBe("three");
  });
});
