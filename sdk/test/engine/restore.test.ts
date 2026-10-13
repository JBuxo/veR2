import { describe, expect, it } from "vitest";
import { remove } from "../../src/engine/delete.js";
import { put } from "../../src/engine/put.js";
import { restore } from "../../src/engine/restore.js";
import { ConcurrencyConflictError, CorruptManifestError, VersionNotFoundError } from "../../src/errors.js";
import { StoreError } from "../../src/storage/types.js";
import { crashOn, KEY, MANIFEST_KEY, setup } from "../helpers.js";

describe("restore", () => {
  it("makes an old version live again as a new version", async () => {
    const t = setup();
    const v1 = await put(t.ctx, KEY, "one", { headers: { contentType: "text/plain" } });
    await put(t.ctx, KEY, "two");
    const r = await restore(t.ctx, KEY, v1.versionId);
    expect(t.live()).toBe("one");
    expect((await t.store.head(KEY))?.headers.contentType).toBe("text/plain");
    expect(r.sha256).toBe(v1.sha256);
    const m = await t.manifest();
    expect(m?.current).toBe(r.versionId);
    expect(m?.versions.at(-1)).toMatchObject({ source: "restore", restoredFrom: v1.versionId });
    expect(t.versionObjects()).toHaveLength(2); // restore shares v1's object
  });

  it("recreates a deleted key", async () => {
    const t = setup();
    const v1 = await put(t.ctx, KEY, "one");
    await remove(t.ctx, KEY);
    await restore(t.ctx, KEY, v1.versionId);
    expect(t.live()).toBe("one");
  });

  it("rejects unknown versions and delete markers", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    const marker = await remove(t.ctx, KEY);
    await expect(restore(t.ctx, KEY, "nope")).rejects.toBeInstanceOf(VersionNotFoundError);
    await expect(restore(t.ctx, KEY, marker.versionId!)).rejects.toBeInstanceOf(VersionNotFoundError);
  });
});

describe("restore safety", () => {
  it("refuses a version whose object points outside this key's history", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    const etag = t.store.putDirect("precious.txt", "secret");
    const snap = (await t.ctx.meta.read(KEY))!;
    const evil = { ...snap.manifest.versions[0]!, versionId: "evil", objectKey: "precious.txt", etag };
    await t.ctx.meta.write(KEY, { ...snap.manifest, versions: [...snap.manifest.versions, evil] }, snap.rev);
    await expect(restore(t.ctx, KEY, "evil")).rejects.toBeInstanceOf(CorruptManifestError);
    expect(t.live()).toBe("one");
    expect((await t.manifest())?.pending).toBeNull();
  });

  it("keeps the shared version object when a racing direct write makes it abandon", async () => {
    const t = setup();
    const v1 = await put(t.ctx, KEY, "one");
    await put(t.ctx, KEY, "two");
    const before = t.versionObjects();
    t.store.fault = (op, key, phase) => {
      if (op === "copy" && key === KEY && phase === "before") {
        t.store.fault = undefined;
        t.store.putDirect(KEY, "racer");
      }
    };
    await expect(restore(t.ctx, KEY, v1.versionId)).rejects.toBeInstanceOf(ConcurrencyConflictError);
    expect(t.live()).toBe("racer");
    expect((await t.manifest())?.pending).toBeNull();
    expect(t.versionObjects()).toEqual(before);
  });

  it("does not promote once half its lease has passed", async () => {
    const t = setup();
    const v1 = await put(t.ctx, KEY, "one");
    await put(t.ctx, KEY, "two");
    t.store.fault = (op, key, phase) => {
      if (op === "put" && key === MANIFEST_KEY && phase === "after") {
        t.store.fault = undefined;
        t.advance(31_000);
      }
    };
    await expect(restore(t.ctx, KEY, v1.versionId)).rejects.toThrow(/lease expired/);
    expect(t.live()).toBe("two");
    expect(t.versionObjects()).toHaveLength(2);
  });

  it("succeeds when the promote landed but answered with an error", async () => {
    const t = setup();
    const v1 = await put(t.ctx, KEY, "one");
    await put(t.ctx, KEY, "two");
    crashOn(t.store, (op, key, phase) => op === "copy" && key === KEY && phase === "after", 1, new StoreError("other", "internal error", 500));
    const r = await restore(t.ctx, KEY, v1.versionId);
    expect(t.live()).toBe("one");
    expect(await t.manifest()).toMatchObject({ current: r.versionId, liveEtag: r.etag, pending: null });
  });

  it("does not carry an unconfirmed flag onto the restored record", async () => {
    const t = setup();
    const v1 = await put(t.ctx, KEY, "one");
    await put(t.ctx, KEY, "two");
    const snap = (await t.ctx.meta.read(KEY))!;
    const versions = snap.manifest.versions.map((v) => (v.versionId === v1.versionId ? { ...v, unconfirmed: true } : v));
    await t.ctx.meta.write(KEY, { ...snap.manifest, versions }, snap.rev);
    await restore(t.ctx, KEY, v1.versionId);
    expect((await t.manifest())?.versions.at(-1)?.unconfirmed).toBeUndefined();
  });
});
