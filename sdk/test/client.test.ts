import { describe, expect, it } from "vitest";
import { ConfigurationError, createVer2, InvalidKeyError, StorageError, VERSION } from "../src/index.js";
import { MemoryObjectStore } from "../src/storage/memory.js";
import { StoreError } from "../src/storage/types.js";
import { text } from "./helpers.js";

describe("Ver2", () => {
  it("runs the full lifecycle through the public API", async () => {
    const store = new MemoryObjectStore();
    const ver2 = createVer2({ store });
    const v1 = await ver2.put("docs/a.txt", "one");
    await ver2.put("docs/a.txt", "two");
    await ver2.versions.restore("docs/a.txt", v1.versionId);
    await ver2.delete("docs/a.txt");
    const history = await ver2.versions.list("docs/a.txt");
    expect(history.map((v) => v.kind)).toEqual(["delete", "put", "put", "put"]);
    expect(await text((await ver2.versions.download("docs/a.txt", v1.versionId)).body)).toBe("one");
    expect((await ver2.list("docs/")).keys).toEqual(["docs/a.txt"]);
    expect(VERSION).toBe("0.1.0");
  });

  it("uses a custom namespace and protects it", async () => {
    const store = new MemoryObjectStore();
    const ver2 = createVer2({ store, namespace: "_history" });
    await ver2.put("a", "x");
    expect([...store.objects.keys()].some((k) => k.startsWith("_history/m/"))).toBe(true);
    await expect(ver2.put("_history/m/a", "x")).rejects.toBeInstanceOf(InvalidKeyError);
  });

  it("rejects invalid namespaces", () => {
    expect(() => createVer2({ store: new MemoryObjectStore(), namespace: "a/../b" })).toThrow(ConfigurationError);
  });

  it("maps storage failures to retryable StorageError", async () => {
    const store = new MemoryObjectStore({
      fault: () => {
        throw new StoreError("rate-limited", "slow down", 429);
      },
    });
    const error = await createVer2({ store }).put("a", "x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).retryable).toBe(true);
  });

  it("recoverAll reports only keys that needed attention", async () => {
    const ver2 = createVer2({ store: new MemoryObjectStore() });
    await ver2.put("a", "x");
    const results = [];
    for await (const r of ver2.recoverAll()) results.push(r);
    expect(results).toEqual([]);
  });
});
