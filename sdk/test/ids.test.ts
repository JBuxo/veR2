import { describe, expect, it } from "vitest";
import { ulid } from "../src/ids.js";

describe("ulid", () => {
  it("is 26 Crockford base32 characters", () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("sorts by time", () => {
    const zeros = () => new Uint8Array(16);
    expect(ulid(1_000, zeros) < ulid(2_000, zeros)).toBe(true);
  });

  it("is deterministic given time and randomness", () => {
    const ones = () => new Uint8Array(16).fill(1);
    expect(ulid(0, ones)).toBe(`${"0".repeat(10)}${"1".repeat(16)}`);
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => ulid()));
    expect(ids.size).toBe(1000);
  });
});
