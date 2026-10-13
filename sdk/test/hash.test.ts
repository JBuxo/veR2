import { describe, expect, it } from "vitest";
import { sha256Hex, sha256OfStream, toBytes, verifyingStream } from "../src/hash.js";

const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

const streamOf = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of chunks) c.enqueue(toBytes(chunk));
      c.close();
    },
  });

describe("hash", () => {
  it("hashes bytes", () => {
    expect(sha256Hex(toBytes("abc"))).toBe(ABC);
  });

  it("hashes a stream incrementally", async () => {
    expect(await sha256OfStream(streamOf("a", "b", "c"))).toEqual({ sha256: ABC, size: 3 });
  });

  it("verifyingStream passes matching content through", async () => {
    const out = streamOf("ab", "c").pipeThrough(verifyingStream(ABC, () => new Error("mismatch")));
    expect(await sha256OfStream(out)).toEqual({ sha256: ABC, size: 3 });
  });

  it("verifyingStream errors when the digest differs", async () => {
    const out = streamOf("abd").pipeThrough(verifyingStream(ABC, (actual) => new Error(`got ${actual}`)));
    await expect(sha256OfStream(out)).rejects.toThrow(/^got [0-9a-f]{64}$/);
  });
});
