import { describe, expect, it } from "vitest";
import {
  ConcurrencyConflictError,
  ConfigurationError,
  CorruptManifestError,
  IntegrityCheckFailedError,
  InvalidKeyError,
  ObjectNotFoundError,
  OperationIncompleteError,
  StorageError,
  Ver2Error,
  VersionNotFoundError,
} from "../src/errors.js";

describe("errors", () => {
  it.each([
    [new InvalidKeyError("a/../b", "dot segment"), "INVALID_KEY", "InvalidKeyError"],
    [new ObjectNotFoundError("k"), "OBJECT_NOT_FOUND", "ObjectNotFoundError"],
    [new VersionNotFoundError("k", "v1"), "VERSION_NOT_FOUND", "VersionNotFoundError"],
    [new ConcurrencyConflictError("k", "raced"), "CONCURRENCY_CONFLICT", "ConcurrencyConflictError"],
    [new IntegrityCheckFailedError("k", "v1", "bad hash"), "INTEGRITY_CHECK_FAILED", "IntegrityCheckFailedError"],
    [new OperationIncompleteError("k", "op1", "crashed"), "OPERATION_INCOMPLETE", "OperationIncompleteError"],
    [new ConfigurationError("no bucket"), "CONFIGURATION_ERROR", "ConfigurationError"],
    [new CorruptManifestError("k", "invalid JSON"), "MANIFEST_INVALID", "CorruptManifestError"],
    [new StorageError("429", { status: 429, retryable: true }), "STORAGE_ERROR", "StorageError"],
  ])("%s has code %s", (error, code, name) => {
    expect(error).toBeInstanceOf(Ver2Error);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(code);
    expect(error.name).toBe(name);
  });

  it("carries structured details", () => {
    const e = new VersionNotFoundError("docs/a.txt", "v9");
    expect(e.details).toEqual({ key: "docs/a.txt", versionId: "v9" });
  });

  it("tells the caller how to resolve an incomplete operation", () => {
    expect(new OperationIncompleteError("k", "op1", "crashed").message).toContain("ver2 reconcile");
  });

  it("exposes retryability on storage errors", () => {
    expect(new StorageError("slow down", { status: 429, retryable: true }).retryable).toBe(true);
  });
});
