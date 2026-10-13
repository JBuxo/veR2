import { describe, expect, it } from "vitest";
import { ConfigurationError, InvalidKeyError } from "../src/errors.js";
import { canonicalKey, maxKeyBytes, validateNamespace } from "../src/keys.js";

const policy = { namespace: ".ver2" };

describe("canonicalKey", () => {
  it("accepts ordinary keys unchanged", () => {
    expect(canonicalKey("docs/report v2.pdf", policy)).toBe("docs/report v2.pdf");
  });

  it("normalizes to NFC so both Unicode spellings share one history", () => {
    expect(canonicalKey("café.txt", policy)).toBe("café.txt");
  });

  it.each(["", ".", "..", "./a", "a/.", "a/./b", "a/../b", "a/.."])("rejects %j", (key) => {
    expect(() => canonicalKey(key, policy)).toThrow(InvalidKeyError);
  });

  it.each([".hidden", "a/..b", "a/b..", "a/%2E/b", "a//b", "dir/"])("allows %j (not a dot segment)", (key) => {
    expect(canonicalKey(key, policy)).toBe(key);
  });

  it("rejects the reserved namespace and anything inside it", () => {
    expect(() => canonicalKey(".ver2", policy)).toThrow(InvalidKeyError);
    expect(() => canonicalKey(".ver2/m/x", policy)).toThrow(InvalidKeyError);
    expect(canonicalKey(".ver2x/y", policy)).toBe(".ver2x/y");
  });

  it("rejects lone surrogates", () => {
    expect(() => canonicalKey("bad\ud800key", policy)).toThrow(InvalidKeyError);
  });

  it("enforces the byte limit left after the manifest path", () => {
    const max = maxKeyBytes(policy);
    expect(max).toBe(1024 - ".ver2/m/".length);
    expect(canonicalKey("a".repeat(max), policy)).toHaveLength(max);
    expect(() => canonicalKey("a".repeat(max + 1), policy)).toThrow(/maximum is 1016/);
    // "é" is 2 bytes in UTF-8
    expect(() => canonicalKey("é".repeat(max / 2 + 1), policy)).toThrow(InvalidKeyError);
  });
});

describe("validateNamespace", () => {
  it("accepts nested namespaces", () => {
    expect(validateNamespace("tenants/acme/.ver2")).toBe("tenants/acme/.ver2");
  });

  it.each(["", "/x", "x/", "a//b", "a/../b", "."])("rejects %j", (ns) => {
    expect(() => validateNamespace(ns)).toThrow(ConfigurationError);
  });
});
