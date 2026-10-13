import { describe, expect, it } from "vitest";
import { sameContent } from "../../src/engine/evidence.js";
import type { ObjectHeaders, ObjectInfo } from "../../src/storage/types.js";

const info = (etag: string, headers: ObjectHeaders): ObjectInfo => ({ key: "k", etag, size: 1, lastModified: new Date(0), headers });

describe("sameContent", () => {
  it("is true for equal ETags and equal headers", () => {
    const h = { contentType: "text/plain", cacheControl: "no-cache", metadata: { a: "1", b: "2" } };
    expect(sameContent(info('"e"', h), info('"e"', { ...h, metadata: { b: "2", a: "1" } }))).toBe(true);
  });

  it("is false when the ETags differ", () => {
    expect(sameContent(info('"e"', {}), info('"f"', {}))).toBe(false);
  });

  it("is false when a header differs", () => {
    expect(sameContent(info('"e"', { contentType: "text/plain" }), info('"e"', { contentType: "application/json" }))).toBe(false);
    expect(sameContent(info('"e"', { contentType: "text/plain" }), info('"e"', {}))).toBe(false);
    expect(sameContent(info('"e"', {}), info('"e"', { contentDisposition: "inline" }))).toBe(false);
  });

  it("treats undefined fields and empty or missing metadata as equal", () => {
    expect(sameContent(info('"e"', { contentType: undefined, metadata: {} }), info('"e"', {}))).toBe(true);
    expect(sameContent(info('"e"', { metadata: undefined }), info('"e"', { metadata: {} }))).toBe(true);
  });

  it("compares metadata as key-value maps", () => {
    expect(sameContent(info('"e"', { metadata: { a: "1" } }), info('"e"', { metadata: { a: "2" } }))).toBe(false);
    expect(sameContent(info('"e"', { metadata: { a: "1" } }), info('"e"', { metadata: { a: "1", b: "2" } }))).toBe(false);
    expect(sameContent(info('"e"', { metadata: { a: "1" } }), info('"e"', {}))).toBe(false);
  });
});
