import { describe, expect, it } from "vitest";
import { put } from "../../src/engine/put.js";
import { recover } from "../../src/engine/recover.js";
import { ConcurrencyConflictError, OperationIncompleteError } from "../../src/errors.js";
import { crashOn, dieOn, KEY, MANIFEST_KEY, setup } from "../helpers.js";

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
    const revive = dieOn(t.store, (op, key, phase) => op === "copy" && key === KEY && phase === "before");
    await expect(put(t.ctx, KEY, "two")).rejects.toBeInstanceOf(OperationIncompleteError);
    revive();
    t.advance(LEASE);
    expect((await recover(t.ctx, KEY)).outcome).toBe("rolled-back");
    expect(t.live()).toBe("one");
    expect(t.versionObjects()).toHaveLength(1);
    expect((await t.manifest())?.pending).toBeNull();
  });

  it("rolls back a same-bytes put with new headers that crashed before the promote", async () => {
    const t = setup();
    const v1 = await put(t.ctx, KEY, "one", { headers: { contentType: "text/plain" } });
    const revive = dieOn(t.store, (op, key, phase) => op === "copy" && key === KEY && phase === "before");
    await expect(put(t.ctx, KEY, "one", { headers: { contentType: "application/json" } })).rejects.toBeInstanceOf(
      OperationIncompleteError,
    );
    revive();
    t.advance(LEASE);
    expect((await recover(t.ctx, KEY)).outcome).toBe("rolled-back");
    const m = await t.manifest();
    expect(m).toMatchObject({ current: v1.versionId, pending: null });
    expect(m?.versions.at(-1)?.versionId).toBe(v1.versionId);
    expect((await t.store.head(KEY))?.headers.contentType).toBe("text/plain");
    expect(t.versionObjects()).toEqual([m?.versions[0]?.objectKey]);
  });

  it("rolls forward a same-bytes, same-headers put that crashed before the promote (live already equals it)", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one", { headers: { contentType: "text/plain" } });
    const revive = dieOn(t.store, (op, key, phase) => op === "copy" && key === KEY && phase === "before");
    await expect(put(t.ctx, KEY, "one", { headers: { contentType: "text/plain" } })).rejects.toBeInstanceOf(OperationIncompleteError);
    revive();
    const pending = (await t.manifest())?.pending;
    t.advance(LEASE);
    expect((await recover(t.ctx, KEY)).outcome).toBe("rolled-forward");
    const m = await t.manifest();
    const record = m?.versions.at(-1);
    expect(m).toMatchObject({ current: pending?.record.versionId, pending: null });
    const live = await t.store.head(KEY);
    expect(t.live()).toBe("one");
    expect(live?.etag).toBe(record?.etag);
    expect(live?.headers).toEqual(record?.headers);
  });

  it("accept-live keeps the stuck put's version object and records it as unconfirmed", async () => {
    const t = await crashedAfterPromote();
    const stuckRecord = (await t.manifest())!.pending!.record;
    t.store.putDirect(KEY, "someone else");
    t.advance(LEASE);
    expect((await recover(t.ctx, KEY)).outcome).toBe("stuck");
    expect((await recover(t.ctx, KEY, { acceptLive: true })).outcome).toBe("accepted-live");
    const m = await t.manifest();
    expect(t.versionObjects()).toContain(stuckRecord.objectKey);
    const recorded = m?.versions.find((v) => v.versionId === stuckRecord.versionId);
    expect(recorded).toMatchObject({ objectKey: stuckRecord.objectKey, unconfirmed: true, etag: t.store.objects.get(stuckRecord.objectKey!)!.etag });
    // The unconfirmed record comes before the adopted live object, which stays current.
    expect(m?.versions.at(-1)).toMatchObject({ source: "external" });
    expect(m?.current).toBe(m?.versions.at(-1)?.versionId);
    expect(t.versionObjects().sort()).toEqual(m!.versions.map((v) => v.objectKey!).sort());
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

  it("onlyOpId ignores someone else's op; ignoreLease settles our own inside the lease", async () => {
    const t = await crashedAfterPromote();
    const opId = (await t.manifest())!.pending!.opId;
    expect((await recover(t.ctx, KEY, { ignoreLease: true, onlyOpId: "not-mine" })).outcome).toBe("none");
    expect((await t.manifest())?.pending?.opId).toBe(opId);
    expect((await recover(t.ctx, KEY, { ignoreLease: true, onlyOpId: opId })).outcome).toBe("rolled-forward");
    expect((await t.manifest())?.pending).toBeNull();
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
