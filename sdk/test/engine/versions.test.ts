import { describe, expect, it } from "vitest";
import { remove } from "../../src/engine/delete.js";
import { put } from "../../src/engine/put.js";
import { download, listVersions } from "../../src/engine/versions.js";
import { CorruptManifestError, IntegrityCheckFailedError, ObjectNotFoundError, VersionNotFoundError } from "../../src/errors.js";
import { KEY, setup, text } from "../helpers.js";

describe("listVersions", () => {
  it("returns newest first, including delete markers", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    await put(t.ctx, KEY, "two");
    await remove(t.ctx, KEY);
    expect((await listVersions(t.ctx, KEY)).map((v) => v.kind)).toEqual(["delete", "put", "put"]);
  });

  it("is empty for unknown keys", async () => {
    expect(await listVersions(setup().ctx, KEY)).toEqual([]);
  });
});

describe("download", () => {
  it("streams the current version by default and any version by id", async () => {
    const t = setup();
    const v1 = await put(t.ctx, KEY, "one");
    await put(t.ctx, KEY, "two");
    expect(await text((await download(t.ctx, KEY)).body)).toBe("two");
    expect(await text((await download(t.ctx, KEY, v1.versionId)).body)).toBe("one");
  });

  it("has no current version after a delete", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    const marker = await remove(t.ctx, KEY);
    await expect(download(t.ctx, KEY)).rejects.toBeInstanceOf(ObjectNotFoundError);
    await expect(download(t.ctx, KEY, marker.versionId!)).rejects.toBeInstanceOf(VersionNotFoundError);
  });

  it("detects a replaced version object", async () => {
    const t = setup();
    const v1 = await put(t.ctx, KEY, "one");
    const record = (await listVersions(t.ctx, KEY))[0]!;
    t.store.putDirect(record.objectKey!, "tampered");
    await expect(download(t.ctx, KEY, v1.versionId)).rejects.toBeInstanceOf(IntegrityCheckFailedError);
  });

  it("detects corrupted bytes behind an unchanged ETag", async () => {
    const t = setup();
    const v1 = await put(t.ctx, KEY, "one");
    const record = (await listVersions(t.ctx, KEY))[0]!;
    t.store.objects.get(record.objectKey!)!.bytes = new TextEncoder().encode("bad");
    const { body } = await download(t.ctx, KEY, v1.versionId);
    await expect(text(body)).rejects.toBeInstanceOf(IntegrityCheckFailedError);
  });

  it("refuses a version whose object points outside this key's history", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    t.store.putDirect("precious.txt", "secret");
    const snap = (await t.ctx.meta.read(KEY))!;
    const evil = { ...snap.manifest.versions[0]!, versionId: "evil", objectKey: "precious.txt" };
    await t.ctx.meta.write(KEY, { ...snap.manifest, versions: [...snap.manifest.versions, evil] }, snap.rev);
    await expect(download(t.ctx, KEY, "evil")).rejects.toBeInstanceOf(CorruptManifestError);
  });
});
