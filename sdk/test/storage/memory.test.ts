import { describe, expect, it } from "vitest";
import { MemoryObjectStore } from "../../src/storage/memory.js";
import { objectStoreContract } from "./contract.js";

const enc = (s: string) => new TextEncoder().encode(s);

objectStoreContract("memory", () => ({ store: new MemoryObjectStore(), prefix: "" }));

describe("MemoryObjectStore extras", () => {
  it("runs fault hooks before and after each operation", async () => {
    const calls: string[] = [];
    const store = new MemoryObjectStore({ fault: (op, key, phase) => void calls.push(`${op}:${key}:${phase}`) });
    await store.put("k", enc("x"));
    expect(calls).toEqual(["put:k:before", "put:k:after"]);
  });

  it("an 'after' fault leaves the write applied (ambiguous outcome)", async () => {
    const store = new MemoryObjectStore({
      fault: (_op, _key, phase) => {
        if (phase === "after") throw new Error("lost response");
      },
    });
    await expect(store.put("k", enc("x"))).rejects.toThrow("lost response");
    expect(store.objects.has("k")).toBe(true);
  });

  it("reports the destination key to copy faults", async () => {
    const seen: string[] = [];
    const store = new MemoryObjectStore();
    await store.put("src", enc("x"));
    store.fault = (op, key, phase) => {
      if (op === "copy" && phase === "before") seen.push(key);
    };
    await store.copy("src", "dst");
    expect(seen).toEqual(["dst"]);
  });

  it("putDirect simulates a client writing straight to the bucket", async () => {
    const store = new MemoryObjectStore({
      fault: () => {
        throw new Error("faults must not fire");
      },
    });
    const etag = store.putDirect("k", "direct");
    store.fault = undefined;
    expect((await store.head("k"))?.etag).toBe(etag);
  });
});
