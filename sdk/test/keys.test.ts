import { describe, expect, it } from "vitest";
import { ConfigurationError, InvalidKeyError } from "../src/errors.js";
import { canonicalKey, maxKeyBytes, validateNamespace } from "../src/keys.js";

const policy = { namespace: ".ver2" };

describe("canonicalKey", () => {
  it("accepts ordinary keys unchanged", () => {
    expect(canonicalKey("docs/report v2.pdf", policy)).toBe("docs/report v2.pdf");
  });

  it("normalizes to NFC so both Unicode spellings share one history", () => {
    expect(canonicalKey("cafe\u0301.txt", policy)).toBe("caf\u00e9.txt");
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
    expect(() => canonicalKey("\u00e9".repeat(max / 2 + 1), policy)).toThrow(InvalidKeyError);
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

describe("canonicalKey hardening", () => {
  it.each([
    ["NUL", String.fromCharCode(0)],
    ["tab", String.fromCharCode(9)],
    ["newline", String.fromCharCode(10)],
    ["CR", String.fromCharCode(13)],
    ["DEL", String.fromCharCode(0x7f)],
  ])("rejects a control character (%s)", (_n, c) => {
    expect(() => canonicalKey(`a${c}b`, policy)).toThrow(/control character/);
  });

  it("allows backslash (round-trips on R2)", () => {
    const k = "a" + String.fromCharCode(92) + "b";
    expect(canonicalKey(k, policy)).toBe(k);
  });

  it("accepts a valid surrogate pair", () => {
    const k = `pkg-${String.fromCodePoint(0x1f4e6)}.txt`;
    expect(canonicalKey(k, policy)).toBe(k);
  });

  it("scopes the reserved namespace to a nested prefix", () => {
    const nested = { namespace: "tenants/acme/.ver2" };
    expect(() => canonicalKey("tenants/acme/.ver2/x", nested)).toThrow(InvalidKeyError);
    expect(canonicalKey("tenants/acme/x", nested)).toBe("tenants/acme/x");
  });

  it("measures the byte limit after NFC", () => {
    const max = maxKeyBytes(policy);
    const enc = new TextEncoder();
    const combo = "e" + String.fromCharCode(0x301); // NFC: 2 bytes; NFD: 3 bytes
    let key = combo.repeat(Math.floor(max / 2));
    key += "a".repeat(max - enc.encode(key.normalize("NFC")).length);
    expect(enc.encode(key.normalize("NFC")).length).toBe(max);
    expect(enc.encode(key).length).toBeGreaterThan(max);
    expect(canonicalKey(key, policy)).toBe(key.normalize("NFC"));
  });
});

describe("validateNamespace hardening", () => {
  it.each([
    ["lone surrogate", "a" + String.fromCharCode(0xd800) + "b"],
    ["control character", "a" + String.fromCharCode(1) + "b"],
    ["non-NFC", "cafe" + String.fromCharCode(0x301)],
    ["too long to leave room for keys", "a".repeat(1100)],
  ])("rejects %s", (_n, ns) => {
    expect(() => validateNamespace(ns)).toThrow(ConfigurationError);
  });
});

describe("validateNamespace version-key room", () => {
  it("rejects a namespace whose version keys would exceed 1024 bytes", () => {
    expect(() => validateNamespace("a".repeat(931))).toThrow(ConfigurationError);
  });
  it("accepts the longest namespace that fits", () => {
    expect(() => validateNamespace("a".repeat(930))).not.toThrow();
  });
});
