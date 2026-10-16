import { afterAll, describe, expect, it } from "vitest";
import { createVer2, type Ver2 } from "../../src/index.js";
import type { S3ObjectStore } from "../../src/storage/s3.js";
import { cleanup, hasR2, makeS3Store, runPrefix } from "./env.js";

const text = (s: ReadableStream<Uint8Array>) => new Response(s).text();

describe.skipIf(!hasR2)("Ver2 against R2", () => {
  const store = hasR2 ? makeS3Store() : (undefined as unknown as S3ObjectStore);
  // Namespace inside the run prefix so cleanup removes everything this run wrote.
  const ver2 = hasR2 ? createVer2({ store, namespace: `${runPrefix}.ver2` }) : (undefined as unknown as Ver2);
  afterAll(() => cleanup(store, runPrefix), 120_000);

  it("put → put → restore → delete keeps every version intact", async () => {
    const key = `${runPrefix}docs/report.txt`;
    const v1 = await ver2.put(key, "first", { headers: { contentType: "text/plain" } });
    const v2 = await ver2.put(key, "second");
    const restored = await ver2.versions.restore(key, v1.versionId);
    expect(restored.sha256).toBe(v1.sha256);
    expect(await text((await store.get(key))!.body)).toBe("first");
    expect((await store.head(key))?.headers.contentType).toBe("text/plain");
    await ver2.delete(key);
    expect(await store.head(key)).toBeNull();
    expect(await text((await ver2.versions.download(key, v2.versionId)).body)).toBe("second");
    expect((await ver2.versions.list(key)).map((v) => v.kind)).toEqual(["delete", "put", "put", "put"]);
  });

  it("preserves a direct write before overwriting it", async () => {
    const key = `${runPrefix}docs/external.txt`;
    await ver2.put(key, "managed");
    await store.put(key, new TextEncoder().encode("direct"));
    await ver2.put(key, "managed again");
    const external = (await ver2.versions.list(key)).find((v) => v.source === "external");
    expect(external).toBeDefined();
    expect(await text((await ver2.versions.download(key, external!.versionId)).body)).toBe("direct");
  });

  it("finds nothing to recover after clean operations", async () => {
    const results = [];
    for await (const r of ver2.recoverAll()) results.push(r);
    expect(results).toEqual([]);
  });
});
