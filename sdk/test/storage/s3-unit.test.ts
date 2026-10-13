import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { S3ObjectStore } from "../../src/storage/s3.js";
import { StoreError } from "../../src/storage/types.js";

const stub = (send: () => unknown) => new S3ObjectStore({ bucket: "b", client: { send } as unknown as S3Client });
const failing = (err: unknown) =>
  stub(() => {
    throw err;
  });
const http = (status: number, message = "boom") => Object.assign(new Error(message), { $metadata: { httpStatusCode: status } });
const named = (name: string) => Object.assign(new Error("slow"), { name });
const kindOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as StoreError;
  }
  throw new Error("did not throw");
};

describe("S3ObjectStore error mapping", () => {
  it.each([
    [412, "precondition-failed"],
    [429, "rate-limited"],
    [500, "other"],
    [403, "other"],
  ])("HTTP %i maps to %s with a prefixed message", async (status, kind) => {
    const e = await kindOf(failing(http(status)).put("k", new Uint8Array()));
    expect(e.kind).toBe(kind);
    expect(e.status).toBe(status);
    expect(e.message).toBe(`put k: HTTP ${status} boom`);
  });

  it("404 on head is null; on copy it is not-found", async () => {
    expect(await failing(http(404)).head("k")).toBeNull();
    expect((await kindOf(failing(http(404)).copy("a", "b"))).kind).toBe("not-found");
  });

  it.each([
    ["TimeoutError", named("TimeoutError")],
    ["AbortError", named("AbortError")],
    ["ECONNRESET", Object.assign(new Error("reset"), { code: "ECONNRESET" })],
    ["retryable", Object.assign(new Error("x"), { $retryable: {} })],
  ])("no response (%s) maps to network", async (_n, err) => {
    const e = await kindOf(failing(err).head("k"));
    expect(e.kind).toBe("network");
    expect(e.message).toMatch(/^head k: network /);
  });

  it("a missing ETag is an error", async () => {
    expect((await kindOf(stub(() => ({})).put("k", new Uint8Array()))).message).toBe("put k: response had no ETag");
    expect((await kindOf(stub(() => ({})).head("k"))).message).toBe("head k: response had no ETag");
    expect((await kindOf(stub(() => ({})).copy("a", "b"))).message).toBe("copy b: response had no ETag");
  });

  it("list clamps the limit", async () => {
    const seen: unknown[] = [];
    const s = stub(() => ({ Contents: [] }));
    (s as unknown as { client: { send: (c: { input: unknown }) => unknown } }).client.send = (c) => (seen.push(c.input), {});
    await s.list("p", { limit: Number.NaN });
    await s.list("p", { limit: 5000 });
    await s.list("p", { limit: 0 });
    expect(seen.map((i) => (i as { MaxKeys: number }).MaxKeys)).toEqual([1000, 1000, 1]);
  });
});

describe("S3ObjectStore endpoint guard", () => {
  const mk = (o: object) => () => new S3ObjectStore({ bucket: "b", credentials: { accessKeyId: "a", secretAccessKey: "s" }, ...o });
  it("rejects non-R2 endpoints", () => {
    expect(mk({ endpoint: "https://s3.amazonaws.com" })).toThrow(/R2/);
  });
  it("accepts R2 endpoints, including jurisdictions", () => {
    expect(mk({ endpoint: "https://x.eu.r2.cloudflarestorage.com" })).not.toThrow();
    expect(mk({ accountId: "abc" })).not.toThrow();
  });
  it("allows opting out", () => {
    expect(mk({ endpoint: "http://localhost:9000", allowNonR2Endpoint: true })).not.toThrow();
  });
});
