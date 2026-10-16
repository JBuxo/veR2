# veR2 Phase 1 (Lite Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@ver2/sdk` and `@ver2/cli` with versioned `put` / `delete` / `restore` / `download` / `recover` on Cloudflare R2, using only R2 credentials (manifests stored in the bucket).

**Architecture:** A runtime-agnostic engine talks to two interfaces: `ObjectStore` (S3 driver for R2 plus an in-memory fake that mirrors verified R2 semantics) and `MetadataStore` (per-key JSON manifests in R2 with CAS through `If-Match`). Every write claims a pending operation in the manifest, writes an immutable version object, promotes it to the live key with R2's `cf-copy-destination-if-*` guards, then commits. Recovery decides roll-forward / roll-back / stuck from evidence. Read `docs/superpowers/specs/2026-10-13-ver2-architecture.md` before starting.

**Tech Stack:** TypeScript (ESM, `nodenext`), npm workspaces, Vitest, `@aws-sdk/client-s3` v3, `@noble/hashes`, Node ≥ 22 (`node:util.parseArgs` in the CLI).

**Conventions for every task**
- Run commands from the repo root unless a step says otherwise.
- `sdk/src/**` must not import `node:*` modules. It has to run in Workers later.
- Relative imports use the `.js` extension (`nodenext`).
- Commit messages use Conventional Commits.

---

## File map

```
package.json                     workspace root
tsconfig.base.json               shared compiler options
sdk/
  package.json  tsconfig.json  tsconfig.build.json  vitest.config.ts
  src/
    index.ts                     public exports
    errors.ts                    public error classes
    keys.ts                      key + namespace policy
    ids.ts                       ULID generator
    hash.ts                      SHA-256 helpers, verifying stream
    layout.ts                    internal key layout (<ns>/m, <ns>/o)
    client.ts                    Ver2 facade, public error mapping
    storage/types.ts             ObjectStore interface, StoreError
    storage/memory.ts            MemoryObjectStore (tests, fault injection)
    storage/s3.ts                S3ObjectStore (R2)
    meta/types.ts                Manifest types, MetadataStore, MetaConflictError
    meta/object-store-manifests.ts  manifests stored as objects
    engine/context.ts            EngineContext
    engine/manifest.ts           commit helper
    engine/live.ts               syncLive: adopt direct writes / deletes
    engine/recover.ts            evidence-based recovery
    engine/claim.ts              loadForWrite (lease + recovery)
    engine/run-claimed.ts        storage half of a claimed op: commit or abandon
    engine/promote.ts            guarded copy version → live
    engine/put.ts  engine/delete.ts  engine/restore.ts  engine/versions.ts
  test/
    helpers.ts                   engine test harness
    storage/contract.ts          ObjectStore contract suite (memory + R2)
    *.test.ts, storage/*.test.ts, meta/*.test.ts, engine/*.test.ts
    integration/env.ts  integration/s3-store.test.ts  integration/ver2.test.ts
cli/
  package.json  tsconfig.json  tsconfig.build.json  vitest.config.ts
  src/index.ts  main.ts  types.ts  config.ts  output.ts  commands.ts
  test/cli.test.ts
```

---

### Task 1: Workspace scaffold

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `sdk/package.json`, `sdk/tsconfig.json`, `sdk/tsconfig.build.json`, `sdk/vitest.config.ts`, `sdk/src/index.ts`
- Test: `sdk/test/smoke.test.ts`

- [x] **Step 1: Root workspace files**

`package.json`:
```json
{
  "name": "ver2",
  "private": true,
  "license": "Apache-2.0",
  "type": "module",
  "workspaces": ["sdk"],
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "npm run build --workspaces",
    "test": "npm test --workspaces",
    "typecheck": "npm run typecheck --workspaces"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": ["node"],
    "strict": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [x] **Step 2: SDK package files**

`sdk/package.json`:
```json
{
  "name": "@ver2/sdk",
  "version": "0.1.0",
  "description": "Object versioning for Cloudflare R2",
  "license": "Apache-2.0",
  "repository": { "type": "git", "url": "git+https://github.com/JBuxo/ver2.git", "directory": "sdk" },
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./s3": { "types": "./dist/storage/s3.d.ts", "default": "./dist/storage/s3.js" },
    "./memory": { "types": "./dist/storage/memory.d.ts", "default": "./dist/storage/memory.js" }
  },
  "files": ["dist"],
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

`sdk/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src", "test", "vitest.config.ts"] }
```

`sdk/tsconfig.build.json`:
```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "rootDir": "src", "outDir": "dist" }, "include": ["src"] }
```

`sdk/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], testTimeout: 60_000 },
});
```

`sdk/src/index.ts`:
```ts
export const VERSION = "0.1.0";
```

- [x] **Step 3: Install toolchain**

Run:
```bash
npm i -D typescript vitest @types/node
npm i -w @ver2/sdk @noble/hashes
```
Expected: `package-lock.json` created, `node_modules/` at root.

- [x] **Step 4: Smoke test**

`sdk/test/smoke.test.ts`:
```ts
import { expect, it } from "vitest";
import { VERSION } from "../src/index.js";

it("exports a version", () => {
  expect(VERSION).toBe("0.1.0");
});
```

Run: `npm test -w @ver2/sdk` → Expected: 1 passed.
Run: `npm run typecheck -w @ver2/sdk` → Expected: no output, exit 0.

- [x] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json sdk
git commit -m "chore: scaffold npm workspace and @ver2/sdk package"
```

---

### Task 2: Public errors

**Files:**
- Create: `sdk/src/errors.ts`
- Test: `sdk/test/errors.test.ts`

- [x] **Step 1: Write the failing test**

`sdk/test/errors.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  ConcurrencyConflictError,
  ConfigurationError,
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
```

- [x] **Step 2: Run to verify it fails**

Run: `npm test -w @ver2/sdk -- errors` → Expected: FAIL, cannot resolve `../src/errors.js`.

- [x] **Step 3: Implement**

`sdk/src/errors.ts`:
```ts
export type Ver2ErrorCode =
  | "INVALID_KEY"
  | "OBJECT_NOT_FOUND"
  | "VERSION_NOT_FOUND"
  | "CONCURRENCY_CONFLICT"
  | "INTEGRITY_CHECK_FAILED"
  | "OPERATION_INCOMPLETE"
  | "CONFIGURATION_ERROR"
  | "STORAGE_ERROR";

/** Base class for every error veR2 throws on purpose. Switch on `code`, not on class names. */
export class Ver2Error extends Error {
  readonly code: Ver2ErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: Ver2ErrorCode, message: string, details: Record<string, unknown> = {}, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class InvalidKeyError extends Ver2Error {
  constructor(key: string, reason: string) {
    super("INVALID_KEY", `Invalid key ${JSON.stringify(key)}: ${reason}`, { key, reason });
  }
}

export class ObjectNotFoundError extends Ver2Error {
  constructor(key: string) {
    super("OBJECT_NOT_FOUND", `No current object for ${JSON.stringify(key)}`, { key });
  }
}

export class VersionNotFoundError extends Ver2Error {
  constructor(key: string, versionId: string) {
    super("VERSION_NOT_FOUND", `No restorable version ${versionId} for ${JSON.stringify(key)}`, { key, versionId });
  }
}

export class ConcurrencyConflictError extends Ver2Error {
  constructor(key: string, reason: string) {
    super("CONCURRENCY_CONFLICT", `Concurrent change to ${JSON.stringify(key)}: ${reason}`, { key, reason });
  }
}

export class IntegrityCheckFailedError extends Ver2Error {
  constructor(key: string, versionId: string, reason: string) {
    super(
      "INTEGRITY_CHECK_FAILED",
      `Integrity check failed for ${JSON.stringify(key)} version ${versionId}: ${reason}`,
      { key, versionId, reason },
    );
  }
}

export class OperationIncompleteError extends Ver2Error {
  constructor(key: string, opId: string, reason: string, options?: { cause?: unknown }) {
    super(
      "OPERATION_INCOMPLETE",
      `Operation ${opId} on ${JSON.stringify(key)} did not complete: ${reason}. Run \`ver2 reconcile\`.`,
      { key, opId, reason },
      options,
    );
  }
}

export class ConfigurationError extends Ver2Error {
  constructor(message: string) {
    super("CONFIGURATION_ERROR", message);
  }
}

export class StorageError extends Ver2Error {
  readonly retryable: boolean;

  constructor(message: string, details: { status?: number; retryable: boolean }, options?: { cause?: unknown }) {
    super("STORAGE_ERROR", message, details, options);
    this.retryable = details.retryable;
  }
}
```

- [x] **Step 4: Run to verify it passes**

Run: `npm test -w @ver2/sdk -- errors` → Expected: all pass.

- [x] **Step 5: Commit**

```bash
git add sdk/src/errors.ts sdk/test/errors.test.ts
git commit -m "feat(sdk): add public error types"
```

---

### Task 3: Key and namespace policy

Probe evidence: R2 resolves `.`/`..` segments (including `%2E`) before storing, NFC/NFD spellings address one object, and keys are capped at 1024 bytes.

**Files:**
- Create: `sdk/src/keys.ts`
- Test: `sdk/test/keys.test.ts`

- [x] **Step 1: Write the failing test**

`sdk/test/keys.test.ts`:
```ts
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
    // "\u00e9" is 2 bytes in UTF-8
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
```

- [x] **Step 2: Run to verify it fails**

Run: `npm test -w @ver2/sdk -- keys` → Expected: FAIL, cannot resolve `../src/keys.js`.

- [x] **Step 3: Implement**

`sdk/src/keys.ts`:
```ts
import { ConfigurationError, InvalidKeyError } from "./errors.js";

export const MAX_R2_KEY_BYTES = 1024;

export interface KeyPolicy {
  namespace: string;
}

const encoder = new TextEncoder();
const LONE_SURROGATE = /\p{Cs}/u;
const isDotSegment = (s: string) => s === "." || s === "..";

/** Longest user key whose manifest key (`<ns>/m/<key>`) still fits R2's 1024-byte limit. */
export function maxKeyBytes(policy: KeyPolicy): number {
  return MAX_R2_KEY_BYTES - encoder.encode(`${policy.namespace}/m/`).length;
}

/**
 * Validate a user key and return its canonical (NFC) form, or throw InvalidKeyError.
 * Every engine entry point calls this before touching storage.
 */
export function canonicalKey(key: string, policy: KeyPolicy): string {
  if (typeof key !== "string" || key.length === 0) {
    throw new InvalidKeyError(String(key), "key must be a non-empty string");
  }
  if (LONE_SURROGATE.test(key)) throw new InvalidKeyError(key, "key contains an unpaired UTF-16 surrogate");
  const k = key.normalize("NFC");
  if (k.split("/").some(isDotSegment)) {
    throw new InvalidKeyError(key, "'.' and '..' path segments are not allowed (R2 resolves them, so the object would land elsewhere)");
  }
  if (k === policy.namespace || k.startsWith(`${policy.namespace}/`)) {
    throw new InvalidKeyError(key, `keys under the reserved namespace "${policy.namespace}/" are managed by veR2`);
  }
  const bytes = encoder.encode(k).length;
  const max = maxKeyBytes(policy);
  if (bytes > max) {
    throw new InvalidKeyError(key, `key is ${bytes} bytes; the maximum is ${max} (R2's 1024-byte limit minus the manifest path)`);
  }
  return k;
}

/** Validate the internal namespace prefix (no leading/trailing slash, no empty or dot segments). */
export function validateNamespace(namespace: string): string {
  const segments = namespace.split("/");
  if (namespace.length === 0 || segments.some((s) => s.length === 0 || isDotSegment(s))) {
    throw new ConfigurationError(
      `Invalid namespace ${JSON.stringify(namespace)}: use non-empty segments separated by "/", without "." or ".."`,
    );
  }
  return namespace;
}
```

- [x] **Step 4: Run to verify it passes**

Run: `npm test -w @ver2/sdk -- keys` → Expected: all pass.

- [x] **Step 5: Commit**

```bash
git add sdk/src/keys.ts sdk/test/keys.test.ts
git commit -m "feat(sdk): add key and namespace policy"
```

---

### Task 4: Version / operation IDs

**Files:**
- Create: `sdk/src/ids.ts`
- Test: `sdk/test/ids.test.ts`

- [x] **Step 1: Write the failing test**

`sdk/test/ids.test.ts`:
```ts
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
```

- [x] **Step 2: Run to verify it fails**

Run: `npm test -w @ver2/sdk -- ids` → Expected: FAIL, cannot resolve `../src/ids.js`.

- [x] **Step 3: Implement**

`sdk/src/ids.ts`:
```ts
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** Time-sortable unique id (ULID layout: 10 chars of milliseconds, 16 random chars). */
export function ulid(now: number = Date.now(), random: (n: number) => Uint8Array = randomBytes): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = random(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += ALPHABET[(bytes[i] ?? 0) % 32];
  return time + rand;
}
```

- [x] **Step 4: Run to verify it passes**

Run: `npm test -w @ver2/sdk -- ids` → Expected: all pass.

- [x] **Step 5: Commit**

```bash
git add sdk/src/ids.ts sdk/test/ids.test.ts
git commit -m "feat(sdk): add ULID generator"
```

---

### Task 5: Hashing

**Files:**
- Create: `sdk/src/hash.ts`
- Test: `sdk/test/hash.test.ts`

- [x] **Step 1: Confirm the `@noble/hashes` import paths**

Run: `node -e "import('@noble/hashes/sha2.js').then(m=>console.log(typeof m.sha256))"`
Expected: `function`. (If it prints an error, run `npm ls @noble/hashes` and adjust both imports in Step 3 to that version's documented paths.)

- [x] **Step 2: Write the failing test**

`sdk/test/hash.test.ts`:
```ts
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
```

- [x] **Step 3: Implement**

`sdk/src/hash.ts`:
```ts
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const encoder = new TextEncoder();

export const toBytes = (data: Uint8Array | string): Uint8Array => (typeof data === "string" ? encoder.encode(data) : data);

export const sha256Hex = (data: Uint8Array): string => bytesToHex(sha256(data));

/** Hash a stream without holding it in memory. Consumes the stream. */
export async function sha256OfStream(stream: ReadableStream<Uint8Array>): Promise<{ sha256: string; size: number }> {
  const h = sha256.create();
  let size = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    h.update(value);
    size += value.byteLength;
  }
  return { sha256: bytesToHex(h.digest()), size };
}

/** Pass-through stream that errors at the end if the content's SHA-256 is not `expected`. */
export function verifyingStream(expected: string, onMismatch: (actual: string) => Error): TransformStream<Uint8Array, Uint8Array> {
  const h = sha256.create();
  return new TransformStream({
    transform(chunk, controller) {
      h.update(chunk);
      controller.enqueue(chunk);
    },
    flush(controller) {
      const actual = bytesToHex(h.digest());
      if (actual !== expected) controller.error(onMismatch(actual));
    },
  });
}
```

- [x] **Step 4: Run tests**

Run: `npm test -w @ver2/sdk -- hash` → Expected: all pass.

- [x] **Step 5: Commit**

```bash
git add sdk/src/hash.ts sdk/test/hash.test.ts
git commit -m "feat(sdk): add SHA-256 helpers and verifying stream"
```

---

### Task 6: ObjectStore interface, in-memory store, contract suite

The memory store must behave like R2 did in the probes: exact conditional put/copy, `cf-copy-destination-*` honored, single-part copies keep the ETag, delete has no conditions. The contract suite runs against both stores (R2 in Task 7). That's how we keep the fake honest.

**Files:**
- Create: `sdk/src/storage/types.ts`, `sdk/src/storage/memory.ts`, `sdk/test/storage/contract.ts`
- Test: `sdk/test/storage/memory.test.ts`

- [x] **Step 1: Interface**

`sdk/src/storage/types.ts`:
```ts
export interface ObjectHeaders {
  contentType?: string;
  contentDisposition?: string;
  cacheControl?: string;
  contentEncoding?: string;
  contentLanguage?: string;
  metadata?: Record<string, string>;
}

export interface ObjectInfo {
  key: string;
  etag: string;
  size: number;
  lastModified: Date;
  headers: ObjectHeaders;
}

export interface PutOptions {
  headers?: ObjectHeaders;
  ifMatch?: string;
  ifNoneMatch?: "*";
}

export interface CopyOptions {
  sourceIfMatch?: string;
  /** R2 extension `cf-copy-destination-if-match`. */
  destIfMatch?: string;
  /** R2 extension `cf-copy-destination-if-none-match`. */
  destIfNoneMatch?: "*";
}

export interface GetOptions {
  ifMatch?: string;
}

export interface ListResult {
  keys: string[];
  cursor?: string;
}

/**
 * The only boundary that talks to object storage. Implementations must throw
 * StoreError for storage failures and return null for missing objects on head/get.
 */
export interface ObjectStore {
  head(key: string): Promise<ObjectInfo | null>;
  get(key: string, options?: GetOptions): Promise<{ info: ObjectInfo; body: ReadableStream<Uint8Array> } | null>;
  put(key: string, body: Uint8Array, options?: PutOptions): Promise<{ etag: string }>;
  /** Copies bytes and headers unchanged (metadata directive COPY). */
  copy(sourceKey: string, destKey: string, options?: CopyOptions): Promise<{ etag: string }>;
  /** Unconditional: R2 ignores If-Match on DeleteObject. */
  delete(key: string): Promise<void>;
  list(prefix: string, options?: { cursor?: string; limit?: number }): Promise<ListResult>;
}

export type StoreErrorKind = "precondition-failed" | "not-found" | "rate-limited" | "other";

export class StoreError extends Error {
  readonly kind: StoreErrorKind;
  readonly status: number | undefined;

  constructor(kind: StoreErrorKind, message: string, status?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StoreError";
    this.kind = kind;
    this.status = status;
  }
}

export const isPreconditionFailed = (e: unknown): boolean => e instanceof StoreError && e.kind === "precondition-failed";
```

- [x] **Step 2: Contract suite**

`sdk/test/storage/contract.ts`:
```ts
import { describe, expect, it } from "vitest";
import { type ObjectStore, StoreError } from "../../src/storage/types.js";

export interface ContractTarget {
  store: ObjectStore;
  /** Prefix every key with this so runs against a shared bucket don't collide. */
  prefix: string;
}

const enc = (s: string) => new TextEncoder().encode(s);
const text = (s: ReadableStream<Uint8Array>) => new Response(s).text();
const BOGUS = '"00000000000000000000000000000000"';

async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof StoreError ? e.kind : `unexpected ${String(e)}`;
  }
}

export function objectStoreContract(name: string, setup: () => ContractTarget) {
  describe(`ObjectStore contract: ${name}`, () => {
    it("put then head reports etag, size and headers", async () => {
      const { store, prefix } = setup();
      const k = `${prefix}contract/basic`;
      const { etag } = await store.put(k, enc("hello"), {
        headers: { contentType: "text/plain", cacheControl: "max-age=60", metadata: { owner: "ver2" } },
      });
      const info = await store.head(k);
      expect(info?.etag).toBe(etag);
      expect(info?.size).toBe(5);
      expect(info?.headers).toMatchObject({ contentType: "text/plain", cacheControl: "max-age=60", metadata: { owner: "ver2" } });
    });

    it("head and get of a missing key return null", async () => {
      const { store, prefix } = setup();
      expect(await store.head(`${prefix}contract/missing`)).toBeNull();
      expect(await store.get(`${prefix}contract/missing`)).toBeNull();
    });

    it("get returns the bytes and honors ifMatch", async () => {
      const { store, prefix } = setup();
      const k = `${prefix}contract/get`;
      const { etag } = await store.put(k, enc("body"));
      const res = await store.get(k, { ifMatch: etag });
      expect(await text(res!.body)).toBe("body");
      expect(await failure(store.get(k, { ifMatch: BOGUS }))).toBe("precondition-failed");
    });

    it("put ifNoneMatch '*' only creates", async () => {
      const { store, prefix } = setup();
      const k = `${prefix}contract/create`;
      expect(await failure(store.put(k, enc("first"), { ifNoneMatch: "*" }))).toBe("ok");
      expect(await failure(store.put(k, enc("second"), { ifNoneMatch: "*" }))).toBe("precondition-failed");
      expect(await text((await store.get(k))!.body)).toBe("first");
    });

    it("put ifMatch overwrites only the expected version", async () => {
      const { store, prefix } = setup();
      const k = `${prefix}contract/if-match`;
      const { etag } = await store.put(k, enc("v1"));
      expect(await failure(store.put(k, enc("v2"), { ifMatch: etag }))).toBe("ok");
      expect(await failure(store.put(k, enc("v3"), { ifMatch: etag }))).toBe("precondition-failed");
      expect(await failure(store.put(`${prefix}contract/if-match-missing`, enc("x"), { ifMatch: etag }))).toBe(
        "precondition-failed",
      );
      expect(await text((await store.get(k))!.body)).toBe("v2");
    });

    it("identical bytes produce identical etags", async () => {
      const { store, prefix } = setup();
      const a = await store.put(`${prefix}contract/same-a`, enc("same"));
      const b = await store.put(`${prefix}contract/same-b`, enc("same"));
      expect(a.etag).toBe(b.etag);
    });

    it("copy preserves bytes, headers and the single-part etag", async () => {
      const { store, prefix } = setup();
      const src = `${prefix}contract/copy-src`;
      const dst = `${prefix}contract/copy-dst`;
      const headers = { contentType: "image/png", contentDisposition: 'inline; filename="a.png"', metadata: { rev: "7" } };
      const { etag } = await store.put(src, enc("payload"), { headers });
      expect((await store.copy(src, dst)).etag).toBe(etag);
      expect((await store.head(dst))?.headers).toMatchObject(headers);
      expect(await text((await store.get(dst))!.body)).toBe("payload");
    });

    it("copy sourceIfMatch rejects a changed source", async () => {
      const { store, prefix } = setup();
      const src = `${prefix}contract/src-cond`;
      const dst = `${prefix}contract/src-cond-dst`;
      await store.put(src, enc("x"));
      expect(await failure(store.copy(src, dst, { sourceIfMatch: BOGUS }))).toBe("precondition-failed");
      expect(await store.head(dst)).toBeNull();
    });

    it("copy destIfNoneMatch '*' never overwrites", async () => {
      const { store, prefix } = setup();
      const src = `${prefix}contract/dnm-src`;
      const dst = `${prefix}contract/dnm-dst`;
      await store.put(src, enc("SOURCE"));
      await store.put(dst, enc("ORIGINAL"));
      expect(await failure(store.copy(src, dst, { destIfNoneMatch: "*" }))).toBe("precondition-failed");
      expect(await text((await store.get(dst))!.body)).toBe("ORIGINAL");
      expect(await failure(store.copy(src, `${prefix}contract/dnm-absent`, { destIfNoneMatch: "*" }))).toBe("ok");
    });

    it("copy destIfMatch guards the destination", async () => {
      const { store, prefix } = setup();
      const src = `${prefix}contract/dm-src`;
      const dst = `${prefix}contract/dm-dst`;
      await store.put(src, enc("SOURCE"));
      const { etag } = await store.put(dst, enc("ORIGINAL"));
      expect(await failure(store.copy(src, dst, { destIfMatch: BOGUS }))).toBe("precondition-failed");
      expect(await text((await store.get(dst))!.body)).toBe("ORIGINAL");
      expect(await failure(store.copy(src, dst, { destIfMatch: etag }))).toBe("ok");
      expect(await text((await store.get(dst))!.body)).toBe("SOURCE");
    });

    it("copy of a missing source is not-found", async () => {
      const { store, prefix } = setup();
      expect(await failure(store.copy(`${prefix}contract/nope`, `${prefix}contract/nope-dst`))).toBe("not-found");
    });

    it("delete removes the key and tolerates missing keys", async () => {
      const { store, prefix } = setup();
      const k = `${prefix}contract/delete`;
      await store.put(k, enc("x"));
      await store.delete(k);
      expect(await store.head(k)).toBeNull();
      await expect(store.delete(k)).resolves.toBeUndefined();
    });

    it("list pages through keys under a prefix", async () => {
      const { store, prefix } = setup();
      const base = `${prefix}contract/list/`;
      for (const n of ["a", "b", "c"]) await store.put(base + n, enc(n));
      const first = await store.list(base, { limit: 2 });
      expect(first.keys).toEqual([`${base}a`, `${base}b`]);
      expect(first.cursor).toBeDefined();
      const second = await store.list(base, { limit: 2, cursor: first.cursor });
      expect(second.keys).toEqual([`${base}c`]);
      expect(second.cursor).toBeUndefined();
    });
  });
}
```

- [x] **Step 3: Write the failing memory test**

`sdk/test/storage/memory.test.ts`:
```ts
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
```

Run: `npm test -w @ver2/sdk -- storage` → Expected: FAIL, cannot resolve `../../src/storage/memory.js`.

- [x] **Step 4: Implement the memory store**

`sdk/src/storage/memory.ts`:
```ts
import { sha256Hex, toBytes } from "../hash.js";
import {
  type CopyOptions,
  type GetOptions,
  type ListResult,
  type ObjectHeaders,
  type ObjectInfo,
  type ObjectStore,
  type PutOptions,
  StoreError,
} from "./types.js";

export type StoreOp = "head" | "get" | "put" | "copy" | "delete" | "list";

/**
 * Called around every operation. Throw in "before" to fail the request; throw
 * in "after" to simulate a request that succeeded but whose response was lost.
 * `copy` reports the destination key; `list` reports the prefix.
 */
export type FaultHook = (op: StoreOp, key: string, phase: "before" | "after") => void;

interface Entry {
  bytes: Uint8Array;
  etag: string;
  headers: ObjectHeaders;
  lastModified: Date;
}

const etagOf = (bytes: Uint8Array) => `"${sha256Hex(bytes).slice(0, 32)}"`;
const precondition = (key: string) => new StoreError("precondition-failed", `precondition failed for ${key}`, 412);

function info(key: string, e: Entry): ObjectInfo {
  return { key, etag: e.etag, size: e.bytes.byteLength, lastModified: e.lastModified, headers: structuredClone(e.headers) };
}

/** In-memory ObjectStore with R2's verified semantics plus fault injection. For tests and local experiments. */
export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, Entry>();
  fault: FaultHook | undefined;

  constructor(options: { fault?: FaultHook } = {}) {
    this.fault = options.fault;
  }

  /** Write straight into the bucket, bypassing faults and conditions: simulates a non-veR2 client. */
  putDirect(key: string, data: Uint8Array | string, headers: ObjectHeaders = {}): string {
    const bytes = toBytes(data).slice();
    const etag = etagOf(bytes);
    this.objects.set(key, { bytes, etag, headers: structuredClone(headers), lastModified: new Date() });
    return etag;
  }

  private async run<T>(op: StoreOp, key: string, fn: () => T): Promise<T> {
    this.fault?.(op, key, "before");
    const result = fn();
    this.fault?.(op, key, "after");
    return result;
  }

  head(key: string): Promise<ObjectInfo | null> {
    return this.run("head", key, () => {
      const e = this.objects.get(key);
      return e ? info(key, e) : null;
    });
  }

  get(key: string, options: GetOptions = {}): Promise<{ info: ObjectInfo; body: ReadableStream<Uint8Array> } | null> {
    return this.run("get", key, () => {
      const e = this.objects.get(key);
      if (!e) return null;
      if (options.ifMatch !== undefined && options.ifMatch !== e.etag) throw precondition(key);
      const bytes = e.bytes.slice();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(bytes);
          c.close();
        },
      });
      return { info: info(key, e), body };
    });
  }

  put(key: string, body: Uint8Array, options: PutOptions = {}): Promise<{ etag: string }> {
    return this.run("put", key, () => {
      const existing = this.objects.get(key);
      if (options.ifNoneMatch === "*" && existing) throw precondition(key);
      if (options.ifMatch !== undefined && existing?.etag !== options.ifMatch) throw precondition(key);
      const bytes = body.slice();
      const entry: Entry = { bytes, etag: etagOf(bytes), headers: structuredClone(options.headers ?? {}), lastModified: new Date() };
      this.objects.set(key, entry);
      return { etag: entry.etag };
    });
  }

  copy(sourceKey: string, destKey: string, options: CopyOptions = {}): Promise<{ etag: string }> {
    return this.run("copy", destKey, () => {
      const src = this.objects.get(sourceKey);
      if (!src) throw new StoreError("not-found", `no such key ${sourceKey}`, 404);
      if (options.sourceIfMatch !== undefined && options.sourceIfMatch !== src.etag) throw precondition(sourceKey);
      const dst = this.objects.get(destKey);
      if (options.destIfNoneMatch === "*" && dst) throw precondition(destKey);
      if (options.destIfMatch !== undefined && dst?.etag !== options.destIfMatch) throw precondition(destKey);
      this.objects.set(destKey, {
        bytes: src.bytes.slice(),
        etag: src.etag,
        headers: structuredClone(src.headers),
        lastModified: new Date(),
      });
      return { etag: src.etag };
    });
  }

  delete(key: string): Promise<void> {
    return this.run("delete", key, () => {
      this.objects.delete(key);
    });
  }

  list(prefix: string, options: { cursor?: string; limit?: number } = {}): Promise<ListResult> {
    return this.run("list", prefix, () => {
      const after = options.cursor;
      const limit = options.limit ?? 1000;
      const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix) && (after === undefined || k > after)).sort();
      const page = keys.slice(0, limit);
      return { keys: page, cursor: keys.length > limit ? page[page.length - 1] : undefined };
    });
  }
}
```

- [x] **Step 5: Run tests**

Run: `npm test -w @ver2/sdk -- storage` → Expected: contract (13) + extras (4) pass.
Run: `npm run typecheck -w @ver2/sdk` → Expected: exit 0.

- [x] **Step 6: Commit**

```bash
git add sdk/src/storage sdk/test/storage
git commit -m "feat(sdk): add ObjectStore interface, memory store and contract suite"
```

---

### Task 7: S3ObjectStore for R2

**Files:**
- Create: `sdk/src/storage/s3.ts`, `sdk/test/integration/env.ts`
- Test: `sdk/test/integration/s3-store.test.ts`

- [x] **Step 1: Dependencies**

Run:
```bash
npm i -D -w @ver2/sdk @aws-sdk/client-s3
```
Then add to `sdk/package.json` (keeps the AWS SDK optional for Workers users who will use the binding driver later):
```json
  "peerDependencies": { "@aws-sdk/client-s3": "^3.700.0" },
  "peerDependenciesMeta": { "@aws-sdk/client-s3": { "optional": true } }
```

- [x] **Step 2: Integration env + failing test**

`sdk/test/integration/env.ts`:
```ts
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { S3ObjectStore } from "../../src/storage/s3.js";
import type { ObjectStore } from "../../src/storage/types.js";

// Credentials live in the repo-root .env.local (never committed).
const root = fileURLToPath(new URL("../../../", import.meta.url));
for (const f of [".env.local", ".env"]) if (existsSync(root + f)) process.loadEnvFile(root + f);

const env = process.env;
export const hasR2 = Boolean(
  env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && (env.R2_ACCOUNT_ID || env.R2_ENDPOINT),
);

/** Unique per run so concurrent CI runs never collide. */
export const runPrefix = `ver2-it/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}/`;

export function makeS3Store(): S3ObjectStore {
  return new S3ObjectStore({
    bucket: env.R2_BUCKET ?? "",
    accountId: env.R2_ACCOUNT_ID || undefined,
    endpoint: env.R2_ENDPOINT || undefined,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID ?? "", secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "" },
  });
}

export async function cleanup(store: ObjectStore, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await store.list(prefix, { cursor });
    for (const key of page.keys) await store.delete(key);
    cursor = page.cursor;
  } while (cursor);
}
```

`sdk/test/integration/s3-store.test.ts`:
```ts
import { afterAll, describe } from "vitest";
import type { S3ObjectStore } from "../../src/storage/s3.js";
import { objectStoreContract } from "../storage/contract.js";
import { cleanup, hasR2, makeS3Store, runPrefix } from "./env.js";

describe.skipIf(!hasR2)("S3ObjectStore against R2", () => {
  const store = hasR2 ? makeS3Store() : (undefined as unknown as S3ObjectStore);
  afterAll(() => cleanup(store, runPrefix));
  objectStoreContract("s3 (R2)", () => ({ store, prefix: runPrefix }));
});
```

Run: `npm test -w @ver2/sdk -- integration` → Expected: FAIL, cannot resolve `../../src/storage/s3.js`.

- [x] **Step 3: Implement**

`sdk/src/storage/s3.ts`:
```ts
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { ConfigurationError } from "../errors.js";
import {
  type CopyOptions,
  type GetOptions,
  type ListResult,
  type ObjectHeaders,
  type ObjectInfo,
  type ObjectStore,
  type PutOptions,
  StoreError,
} from "./types.js";

export interface S3StoreOptions {
  bucket: string;
  /** Cloudflare account id; derives https://<accountId>.r2.cloudflarestorage.com when `endpoint` is not set. */
  accountId?: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  /** Bring your own client (custom retries, request handler). Overrides endpoint and credentials. */
  client?: S3Client;
}

interface HeadLike {
  ETag?: string;
  ContentLength?: number;
  LastModified?: Date;
  ContentType?: string;
  ContentDisposition?: string;
  CacheControl?: string;
  ContentEncoding?: string;
  ContentLanguage?: string;
  Metadata?: Record<string, string>;
}

const compact = (h: ObjectHeaders): ObjectHeaders =>
  Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined)) as ObjectHeaders;

function toInfo(key: string, res: HeadLike): ObjectInfo {
  return {
    key,
    etag: res.ETag ?? "",
    size: res.ContentLength ?? 0,
    lastModified: res.LastModified ?? new Date(0),
    headers: compact({
      contentType: res.ContentType,
      contentDisposition: res.ContentDisposition,
      cacheControl: res.CacheControl,
      contentEncoding: res.ContentEncoding,
      contentLanguage: res.ContentLanguage,
      metadata: res.Metadata ?? {},
    }),
  };
}

/** R2 HEAD errors carry no error code, so classify by HTTP status. */
function toStoreError(e: unknown): StoreError {
  const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  const kind =
    status === 412 ? "precondition-failed" : status === 404 ? "not-found" : status === 429 ? "rate-limited" : "other";
  return new StoreError(kind, e instanceof Error ? e.message : String(e), status, { cause: e });
}

const copySource = (bucket: string, key: string) => `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

/** Attach headers the SDK input types don't model (R2's cf-copy-destination-*). Added before signing. */
function withHeaders(cmd: CopyObjectCommand, headers: Record<string, string>): CopyObjectCommand {
  if (Object.keys(headers).length === 0) return cmd;
  cmd.middlewareStack.add(
    (next) => async (args) => {
      const request = args.request as { headers?: Record<string, string> };
      if (request.headers) Object.assign(request.headers, headers);
      return next(args);
    },
    { step: "build", name: "ver2CopyDestinationConditions" },
  );
  return cmd;
}

/** ObjectStore over the S3 API, tuned for Cloudflare R2. */
export class S3ObjectStore implements ObjectStore {
  readonly bucket: string;
  private readonly client: S3Client;

  constructor(options: S3StoreOptions) {
    if (!options.bucket) throw new ConfigurationError("S3ObjectStore: bucket is required");
    this.bucket = options.bucket;
    if (options.client) {
      this.client = options.client;
      return;
    }
    const endpoint =
      options.endpoint ?? (options.accountId ? `https://${options.accountId}.r2.cloudflarestorage.com` : undefined);
    if (!endpoint) throw new ConfigurationError("S3ObjectStore: endpoint or accountId is required");
    this.client = new S3Client({
      region: "auto",
      endpoint,
      credentials: options.credentials,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      return toInfo(key, await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })));
    } catch (e) {
      const err = toStoreError(e);
      if (err.kind === "not-found") return null;
      throw err;
    }
  }

  async get(key: string, options: GetOptions = {}): Promise<{ info: ObjectInfo; body: ReadableStream<Uint8Array> } | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, IfMatch: options.ifMatch }));
      if (!res.Body) throw new StoreError("other", `GetObject returned no body for ${key}`);
      return { info: toInfo(key, res), body: res.Body.transformToWebStream() as ReadableStream<Uint8Array> };
    } catch (e) {
      if (e instanceof StoreError) throw e;
      const err = toStoreError(e);
      if (err.kind === "not-found") return null;
      throw err;
    }
  }

  async put(key: string, body: Uint8Array, options: PutOptions = {}): Promise<{ etag: string }> {
    const h = options.headers ?? {};
    try {
      const res = await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: h.contentType,
          ContentDisposition: h.contentDisposition,
          CacheControl: h.cacheControl,
          ContentEncoding: h.contentEncoding,
          ContentLanguage: h.contentLanguage,
          Metadata: h.metadata,
          IfMatch: options.ifMatch,
          IfNoneMatch: options.ifNoneMatch,
        }),
      );
      return { etag: res.ETag ?? "" };
    } catch (e) {
      throw toStoreError(e);
    }
  }

  async copy(sourceKey: string, destKey: string, options: CopyOptions = {}): Promise<{ etag: string }> {
    const extra: Record<string, string> = {};
    if (options.destIfMatch !== undefined) extra["cf-copy-destination-if-match"] = options.destIfMatch;
    if (options.destIfNoneMatch !== undefined) extra["cf-copy-destination-if-none-match"] = options.destIfNoneMatch;
    const cmd = new CopyObjectCommand({
      Bucket: this.bucket,
      Key: destKey,
      CopySource: copySource(this.bucket, sourceKey),
      CopySourceIfMatch: options.sourceIfMatch,
      MetadataDirective: "COPY",
    });
    try {
      const res = await this.client.send(withHeaders(cmd, extra));
      return { etag: res.CopyObjectResult?.ETag ?? "" };
    } catch (e) {
      throw toStoreError(e);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (e) {
      throw toStoreError(e);
    }
  }

  async list(prefix: string, options: { cursor?: string; limit?: number } = {}): Promise<ListResult> {
    try {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: options.cursor, MaxKeys: options.limit }),
      );
      return {
        keys: (res.Contents ?? []).flatMap((o) => (o.Key ? [o.Key] : [])),
        cursor: res.IsTruncated ? res.NextContinuationToken : undefined,
      };
    } catch (e) {
      throw toStoreError(e);
    }
  }
}
```

- [x] **Step 4: Run tests**

Run: `npm run typecheck -w @ver2/sdk` → Expected: exit 0.
Run: `npm test -w @ver2/sdk -- integration` → Expected with `.env.local` present: 13 passed. Without credentials: skipped.

- [x] **Step 5: Commit**

```bash
git add sdk/package.json package-lock.json sdk/src/storage/s3.ts sdk/test/integration
git commit -m "feat(sdk): add S3ObjectStore for R2 and run the contract suite against R2"
```

---

### Task 8: Layout, manifest types, manifests-in-R2 store

**Files:**
- Create: `sdk/src/layout.ts`, `sdk/src/meta/types.ts`, `sdk/src/meta/object-store-manifests.ts`
- Test: `sdk/test/meta/manifests.test.ts`

- [x] **Step 1: Layout and types**

`sdk/src/layout.ts`:
```ts
import { sha256Hex, toBytes } from "./hash.js";

export interface Layout {
  manifestPrefix: string;
  manifestKey(key: string): string;
  versionKey(key: string, versionId: string): string;
}

/** Where veR2 keeps its own objects inside the bucket. */
export function layout(namespace: string): Layout {
  return {
    manifestPrefix: `${namespace}/m/`,
    manifestKey: (key) => `${namespace}/m/${key}`,
    // Hashing the key keeps version paths short no matter how long the key is.
    versionKey: (key, versionId) => `${namespace}/o/${sha256Hex(toBytes(key))}/${versionId}`,
  };
}
```

`sdk/src/meta/types.ts`:
```ts
import type { ObjectHeaders } from "../storage/types.js";

export interface VersionRecord {
  versionId: string;
  kind: "put" | "delete";
  /** put: where the bytes live. Restores share the object of the version they restore. */
  objectKey?: string;
  sha256?: string;
  size?: number;
  /** ETag of `objectKey`. */
  etag?: string;
  headers?: ObjectHeaders;
  /** ver2: written through veR2 · external: adopted from a direct bucket write · restore: re-promoted. */
  source: "ver2" | "external" | "restore";
  restoredFrom?: string;
  createdAt: string;
}

/** The journal entry for an in-flight operation. Its presence locks the key. */
export interface PendingOp {
  opId: string;
  type: "put" | "delete" | "restore";
  /** The record to append on commit (`etag` may be filled in at commit time). */
  record: VersionRecord;
  /** ETag of the live object when the op started; null if absent. */
  expectedLiveEtag: string | null;
  startedAt: string;
  /** Set when recovery could not decide. Needs `reconcile --accept-live`. */
  stuck?: string;
}

export interface Manifest {
  schema: 1;
  key: string;
  current: string | null;
  liveEtag: string | null;
  versions: VersionRecord[];
  pending: PendingOp | null;
}

export interface ManifestSnapshot {
  manifest: Manifest;
  /** Opaque revision for compare-and-swap. */
  rev: string;
}

export class MetaConflictError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`manifest for ${JSON.stringify(key)} changed concurrently`);
    this.name = "MetaConflictError";
    this.key = key;
  }
}

/** Per-key manifest storage with compare-and-swap. */
export interface MetadataStore {
  read(key: string): Promise<ManifestSnapshot | null>;
  /** Write if the stored revision is `expectedRev` (null = must not exist). Returns the new revision. */
  write(key: string, manifest: Manifest, expectedRev: string | null): Promise<string>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ keys: string[]; cursor?: string }>;
}

export const emptyManifest = (key: string): Manifest => ({
  schema: 1,
  key,
  current: null,
  liveEtag: null,
  versions: [],
  pending: null,
});
```

- [x] **Step 2: Write the failing test**

`sdk/test/meta/manifests.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { layout } from "../../src/layout.js";
import { ObjectStoreManifests } from "../../src/meta/object-store-manifests.js";
import { emptyManifest, MetaConflictError } from "../../src/meta/types.js";
import { MemoryObjectStore } from "../../src/storage/memory.js";

function setup() {
  const store = new MemoryObjectStore();
  return { store, meta: new ObjectStoreManifests(store, layout(".ver2")) };
}

describe("ObjectStoreManifests", () => {
  it("reads null for an unknown key", async () => {
    expect(await setup().meta.read("a")).toBeNull();
  });

  it("creates with expectedRev null and reads back", async () => {
    const { meta, store } = setup();
    const rev = await meta.write("docs/a.txt", emptyManifest("docs/a.txt"), null);
    expect(store.objects.has(".ver2/m/docs/a.txt")).toBe(true);
    expect(await meta.read("docs/a.txt")).toEqual({ manifest: emptyManifest("docs/a.txt"), rev });
  });

  it("refuses a second create", async () => {
    const { meta } = setup();
    await meta.write("a", emptyManifest("a"), null);
    await expect(meta.write("a", { ...emptyManifest("a"), current: "x" }, null)).rejects.toBeInstanceOf(MetaConflictError);
  });

  it("updates only from the current revision", async () => {
    const { meta } = setup();
    const rev1 = await meta.write("a", emptyManifest("a"), null);
    const rev2 = await meta.write("a", { ...emptyManifest("a"), current: "v1" }, rev1);
    await expect(meta.write("a", { ...emptyManifest("a"), current: "v2" }, rev1)).rejects.toBeInstanceOf(MetaConflictError);
    expect((await meta.read("a"))?.rev).toBe(rev2);
  });

  it("treats a retried write that already landed as success", async () => {
    const { meta } = setup();
    const rev1 = await meta.write("a", emptyManifest("a"), null);
    const next = { ...emptyManifest("a"), current: "v1" };
    const rev2 = await meta.write("a", next, rev1);
    expect(await meta.write("a", next, rev1)).toBe(rev2);
  });

  it("lists keys without the internal prefix", async () => {
    const { meta } = setup();
    for (const k of ["docs/a", "docs/b", "img/c"]) await meta.write(k, emptyManifest(k), null);
    expect((await meta.list()).keys).toEqual(["docs/a", "docs/b", "img/c"]);
    expect((await meta.list({ prefix: "docs/" })).keys).toEqual(["docs/a", "docs/b"]);
  });
});
```

Run: `npm test -w @ver2/sdk -- meta` → Expected: FAIL, cannot resolve `object-store-manifests.js`.

- [x] **Step 3: Implement**

`sdk/src/meta/object-store-manifests.ts`:
```ts
import { toBytes } from "../hash.js";
import type { Layout } from "../layout.js";
import { isPreconditionFailed, type ObjectStore } from "../storage/types.js";
import { type Manifest, type ManifestSnapshot, MetaConflictError, type MetadataStore } from "./types.js";

/** Manifests stored as JSON objects in the bucket; the object ETag is the CAS revision. */
export class ObjectStoreManifests implements MetadataStore {
  private readonly store: ObjectStore;
  private readonly paths: Layout;

  constructor(store: ObjectStore, paths: Layout) {
    this.store = store;
    this.paths = paths;
  }

  async read(key: string): Promise<ManifestSnapshot | null> {
    const res = await this.store.get(this.paths.manifestKey(key));
    if (!res) return null;
    return { manifest: JSON.parse(await new Response(res.body).text()) as Manifest, rev: res.info.etag };
  }

  async write(key: string, manifest: Manifest, expectedRev: string | null): Promise<string> {
    const condition = expectedRev === null ? { ifNoneMatch: "*" as const } : { ifMatch: expectedRev };
    try {
      const { etag } = await this.store.put(this.paths.manifestKey(key), toBytes(JSON.stringify(manifest)), {
        headers: { contentType: "application/json" },
        ...condition,
      });
      return etag;
    } catch (e) {
      if (!isPreconditionFailed(e)) throw e;
      // A retried request can fail its precondition because its first attempt landed.
      const current = await this.read(key);
      if (current && JSON.stringify(current.manifest) === JSON.stringify(manifest)) return current.rev;
      throw new MetaConflictError(key);
    }
  }

  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}): Promise<{ keys: string[]; cursor?: string }> {
    const base = this.paths.manifestPrefix;
    const page = await this.store.list(base + (options.prefix ?? ""), { cursor: options.cursor, limit: options.limit });
    return { keys: page.keys.map((k) => k.slice(base.length)), cursor: page.cursor };
  }
}
```

- [x] **Step 4: Run tests**

Run: `npm test -w @ver2/sdk -- meta` → Expected: 6 passed.

- [x] **Step 5: Commit**

```bash
git add sdk/src/layout.ts sdk/src/meta sdk/test/meta
git commit -m "feat(sdk): add manifest types and manifests-in-bucket metadata store"
```

---

### Task 9: Engine context, commit helper, live-state sync

`syncLive` brings the manifest in line with what is actually at the live key before any write: it adopts direct writes as `external` versions and records direct deletes.

**Files:**
- Create: `sdk/src/engine/context.ts`, `sdk/src/engine/manifest.ts`, `sdk/src/engine/live.ts`, `sdk/test/helpers.ts`
- Test: `sdk/test/engine/live.test.ts`

- [x] **Step 1: Context and commit helper**

`sdk/src/engine/context.ts`:
```ts
import type { KeyPolicy } from "../keys.js";
import type { Layout } from "../layout.js";
import type { MetadataStore } from "../meta/types.js";
import type { ObjectStore } from "../storage/types.js";

export interface EngineContext {
  store: ObjectStore;
  meta: MetadataStore;
  paths: Layout;
  policy: KeyPolicy;
  /** A pending op older than this is presumed crashed and may be recovered. */
  leaseMs: number;
  now: () => Date;
  newId: () => string;
}
```

`sdk/src/engine/manifest.ts`:
```ts
import { ConcurrencyConflictError } from "../errors.js";
import { type Manifest, MetaConflictError } from "../meta/types.js";
import type { EngineContext } from "./context.js";

/** CAS-write a manifest, translating a lost race into ConcurrencyConflictError. */
export async function commit(ctx: EngineContext, key: string, manifest: Manifest, rev: string | null): Promise<string> {
  try {
    return await ctx.meta.write(key, manifest, rev);
  } catch (e) {
    if (e instanceof MetaConflictError) throw new ConcurrencyConflictError(key, "the manifest changed concurrently");
    throw e;
  }
}
```

- [x] **Step 2: Test harness**

`sdk/test/helpers.ts`:
```ts
import type { EngineContext } from "../src/engine/context.js";
import { layout } from "../src/layout.js";
import { ObjectStoreManifests } from "../src/meta/object-store-manifests.js";
import type { Manifest } from "../src/meta/types.js";
import { type FaultHook, MemoryObjectStore, type StoreOp } from "../src/storage/memory.js";

export const KEY = "doc.txt";
export const MANIFEST_KEY = `.ver2/m/${KEY}`;

export const enc = (s: string) => new TextEncoder().encode(s);

/** Read a stream to a string, propagating the stream's own error unchanged (Response may wrap it). */
export async function text(s: ReadableStream<Uint8Array>): Promise<string> {
  const reader = s.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out + decoder.decode();
    out += decoder.decode(value, { stream: true });
  }
}

/** Deterministic engine context over a fresh in-memory bucket. */
export function setup(options: { fault?: FaultHook } = {}) {
  const store = new MemoryObjectStore(options);
  const paths = layout(".ver2");
  let t = Date.parse("2026-01-01T00:00:00.000Z");
  let n = 0;
  const ctx: EngineContext = {
    store,
    meta: new ObjectStoreManifests(store, paths),
    paths,
    policy: { namespace: ".ver2" },
    leaseMs: 60_000,
    now: () => new Date(t),
    newId: () => `id${String(++n).padStart(4, "0")}`,
  };
  return {
    ctx,
    store,
    advance: (ms: number) => {
      t += ms;
    },
    live: (key = KEY) => {
      const e = store.objects.get(key);
      return e ? new TextDecoder().decode(e.bytes) : null;
    },
    manifest: async (key = KEY): Promise<Manifest | undefined> => (await ctx.meta.read(key))?.manifest,
    versionObjects: () => [...store.objects.keys()].filter((k) => k.startsWith(".ver2/o/")),
  };
}

/** Throw once, on the nth matching store call. */
export function crashOn(
  store: MemoryObjectStore,
  match: (op: StoreOp, key: string, phase: "before" | "after") => boolean,
  nth = 1,
  error: Error = new Error("simulated crash"),
) {
  let seen = 0;
  store.fault = (op, key, phase) => {
    if (match(op, key, phase) && ++seen === nth) {
      store.fault = undefined;
      throw error;
    }
  };
}
```

- [x] **Step 3: Write the failing test**

`sdk/test/engine/live.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { syncLive } from "../../src/engine/live.js";
import { ConcurrencyConflictError } from "../../src/errors.js";
import { emptyManifest } from "../../src/meta/types.js";
import { KEY, setup, text } from "../helpers.js";

describe("syncLive", () => {
  it("leaves a manifest alone when live matches", async () => {
    const t = setup();
    const etag = t.store.putDirect(KEY, "x");
    const manifest = { ...emptyManifest(KEY), liveEtag: etag, current: "v1" };
    expect(await syncLive(t.ctx, KEY, manifest, await t.store.head(KEY))).toBe(manifest);
  });

  it("leaves a manifest alone when nothing exists", async () => {
    const t = setup();
    const manifest = emptyManifest(KEY);
    expect(await syncLive(t.ctx, KEY, manifest, null)).toBe(manifest);
  });

  it("adopts a direct write as an external version", async () => {
    const t = setup();
    t.store.putDirect(KEY, "direct", { contentType: "text/plain" });
    const live = await t.store.head(KEY);
    const next = await syncLive(t.ctx, KEY, emptyManifest(KEY), live);
    const [record] = next.versions;
    expect(record).toMatchObject({ kind: "put", source: "external", size: 6, headers: { contentType: "text/plain" } });
    expect(next.current).toBe(record?.versionId);
    expect(next.liveEtag).toBe(live?.etag);
    expect(await text((await t.store.get(record!.objectKey!))!.body)).toBe("direct");
  });

  it("records a direct delete as an external delete marker", async () => {
    const t = setup();
    const next = await syncLive(t.ctx, KEY, { ...emptyManifest(KEY), current: "v1", liveEtag: '"gone"' }, null);
    expect(next.versions.at(-1)).toMatchObject({ kind: "delete", source: "external" });
    expect(next).toMatchObject({ current: null, liveEtag: null });
  });

  it("refuses to adopt an object that changes during the copy", async () => {
    const t = setup();
    t.store.putDirect(KEY, "first");
    const live = await t.store.head(KEY);
    t.store.fault = (op, _key, phase) => {
      if (op === "copy" && phase === "before") {
        t.store.fault = undefined;
        t.store.putDirect(KEY, "second");
      }
    };
    await expect(syncLive(t.ctx, KEY, emptyManifest(KEY), live)).rejects.toBeInstanceOf(ConcurrencyConflictError);
  });
});
```

Run: `npm test -w @ver2/sdk -- live` → Expected: FAIL, cannot resolve `../../src/engine/live.js`.

- [x] **Step 4: Implement**

`sdk/src/engine/live.ts`:
```ts
import { ConcurrencyConflictError } from "../errors.js";
import { sha256OfStream } from "../hash.js";
import type { Manifest, VersionRecord } from "../meta/types.js";
import { isPreconditionFailed, type ObjectInfo, StoreError } from "../storage/types.js";
import type { EngineContext } from "./context.js";

/**
 * Reconcile the manifest with the object actually at `key` (`live`, from a HEAD).
 * Direct writes become `external` versions (bytes preserved first); direct deletes
 * become `external` delete markers. Returns the same manifest when nothing changed.
 */
export async function syncLive(ctx: EngineContext, key: string, manifest: Manifest, live: ObjectInfo | null): Promise<Manifest> {
  if (live === null) {
    if (manifest.liveEtag === null) return manifest;
    const marker: VersionRecord = {
      versionId: ctx.newId(),
      kind: "delete",
      source: "external",
      createdAt: ctx.now().toISOString(),
    };
    return { ...manifest, versions: [...manifest.versions, marker], current: null, liveEtag: null };
  }
  if (live.etag === manifest.liveEtag) return manifest;

  const versionId = ctx.newId();
  const objectKey = ctx.paths.versionKey(key, versionId);
  let etag: string;
  try {
    ({ etag } = await ctx.store.copy(key, objectKey, { sourceIfMatch: live.etag, destIfNoneMatch: "*" }));
  } catch (e) {
    if (isPreconditionFailed(e)) throw new ConcurrencyConflictError(key, "the live object changed while it was being preserved");
    throw e;
  }
  const preserved = await ctx.store.get(objectKey);
  if (!preserved) throw new StoreError("other", `preserved copy ${objectKey} disappeared`);
  const { sha256, size } = await sha256OfStream(preserved.body);
  const record: VersionRecord = {
    versionId,
    kind: "put",
    objectKey,
    sha256,
    size,
    etag,
    headers: live.headers,
    source: "external",
    createdAt: live.lastModified.toISOString(),
  };
  return { ...manifest, versions: [...manifest.versions, record], current: versionId, liveEtag: live.etag };
}
```

- [x] **Step 5: Run tests and commit**

Run: `npm test -w @ver2/sdk -- live` → Expected: 5 passed.
```bash
git add sdk/src/engine sdk/test/helpers.ts sdk/test/engine/live.test.ts
git commit -m "feat(sdk): add engine context and live-state sync for direct writes"
```

---

### Task 10: Recovery and write admission

**Files:**
- Create: `sdk/src/engine/recover.ts`, `sdk/src/engine/claim.ts`
- Test: `sdk/test/engine/recover.test.ts` (written in Task 11, Step 5: it needs `put`/`remove` to create realistic crash states)

- [x] **Step 1: Implement recovery**

`sdk/src/engine/recover.ts`:
```ts
import type { Manifest, PendingOp } from "../meta/types.js";
import type { ObjectInfo } from "../storage/types.js";
import type { EngineContext } from "./context.js";
import { syncLive } from "./live.js";
import { commit } from "./manifest.js";

export type RecoveryOutcome = "none" | "in-progress" | "rolled-forward" | "rolled-back" | "stuck" | "accepted-live";

export interface RecoveryResult {
  key: string;
  outcome: RecoveryOutcome;
  opId?: string;
  reason?: string;
}

export interface RecoverOptions {
  /** Report what would happen without writing. */
  dryRun?: boolean;
  /** Resolve a stuck op by adopting whatever is live now as an external version. */
  acceptLive?: boolean;
}

interface Decision {
  outcome: "rolled-forward" | "rolled-back" | "stuck";
  next: Manifest;
  reason?: string;
  /** Uncommitted version object to delete after a roll-back. */
  orphan?: string;
}

/** Finish or undo an interrupted operation using only evidence from storage. `key` must be canonical. */
export async function recover(ctx: EngineContext, key: string, options: RecoverOptions = {}): Promise<RecoveryResult> {
  const snap = await ctx.meta.read(key);
  const op = snap?.manifest.pending;
  if (!snap || !op) return { key, outcome: "none" };
  const { manifest, rev } = snap;
  const live = await ctx.store.head(key);

  if (op.stuck) {
    if (!options.acceptLive) return { key, outcome: "stuck", opId: op.opId, reason: op.stuck };
    if (!options.dryRun) await commit(ctx, key, await syncLive(ctx, key, { ...manifest, pending: null }, live), rev);
    return { key, outcome: "accepted-live", opId: op.opId };
  }
  if (ctx.now().getTime() - Date.parse(op.startedAt) < ctx.leaseMs) {
    return { key, outcome: "in-progress", opId: op.opId };
  }

  const decision = await decide(ctx, manifest, op, live);
  if (!options.dryRun) {
    await commit(ctx, key, decision.next, rev);
    if (decision.orphan) await ctx.store.delete(decision.orphan).catch(() => undefined);
  }
  return { key, outcome: decision.outcome, opId: op.opId, reason: decision.reason };
}

async function decide(ctx: EngineContext, manifest: Manifest, op: PendingOp, live: ObjectInfo | null): Promise<Decision> {
  const liveEtag = live?.etag ?? null;
  const cleared: Manifest = { ...manifest, pending: null };

  if (op.type === "delete") {
    if (live === null) {
      return { outcome: "rolled-forward", next: { ...cleared, versions: [...manifest.versions, op.record], current: null, liveEtag: null } };
    }
    if (liveEtag === op.expectedLiveEtag) return { outcome: "rolled-back", next: cleared };
  } else if (op.record.objectKey) {
    const objectKey = op.record.objectKey;
    const obj = await ctx.store.head(objectKey);
    if (obj && live && live.etag === obj.etag) {
      const record = { ...op.record, etag: obj.etag };
      return {
        outcome: "rolled-forward",
        next: { ...cleared, versions: [...manifest.versions, record], current: record.versionId, liveEtag: live.etag },
      };
    }
    if (liveEtag === op.expectedLiveEtag) {
      return { outcome: "rolled-back", next: cleared, orphan: op.type === "put" && obj ? objectKey : undefined };
    }
  }

  const reason = `live object is ${liveEtag ?? "absent"}, which is neither the state before the ${op.type} (${op.expectedLiveEtag ?? "absent"}) nor its result`;
  return { outcome: "stuck", reason, next: { ...manifest, pending: { ...op, stuck: reason } } };
}
```

- [x] **Step 2: Implement write admission**

`sdk/src/engine/claim.ts`:
```ts
import { ConcurrencyConflictError, OperationIncompleteError } from "../errors.js";
import { emptyManifest, type Manifest } from "../meta/types.js";
import type { EngineContext } from "./context.js";
import { recover } from "./recover.js";

/**
 * Load the manifest for a write. A pending op that is stuck → OperationIncomplete;
 * still within its lease → ConcurrencyConflict; expired → recovered first.
 */
export async function loadForWrite(ctx: EngineContext, key: string): Promise<{ manifest: Manifest; rev: string | null }> {
  let snap = await ctx.meta.read(key);
  const op = snap?.manifest.pending;
  if (snap && op) {
    if (op.stuck) throw new OperationIncompleteError(key, op.opId, op.stuck);
    const result = await recover(ctx, key);
    if (result.outcome === "in-progress") throw new ConcurrencyConflictError(key, `operation ${op.opId} is in progress`);
    if (result.outcome === "stuck") throw new OperationIncompleteError(key, op.opId, result.reason ?? "recovery could not decide");
    snap = await ctx.meta.read(key);
  }
  return { manifest: snap?.manifest ?? emptyManifest(key), rev: snap?.rev ?? null };
}
```

- [x] **Step 3: Typecheck and commit**

Run: `npm run typecheck -w @ver2/sdk` → Expected: exit 0.
```bash
git add sdk/src/engine/recover.ts sdk/src/engine/claim.ts
git commit -m "feat(sdk): add evidence-based recovery and write admission"
```

---

### Task 11: Promote, claimed-op runner, put (+ recovery tests)

**Files:**
- Create: `sdk/src/engine/promote.ts`, `sdk/src/engine/run-claimed.ts`, `sdk/src/engine/put.ts`
- Test: `sdk/test/engine/put.test.ts`, `sdk/test/engine/recover.test.ts`

- [x] **Step 1: Promote and the claimed-op runner**

`sdk/src/engine/promote.ts`:
```ts
import { ConcurrencyConflictError } from "../errors.js";
import { isPreconditionFailed } from "../storage/types.js";
import type { EngineContext } from "./context.js";

/**
 * Copy a version object onto the live key, but only if the live key is still in the
 * state we inspected (R2 cf-copy-destination-* guards). Returns the new live ETag.
 */
export async function promote(
  ctx: EngineContext,
  key: string,
  objectKey: string,
  objectEtag: string,
  expectedLiveEtag: string | null,
): Promise<string> {
  const guard = expectedLiveEtag === null ? { destIfNoneMatch: "*" as const } : { destIfMatch: expectedLiveEtag };
  try {
    return (await ctx.store.copy(objectKey, key, { sourceIfMatch: objectEtag, ...guard })).etag;
  } catch (e) {
    if (!isPreconditionFailed(e)) throw e;
    // A retried copy can 412 because its first attempt already landed.
    // Phase 1 versions are single-part, so a landed copy has the version's ETag.
    const live = await ctx.store.head(key);
    if (live && live.etag === objectEtag) return live.etag;
    throw new ConcurrencyConflictError(key, "the live object changed during the operation");
  }
}
```

`sdk/src/engine/run-claimed.ts`:
```ts
import { ConcurrencyConflictError, OperationIncompleteError } from "../errors.js";
import type { Manifest, PendingOp } from "../meta/types.js";
import type { EngineContext } from "./context.js";
import { commit } from "./manifest.js";

export interface Claim {
  /** Manifest as it was before `pending` was set (includes any adoptions). */
  manifest: Manifest;
  /** Revision of the claimed manifest (the one with `pending`). */
  rev: string;
  op: PendingOp;
}

/**
 * Run the storage half of a claimed operation, then commit `committed(result)`.
 * ConcurrencyConflict → release the claim, clean up, rethrow. Anything else →
 * OperationIncomplete, leaving `pending` for recovery to settle from evidence.
 */
export async function runClaimed<T>(
  ctx: EngineContext,
  key: string,
  claim: Claim,
  work: () => Promise<T>,
  committed: (result: T) => Manifest,
): Promise<T> {
  let result: T;
  try {
    result = await work();
  } catch (e) {
    if (e instanceof ConcurrencyConflictError) {
      await abandon(ctx, key, claim);
      throw e;
    }
    throw new OperationIncompleteError(key, claim.op.opId, e instanceof Error ? e.message : String(e), { cause: e });
  }
  try {
    await commit(ctx, key, committed(result), claim.rev);
  } catch (e) {
    const reason = e instanceof ConcurrencyConflictError ? "the manifest changed before the commit" : String(e);
    throw new OperationIncompleteError(key, claim.op.opId, reason, { cause: e });
  }
  return result;
}

async function abandon(ctx: EngineContext, key: string, claim: Claim): Promise<void> {
  try {
    await ctx.meta.write(key, { ...claim.manifest, pending: null }, claim.rev);
  } catch {
    return; // leave the claim; recovery will roll it back once the lease expires
  }
  // Only a put owns its version object; restores share theirs with an older version.
  if (claim.op.type === "put" && claim.op.record.objectKey) {
    await ctx.store.delete(claim.op.record.objectKey).catch(() => undefined);
  }
}
```

- [x] **Step 2: Write the failing put test**

`sdk/test/engine/put.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { put } from "../../src/engine/put.js";
import { ConcurrencyConflictError, InvalidKeyError, OperationIncompleteError } from "../../src/errors.js";
import { StoreError } from "../../src/storage/types.js";
import { crashOn, KEY, MANIFEST_KEY, setup, text } from "../helpers.js";

describe("put", () => {
  it("creates the live object, an immutable version and a manifest", async () => {
    const t = setup();
    const r = await put(t.ctx, KEY, "one", { headers: { contentType: "text/plain" } });
    expect(r).toMatchObject({ key: KEY, size: 3 });
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(t.live()).toBe("one");
    expect((await t.store.head(KEY))?.headers.contentType).toBe("text/plain");
    const m = await t.manifest();
    expect(m).toMatchObject({ current: r.versionId, liveEtag: r.etag, pending: null });
    expect(m?.versions).toHaveLength(1);
    expect(await text((await t.store.get(m!.versions[0]!.objectKey!))!.body)).toBe("one");
  });

  it("keeps every version's bytes", async () => {
    const t = setup();
    const v1 = await put(t.ctx, KEY, "one");
    await put(t.ctx, KEY, "two");
    const m = await t.manifest();
    expect(m?.versions.map((v) => v.versionId)[0]).toBe(v1.versionId);
    expect(t.live()).toBe("two");
    expect(await text((await t.store.get(m!.versions[0]!.objectKey!))!.body)).toBe("one");
  });

  it("preserves a direct write before overwriting it", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    t.store.putDirect(KEY, "direct");
    await put(t.ctx, KEY, "three");
    const m = await t.manifest();
    expect(m?.versions.map((v) => v.source)).toEqual(["ver2", "external", "ver2"]);
    expect(await text((await t.store.get(m!.versions[1]!.objectKey!))!.body)).toBe("direct");
  });

  it("rejects invalid keys before touching storage", async () => {
    const t = setup();
    await expect(put(t.ctx, "a/../b", "x")).rejects.toBeInstanceOf(InvalidKeyError);
    expect(t.store.objects.size).toBe(0);
  });

  it("is busy while another operation holds the key", async () => {
    const t = setup();
    crashOn(t.store, (op, key, phase) => op === "put" && key === MANIFEST_KEY && phase === "before", 2);
    await expect(put(t.ctx, KEY, "one")).rejects.toBeInstanceOf(OperationIncompleteError);
    await expect(put(t.ctx, KEY, "two")).rejects.toBeInstanceOf(ConcurrencyConflictError);
  });

  it("refuses to clobber a direct write that races the promote", async () => {
    const t = setup();
    t.store.fault = (op, key, phase) => {
      if (op === "copy" && key === KEY && phase === "before") {
        t.store.fault = undefined;
        t.store.putDirect(KEY, "racer");
      }
    };
    await expect(put(t.ctx, KEY, "mine")).rejects.toBeInstanceOf(ConcurrencyConflictError);
    expect(t.live()).toBe("racer");
    expect((await t.manifest())?.pending).toBeNull();
    expect(t.versionObjects()).toEqual([]);
  });

  it("treats a 412 on a retried promote that already landed as success", async () => {
    const t = setup();
    crashOn(
      t.store,
      (op, key, phase) => op === "copy" && key === KEY && phase === "after",
      1,
      new StoreError("precondition-failed", "retry saw 412", 412),
    );
    const r = await put(t.ctx, KEY, "one");
    expect((await t.manifest())?.current).toBe(r.versionId);
  });

  it("leaves a recoverable journal entry when the commit fails", async () => {
    const t = setup();
    crashOn(t.store, (op, key, phase) => op === "put" && key === MANIFEST_KEY && phase === "before", 2);
    await expect(put(t.ctx, KEY, "one")).rejects.toBeInstanceOf(OperationIncompleteError);
    expect(t.live()).toBe("one");
    expect((await t.manifest())?.pending?.type).toBe("put");
  });
});
```

Run: `npm test -w @ver2/sdk -- put` → Expected: FAIL, cannot resolve `../../src/engine/put.js`.

- [x] **Step 3: Implement put**

`sdk/src/engine/put.ts`:
```ts
import { sha256Hex, toBytes } from "../hash.js";
import { canonicalKey } from "../keys.js";
import type { PendingOp, VersionRecord } from "../meta/types.js";
import { isPreconditionFailed, type ObjectHeaders } from "../storage/types.js";
import { loadForWrite } from "./claim.js";
import type { EngineContext } from "./context.js";
import { syncLive } from "./live.js";
import { commit } from "./manifest.js";
import { promote } from "./promote.js";
import { runClaimed } from "./run-claimed.js";

export interface PutOptions {
  headers?: ObjectHeaders;
}

export interface PutResult {
  key: string;
  versionId: string;
  sha256: string;
  size: number;
  /** ETag of the live object after the write. */
  etag: string;
}

export async function put(ctx: EngineContext, rawKey: string, data: Uint8Array | string, options: PutOptions = {}): Promise<PutResult> {
  const key = canonicalKey(rawKey, ctx.policy);
  const bytes = toBytes(data);
  const loaded = await loadForWrite(ctx, key);
  const live = await ctx.store.head(key);
  const manifest = await syncLive(ctx, key, loaded.manifest, live);

  const versionId = ctx.newId();
  const objectKey = ctx.paths.versionKey(key, versionId);
  const sha256 = sha256Hex(bytes);
  const headers = options.headers ?? {};
  const record: VersionRecord = {
    versionId,
    kind: "put",
    objectKey,
    sha256,
    size: bytes.byteLength,
    headers,
    source: "ver2",
    createdAt: ctx.now().toISOString(),
  };
  const op: PendingOp = {
    opId: ctx.newId(),
    type: "put",
    record,
    expectedLiveEtag: live?.etag ?? null,
    startedAt: ctx.now().toISOString(),
  };
  const rev = await commit(ctx, key, { ...manifest, pending: op }, loaded.rev);

  const { liveEtag } = await runClaimed(
    ctx,
    key,
    { manifest, rev, op },
    async () => {
      const objectEtag = await putVersionObject(ctx, objectKey, bytes, headers);
      return { objectEtag, liveEtag: await promote(ctx, key, objectKey, objectEtag, op.expectedLiveEtag) };
    },
    (r) => ({
      ...manifest,
      versions: [...manifest.versions, { ...record, etag: r.objectEtag }],
      current: versionId,
      liveEtag: r.liveEtag,
      pending: null,
    }),
  );
  return { key, versionId, sha256, size: bytes.byteLength, etag: liveEtag };
}

async function putVersionObject(ctx: EngineContext, objectKey: string, bytes: Uint8Array, headers: ObjectHeaders): Promise<string> {
  try {
    return (await ctx.store.put(objectKey, bytes, { headers, ifNoneMatch: "*" })).etag;
  } catch (e) {
    if (!isPreconditionFailed(e)) throw e;
    // Version keys are unique per operation, so an object already here is our own earlier attempt.
    const existing = await ctx.store.head(objectKey);
    if (existing && existing.size === bytes.byteLength) return existing.etag;
    throw e;
  }
}
```

- [x] **Step 4: Run put tests**

Run: `npm test -w @ver2/sdk -- put` → Expected: 8 passed.

- [x] **Step 5: Recovery tests**

`sdk/test/engine/recover.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { put } from "../../src/engine/put.js";
import { recover } from "../../src/engine/recover.js";
import { ConcurrencyConflictError, OperationIncompleteError } from "../../src/errors.js";
import { crashOn, KEY, MANIFEST_KEY, setup } from "../helpers.js";

const manifestPut = (op: string, key: string, phase: string) => op === "put" && key === MANIFEST_KEY && phase === "before";
const LEASE = 61_000;

/** v1 committed, then a put of "two" crashes after promoting but before committing. */
async function crashedAfterPromote() {
  const t = setup();
  await put(t.ctx, KEY, "one");
  crashOn(t.store, manifestPut, 2);
  await expect(put(t.ctx, KEY, "two")).rejects.toBeInstanceOf(OperationIncompleteError);
  return t;
}

describe("recover", () => {
  it("does nothing without a pending operation", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    expect((await recover(t.ctx, KEY)).outcome).toBe("none");
  });

  it("leaves operations inside their lease alone", async () => {
    const t = await crashedAfterPromote();
    expect((await recover(t.ctx, KEY)).outcome).toBe("in-progress");
  });

  it("rolls a put forward when the promote landed", async () => {
    const t = await crashedAfterPromote();
    const pending = (await t.manifest())?.pending;
    t.advance(LEASE);
    expect((await recover(t.ctx, KEY)).outcome).toBe("rolled-forward");
    const m = await t.manifest();
    expect(m).toMatchObject({ current: pending?.record.versionId, pending: null });
    expect(m?.versions).toHaveLength(2);
  });

  it("rolls a put back when the promote never happened, deleting the orphan", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    crashOn(t.store, (op, key, phase) => op === "copy" && key === KEY && phase === "before");
    await expect(put(t.ctx, KEY, "two")).rejects.toBeInstanceOf(OperationIncompleteError);
    t.advance(LEASE);
    expect((await recover(t.ctx, KEY)).outcome).toBe("rolled-back");
    expect(t.live()).toBe("one");
    expect(t.versionObjects()).toHaveLength(1);
    expect((await t.manifest())?.pending).toBeNull();
  });

  it("marks the op stuck when the evidence is ambiguous, and accept-live resolves it", async () => {
    const t = await crashedAfterPromote();
    t.store.putDirect(KEY, "someone else");
    t.advance(LEASE);
    expect((await recover(t.ctx, KEY)).outcome).toBe("stuck");
    expect((await t.manifest())?.pending?.stuck).toBeDefined();
    await expect(put(t.ctx, KEY, "three")).rejects.toBeInstanceOf(OperationIncompleteError);

    expect((await recover(t.ctx, KEY, { acceptLive: true })).outcome).toBe("accepted-live");
    const m = await t.manifest();
    expect(m?.pending).toBeNull();
    expect(m?.versions.at(-1)?.source).toBe("external");
  });

  it("dry-run reports without writing", async () => {
    const t = await crashedAfterPromote();
    t.advance(LEASE);
    expect((await recover(t.ctx, KEY, { dryRun: true })).outcome).toBe("rolled-forward");
    expect((await t.manifest())?.pending).not.toBeNull();
  });

  it("put waits for the lease, then recovers and proceeds", async () => {
    const t = await crashedAfterPromote();
    await expect(put(t.ctx, KEY, "three")).rejects.toBeInstanceOf(ConcurrencyConflictError);
    t.advance(LEASE);
    await put(t.ctx, KEY, "three");
    expect((await t.manifest())?.versions).toHaveLength(3);
    expect(t.live()).toBe("three");
  });
});
```

Run: `npm test -w @ver2/sdk -- recover` → Expected: 7 passed.

- [x] **Step 6: Commit**

```bash
git add sdk/src/engine sdk/test/engine/put.test.ts sdk/test/engine/recover.test.ts
git commit -m "feat(sdk): add journaled put with guarded promote and recovery tests"
```

---

### Task 12: Delete

**Files:**
- Create: `sdk/src/engine/delete.ts`
- Test: `sdk/test/engine/delete.test.ts`

- [x] **Step 1: Write the failing test**

`sdk/test/engine/delete.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { remove } from "../../src/engine/delete.js";
import { put } from "../../src/engine/put.js";
import { recover } from "../../src/engine/recover.js";
import { OperationIncompleteError } from "../../src/errors.js";
import { crashOn, KEY, MANIFEST_KEY, setup, text } from "../helpers.js";

describe("remove", () => {
  it("deletes the live object but keeps its bytes and records a marker", async () => {
    const t = setup();
    const v1 = await put(t.ctx, KEY, "one");
    const r = await remove(t.ctx, KEY);
    expect(t.live()).toBeNull();
    const m = await t.manifest();
    expect(m).toMatchObject({ current: null, liveEtag: null, pending: null });
    expect(m?.versions.at(-1)).toMatchObject({ versionId: r.versionId, kind: "delete", source: "ver2" });
    const kept = m?.versions.find((v) => v.versionId === v1.versionId);
    expect(await text((await t.store.get(kept!.objectKey!))!.body)).toBe("one");
  });

  it("is a no-op for a key that never existed", async () => {
    const t = setup();
    expect(await remove(t.ctx, KEY)).toEqual({ key: KEY, versionId: null });
    expect(t.store.objects.size).toBe(0);
  });

  it("records a direct delete it finds", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    await t.store.delete(KEY);
    const r = await remove(t.ctx, KEY);
    expect(r.versionId).not.toBeNull();
    expect((await t.manifest())?.versions.at(-1)).toMatchObject({ kind: "delete", source: "external" });
  });

  it("preserves a direct write before deleting it", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    t.store.putDirect(KEY, "direct");
    await remove(t.ctx, KEY);
    const external = (await t.manifest())?.versions.find((v) => v.source === "external");
    expect(await text((await t.store.get(external!.objectKey!))!.body)).toBe("direct");
  });

  it("rolls forward a delete whose commit failed", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    crashOn(t.store, (op, key, phase) => op === "put" && key === MANIFEST_KEY && phase === "before", 2);
    await expect(remove(t.ctx, KEY)).rejects.toBeInstanceOf(OperationIncompleteError);
    t.advance(61_000);
    expect((await recover(t.ctx, KEY)).outcome).toBe("rolled-forward");
    expect((await t.manifest())?.current).toBeNull();
  });

  it("rolls back a delete that never reached storage", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    crashOn(t.store, (op, key, phase) => op === "delete" && key === KEY && phase === "before");
    await expect(remove(t.ctx, KEY)).rejects.toBeInstanceOf(OperationIncompleteError);
    t.advance(61_000);
    expect((await recover(t.ctx, KEY)).outcome).toBe("rolled-back");
    expect(t.live()).toBe("one");
  });
});
```

Run: `npm test -w @ver2/sdk -- delete` → Expected: FAIL, cannot resolve `../../src/engine/delete.js`.

- [x] **Step 2: Implement**

`sdk/src/engine/delete.ts`:
```ts
import { canonicalKey } from "../keys.js";
import type { PendingOp, VersionRecord } from "../meta/types.js";
import { loadForWrite } from "./claim.js";
import type { EngineContext } from "./context.js";
import { syncLive } from "./live.js";
import { commit } from "./manifest.js";
import { runClaimed } from "./run-claimed.js";

export interface DeleteResult {
  key: string;
  /** The delete marker, or null when there was nothing to delete. */
  versionId: string | null;
}

/**
 * Logical delete. The live bytes are already a version object (write-through), so
 * nothing is copied. R2 ignores conditions on DELETE: a direct write landing between
 * the HEAD and the DELETE is lost. This is a documented limitation.
 */
export async function remove(ctx: EngineContext, rawKey: string): Promise<DeleteResult> {
  const key = canonicalKey(rawKey, ctx.policy);
  const loaded = await loadForWrite(ctx, key);
  const live = await ctx.store.head(key);
  const manifest = await syncLive(ctx, key, loaded.manifest, live);

  if (live === null) {
    if (manifest === loaded.manifest) return { key, versionId: null };
    await commit(ctx, key, manifest, loaded.rev);
    return { key, versionId: manifest.versions[manifest.versions.length - 1]?.versionId ?? null };
  }

  const record: VersionRecord = { versionId: ctx.newId(), kind: "delete", source: "ver2", createdAt: ctx.now().toISOString() };
  const op: PendingOp = {
    opId: ctx.newId(),
    type: "delete",
    record,
    expectedLiveEtag: live.etag,
    startedAt: ctx.now().toISOString(),
  };
  const rev = await commit(ctx, key, { ...manifest, pending: op }, loaded.rev);
  await runClaimed(
    ctx,
    key,
    { manifest, rev, op },
    () => ctx.store.delete(key),
    () => ({ ...manifest, versions: [...manifest.versions, record], current: null, liveEtag: null, pending: null }),
  );
  return { key, versionId: record.versionId };
}
```

- [x] **Step 3: Run tests and commit**

Run: `npm test -w @ver2/sdk -- delete` → Expected: 6 passed.
```bash
git add sdk/src/engine/delete.ts sdk/test/engine/delete.test.ts
git commit -m "feat(sdk): add journaled logical delete"
```

---

### Task 13: Restore, version listing, verified download

**Files:**
- Create: `sdk/src/engine/restore.ts`, `sdk/src/engine/versions.ts`
- Test: `sdk/test/engine/restore.test.ts`, `sdk/test/engine/versions.test.ts`

- [x] **Step 1: Write the failing tests**

`sdk/test/engine/restore.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { remove } from "../../src/engine/delete.js";
import { put } from "../../src/engine/put.js";
import { restore } from "../../src/engine/restore.js";
import { VersionNotFoundError } from "../../src/errors.js";
import { KEY, setup } from "../helpers.js";

describe("restore", () => {
  it("makes an old version live again as a new version", async () => {
    const t = setup();
    const v1 = await put(t.ctx, KEY, "one", { headers: { contentType: "text/plain" } });
    await put(t.ctx, KEY, "two");
    const r = await restore(t.ctx, KEY, v1.versionId);
    expect(t.live()).toBe("one");
    expect((await t.store.head(KEY))?.headers.contentType).toBe("text/plain");
    expect(r.sha256).toBe(v1.sha256);
    const m = await t.manifest();
    expect(m?.current).toBe(r.versionId);
    expect(m?.versions.at(-1)).toMatchObject({ source: "restore", restoredFrom: v1.versionId });
    expect(t.versionObjects()).toHaveLength(2); // restore shares v1's object
  });

  it("recreates a deleted key", async () => {
    const t = setup();
    const v1 = await put(t.ctx, KEY, "one");
    await remove(t.ctx, KEY);
    await restore(t.ctx, KEY, v1.versionId);
    expect(t.live()).toBe("one");
  });

  it("rejects unknown versions and delete markers", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    const marker = await remove(t.ctx, KEY);
    await expect(restore(t.ctx, KEY, "nope")).rejects.toBeInstanceOf(VersionNotFoundError);
    await expect(restore(t.ctx, KEY, marker.versionId!)).rejects.toBeInstanceOf(VersionNotFoundError);
  });
});
```

`sdk/test/engine/versions.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { remove } from "../../src/engine/delete.js";
import { put } from "../../src/engine/put.js";
import { download, listVersions } from "../../src/engine/versions.js";
import { IntegrityCheckFailedError, ObjectNotFoundError, VersionNotFoundError } from "../../src/errors.js";
import { KEY, setup, text } from "../helpers.js";

describe("listVersions", () => {
  it("returns newest first, including delete markers", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    await put(t.ctx, KEY, "two");
    await remove(t.ctx, KEY);
    expect((await listVersions(t.ctx, KEY)).map((v) => v.kind)).toEqual(["delete", "put", "put"]);
  });

  it("is empty for unknown keys", async () => {
    expect(await listVersions(setup().ctx, KEY)).toEqual([]);
  });
});

describe("download", () => {
  it("streams the current version by default and any version by id", async () => {
    const t = setup();
    const v1 = await put(t.ctx, KEY, "one");
    await put(t.ctx, KEY, "two");
    expect(await text((await download(t.ctx, KEY)).body)).toBe("two");
    expect(await text((await download(t.ctx, KEY, v1.versionId)).body)).toBe("one");
  });

  it("has no current version after a delete", async () => {
    const t = setup();
    await put(t.ctx, KEY, "one");
    const marker = await remove(t.ctx, KEY);
    await expect(download(t.ctx, KEY)).rejects.toBeInstanceOf(ObjectNotFoundError);
    await expect(download(t.ctx, KEY, marker.versionId!)).rejects.toBeInstanceOf(VersionNotFoundError);
  });

  it("detects a replaced version object", async () => {
    const t = setup();
    const v1 = await put(t.ctx, KEY, "one");
    const record = (await listVersions(t.ctx, KEY))[0]!;
    t.store.putDirect(record.objectKey!, "tampered");
    await expect(download(t.ctx, KEY, v1.versionId)).rejects.toBeInstanceOf(IntegrityCheckFailedError);
  });

  it("detects corrupted bytes behind an unchanged ETag", async () => {
    const t = setup();
    const v1 = await put(t.ctx, KEY, "one");
    const record = (await listVersions(t.ctx, KEY))[0]!;
    t.store.objects.get(record.objectKey!)!.bytes = new TextEncoder().encode("bad");
    const { body } = await download(t.ctx, KEY, v1.versionId);
    await expect(text(body)).rejects.toBeInstanceOf(IntegrityCheckFailedError);
  });
});
```

Run: `npm test -w @ver2/sdk -- restore versions` → Expected: FAIL, modules not found.

- [x] **Step 2: Implement restore**

`sdk/src/engine/restore.ts`:
```ts
import { VersionNotFoundError } from "../errors.js";
import { canonicalKey } from "../keys.js";
import type { PendingOp, VersionRecord } from "../meta/types.js";
import { loadForWrite } from "./claim.js";
import type { EngineContext } from "./context.js";
import { syncLive } from "./live.js";
import { commit } from "./manifest.js";
import { promote } from "./promote.js";
import type { PutResult } from "./put.js";
import { runClaimed } from "./run-claimed.js";

/** Promote an existing version object back to live, recorded as a new version. */
export async function restore(ctx: EngineContext, rawKey: string, versionId: string): Promise<PutResult> {
  const key = canonicalKey(rawKey, ctx.policy);
  const loaded = await loadForWrite(ctx, key);
  const source = loaded.manifest.versions.find((v) => v.versionId === versionId && v.kind === "put");
  const objectKey = source?.objectKey;
  const objectEtag = source?.etag;
  const sha256 = source?.sha256;
  const size = source?.size;
  if (!source || !objectKey || !objectEtag || sha256 === undefined || size === undefined) {
    throw new VersionNotFoundError(key, versionId);
  }

  const live = await ctx.store.head(key);
  const manifest = await syncLive(ctx, key, loaded.manifest, live);
  const record: VersionRecord = {
    ...source,
    versionId: ctx.newId(),
    source: "restore",
    restoredFrom: versionId,
    createdAt: ctx.now().toISOString(),
  };
  const op: PendingOp = {
    opId: ctx.newId(),
    type: "restore",
    record,
    expectedLiveEtag: live?.etag ?? null,
    startedAt: ctx.now().toISOString(),
  };
  const rev = await commit(ctx, key, { ...manifest, pending: op }, loaded.rev);

  const liveEtag = await runClaimed(
    ctx,
    key,
    { manifest, rev, op },
    () => promote(ctx, key, objectKey, objectEtag, op.expectedLiveEtag),
    (etag) => ({ ...manifest, versions: [...manifest.versions, record], current: record.versionId, liveEtag: etag, pending: null }),
  );
  return { key, versionId: record.versionId, sha256, size, etag: liveEtag };
}
```

- [x] **Step 3: Implement listing and download**

`sdk/src/engine/versions.ts`:
```ts
import { IntegrityCheckFailedError, ObjectNotFoundError, VersionNotFoundError } from "../errors.js";
import { verifyingStream } from "../hash.js";
import { canonicalKey } from "../keys.js";
import type { VersionRecord } from "../meta/types.js";
import { isPreconditionFailed } from "../storage/types.js";
import type { EngineContext } from "./context.js";

export interface DownloadResult {
  record: VersionRecord;
  /** Errors with IntegrityCheckFailedError at the end if the SHA-256 does not match. */
  body: ReadableStream<Uint8Array>;
}

/** Version history, newest first. */
export async function listVersions(ctx: EngineContext, rawKey: string): Promise<VersionRecord[]> {
  const key = canonicalKey(rawKey, ctx.policy);
  const snap = await ctx.meta.read(key);
  return snap ? [...snap.manifest.versions].reverse() : [];
}

export async function download(ctx: EngineContext, rawKey: string, versionId?: string): Promise<DownloadResult> {
  const key = canonicalKey(rawKey, ctx.policy);
  const snap = await ctx.meta.read(key);
  const id = versionId ?? snap?.manifest.current ?? null;
  if (!snap || id === null) throw new ObjectNotFoundError(key);
  const record = snap.manifest.versions.find((v) => v.versionId === id && v.kind === "put");
  const objectKey = record?.objectKey;
  const expected = record?.sha256;
  if (!record || !objectKey || !expected) throw new VersionNotFoundError(key, id);

  let res;
  try {
    res = await ctx.store.get(objectKey, { ifMatch: record.etag });
  } catch (e) {
    if (isPreconditionFailed(e)) throw new IntegrityCheckFailedError(key, id, "the version object was replaced");
    throw e;
  }
  if (!res) throw new IntegrityCheckFailedError(key, id, "the version object is missing");
  const verify = verifyingStream(expected, (actual) => new IntegrityCheckFailedError(key, id, `sha256 ${actual} does not match ${expected}`));
  return { record, body: res.body.pipeThrough(verify) };
}
```

- [x] **Step 4: Run tests and commit**

Run: `npm test -w @ver2/sdk -- restore versions` → Expected: 3 + 6 passed.
Run: `npm test -w @ver2/sdk` → Expected: everything passes (integration skipped without creds).
```bash
git add sdk/src/engine sdk/test/engine
git commit -m "feat(sdk): add restore, version listing and verified download"
```

---

### Task 14: Ver2 facade and public API

**Files:**
- Create: `sdk/src/client.ts`
- Modify: `sdk/src/index.ts` (replace the whole file)
- Test: `sdk/test/client.test.ts`; delete `sdk/test/smoke.test.ts`

- [x] **Step 1: Write the failing test**

`sdk/test/client.test.ts`:
```ts
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
```

Run: `npm test -w @ver2/sdk -- client` → Expected: FAIL (`createVer2` is not exported).

- [x] **Step 2: Implement the facade**

`sdk/src/client.ts`:
```ts
import { remove, type DeleteResult } from "./engine/delete.js";
import type { EngineContext } from "./engine/context.js";
import { put, type PutOptions, type PutResult } from "./engine/put.js";
import { recover, type RecoverOptions, type RecoveryResult } from "./engine/recover.js";
import { restore } from "./engine/restore.js";
import { download, type DownloadResult, listVersions } from "./engine/versions.js";
import { ConcurrencyConflictError, StorageError, Ver2Error } from "./errors.js";
import { ulid } from "./ids.js";
import { canonicalKey, validateNamespace } from "./keys.js";
import { layout } from "./layout.js";
import { ObjectStoreManifests } from "./meta/object-store-manifests.js";
import { MetaConflictError, type MetadataStore, type VersionRecord } from "./meta/types.js";
import { type ObjectStore, StoreError } from "./storage/types.js";

export interface Ver2Options {
  store: ObjectStore;
  /** Defaults to manifests stored in the bucket (Lite tier). */
  meta?: MetadataStore;
  /** Reserved key prefix for veR2's own objects. Default ".ver2". */
  namespace?: string;
  /** How long an in-flight operation holds a key before it is presumed crashed. Default 60 s. */
  leaseMs?: number;
  now?: () => Date;
  newId?: () => string;
}

/** Convert anything thrown below the facade into a public Ver2Error. */
export function toPublicError(e: unknown): Error {
  if (e instanceof Ver2Error) return e;
  if (e instanceof StoreError) {
    const retryable = e.kind === "rate-limited" || e.kind === "network" || (e.status ?? 0) >= 500;
    return new StorageError(e.message, { status: e.status, retryable }, { cause: e });
  }
  if (e instanceof MetaConflictError) return new ConcurrencyConflictError(e.key, "the manifest changed concurrently");
  return new StorageError(e instanceof Error ? e.message : String(e), { retryable: false }, { cause: e });
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toPublicError(e);
  }
}

export class Ver2 {
  readonly versions: {
    list(key: string): Promise<VersionRecord[]>;
    restore(key: string, versionId: string): Promise<PutResult>;
    download(key: string, versionId?: string): Promise<DownloadResult>;
  };
  private readonly ctx: EngineContext;

  constructor(options: Ver2Options) {
    const namespace = validateNamespace(options.namespace ?? ".ver2");
    const paths = layout(namespace);
    const ctx: EngineContext = {
      store: options.store,
      meta: options.meta ?? new ObjectStoreManifests(options.store, paths),
      paths,
      policy: { namespace },
      leaseMs: options.leaseMs ?? 60_000,
      now: options.now ?? (() => new Date()),
      newId: options.newId ?? (() => ulid()),
    };
    this.ctx = ctx;
    this.versions = {
      list: (key) => guard(() => listVersions(ctx, key)),
      restore: (key, versionId) => guard(() => restore(ctx, key, versionId)),
      download: (key, versionId) => guard(() => download(ctx, key, versionId)),
    };
  }

  put(key: string, data: Uint8Array | string, options?: PutOptions): Promise<PutResult> {
    return guard(() => put(this.ctx, key, data, options));
  }

  delete(key: string): Promise<DeleteResult> {
    return guard(() => remove(this.ctx, key));
  }

  /** Keys veR2 has a history for (including currently deleted ones). */
  list(prefix = "", options: { cursor?: string; limit?: number } = {}): Promise<{ keys: string[]; cursor?: string }> {
    return guard(() => this.ctx.meta.list({ prefix, ...options }));
  }

  recover(key: string, options?: RecoverOptions): Promise<RecoveryResult> {
    return guard(() => recover(this.ctx, canonicalKey(key, this.ctx.policy), options));
  }

  /** Recover every key with a pending operation; yields only keys that needed attention. */
  async *recoverAll(options?: RecoverOptions): AsyncGenerator<RecoveryResult> {
    let cursor: string | undefined;
    do {
      const page = await this.list("", { cursor });
      for (const key of page.keys) {
        const result = await this.recover(key, options);
        if (result.outcome !== "none") yield result;
      }
      cursor = page.cursor;
    } while (cursor);
  }
}

export const createVer2 = (options: Ver2Options): Ver2 => new Ver2(options);
```

- [x] **Step 3: Public exports**

Replace `sdk/src/index.ts` with:
```ts
export { createVer2, toPublicError, Ver2, type Ver2Options } from "./client.js";
export * from "./errors.js";
export { canonicalKey, type KeyPolicy, maxKeyBytes, validateNamespace } from "./keys.js";
export { type Layout, layout } from "./layout.js";
export { ObjectStoreManifests } from "./meta/object-store-manifests.js";
export {
  type Manifest,
  type ManifestSnapshot,
  MetaConflictError,
  type MetadataStore,
  type PendingOp,
  type VersionRecord,
} from "./meta/types.js";
export {
  type CopyOptions,
  type GetOptions,
  type ListResult,
  type ObjectHeaders,
  type ObjectInfo,
  type ObjectStore,
  type PutOptions as StorePutOptions,
  StoreError,
} from "./storage/types.js";
export type { DeleteResult } from "./engine/delete.js";
export type { PutOptions, PutResult } from "./engine/put.js";
export type { RecoverOptions, RecoveryOutcome, RecoveryResult } from "./engine/recover.js";
export type { DownloadResult } from "./engine/versions.js";

export const VERSION = "0.1.0";
```

Run: `git rm sdk/test/smoke.test.ts`

- [x] **Step 4: Run tests, build, commit**

Run: `npm test -w @ver2/sdk` → Expected: all pass.
Run: `npm run build -w @ver2/sdk` → Expected: `sdk/dist/index.js`, `sdk/dist/storage/s3.js`, `sdk/dist/storage/memory.js` exist.
Add `dist/` to `.gitignore` if it is not already listed.
```bash
git add sdk .gitignore
git commit -m "feat(sdk): add Ver2 facade and public API"
```

---

### Task 15: CLI scaffold, config, output

**Files:**
- Create: `cli/package.json`, `cli/tsconfig.json`, `cli/tsconfig.build.json`, `cli/vitest.config.ts`, `cli/src/types.ts`, `cli/src/config.ts`, `cli/src/output.ts`
- Modify: root `package.json` (`"workspaces": ["sdk", "cli"]`)

- [x] **Step 1: Package files**

`cli/package.json`:
```json
{
  "name": "@ver2/cli",
  "version": "0.1.0",
  "description": "Command-line interface for veR2",
  "license": "Apache-2.0",
  "repository": { "type": "git", "url": "git+https://github.com/JBuxo/ver2.git", "directory": "cli" },
  "type": "module",
  "bin": { "ver2": "./dist/index.js" },
  "files": ["dist"],
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

`cli/tsconfig.json` (type-checks against the SDK source, so no build is needed first):
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "paths": {
      "@ver2/sdk": ["../sdk/src/index.ts"],
      "@ver2/sdk/s3": ["../sdk/src/storage/s3.ts"],
      "@ver2/sdk/memory": ["../sdk/src/storage/memory.ts"]
    },
    "allowImportingTsExtensions": true
  },
  "include": ["src", "test", "vitest.config.ts"]
}
```

`cli/tsconfig.build.json`:
```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "rootDir": "src", "outDir": "dist" }, "include": ["src"] }
```

`cli/vitest.config.ts`:
```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const sdk = (path: string) => fileURLToPath(new URL(`../sdk/src/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@ver2\/sdk\/memory$/, replacement: sdk("storage/memory.ts") },
      { find: /^@ver2\/sdk\/s3$/, replacement: sdk("storage/s3.ts") },
      { find: /^@ver2\/sdk$/, replacement: sdk("index.ts") },
    ],
  },
  test: { include: ["test/**/*.test.ts"] },
});
```

Set root `package.json` `"workspaces"` to `["sdk", "cli"]`, then run:
```bash
npm i -w @ver2/cli @ver2/sdk @aws-sdk/client-s3
```
Expected: `cli/package.json` gains `@ver2/sdk` and `@aws-sdk/client-s3` dependencies; `node_modules/@ver2/sdk` links to `sdk/`.

- [x] **Step 2: Shared types, config, output**

`cli/src/types.ts`:
```ts
import type { Ver2 } from "@ver2/sdk";
import type { Ver2Config } from "./config.js";

export const EXIT = { ok: 0, error: 1, usage: 2, conflict: 3, incomplete: 4, integrity: 5 } as const;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** Everything the CLI touches in the outside world, so tests can replace it. */
export interface Io {
  stdout(line: string): void;
  stderr(line: string): void;
  env: Record<string, string | undefined>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, body: ReadableStream<Uint8Array>): Promise<void>;
  writeStdout(body: ReadableStream<Uint8Array>): Promise<void>;
  client(config: Ver2Config): Ver2;
}

export interface Flags {
  json?: boolean;
  "content-type"?: string;
  output?: string;
  "dry-run"?: boolean;
  "accept-live"?: boolean;
  help?: boolean;
}
```

`cli/src/config.ts`:
```ts
import { ConfigurationError, createVer2, type Ver2 } from "@ver2/sdk";
import { S3ObjectStore } from "@ver2/sdk/s3";

export interface Ver2Config {
  bucket: string;
  accountId?: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  namespace?: string;
}

export function loadConfig(env: Record<string, string | undefined>): Ver2Config {
  const missing: string[] = [];
  if (!env.R2_BUCKET) missing.push("R2_BUCKET");
  if (!env.R2_ACCOUNT_ID && !env.R2_ENDPOINT) missing.push("R2_ACCOUNT_ID or R2_ENDPOINT");
  if (!env.R2_ACCESS_KEY_ID) missing.push("R2_ACCESS_KEY_ID");
  if (!env.R2_SECRET_ACCESS_KEY) missing.push("R2_SECRET_ACCESS_KEY");
  if (missing.length > 0) {
    throw new ConfigurationError(`Missing configuration: ${missing.join(", ")}. Set them in the environment or .env.local.`);
  }
  return {
    bucket: env.R2_BUCKET as string,
    accountId: env.R2_ACCOUNT_ID || undefined,
    endpoint: env.R2_ENDPOINT || undefined,
    accessKeyId: env.R2_ACCESS_KEY_ID as string,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY as string,
    namespace: env.VER2_NAMESPACE || undefined,
  };
}

export function createClient(config: Ver2Config): Ver2 {
  const store = new S3ObjectStore({
    bucket: config.bucket,
    accountId: config.accountId,
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return createVer2({ store, namespace: config.namespace });
}
```

`cli/src/output.ts`:
```ts
import {
  ConcurrencyConflictError,
  ConfigurationError,
  IntegrityCheckFailedError,
  InvalidKeyError,
  OperationIncompleteError,
  Ver2Error,
} from "@ver2/sdk";
import { EXIT, type Io, UsageError } from "./types.js";

export interface Output {
  result(data: unknown, human: string): void;
  /** Print an error and return the exit code for it. */
  error(e: unknown): number;
}

export function exitCodeFor(e: unknown): number {
  if (e instanceof UsageError || e instanceof ConfigurationError || e instanceof InvalidKeyError) return EXIT.usage;
  if (e instanceof ConcurrencyConflictError) return EXIT.conflict;
  if (e instanceof OperationIncompleteError) return EXIT.incomplete;
  if (e instanceof IntegrityCheckFailedError) return EXIT.integrity;
  return EXIT.error;
}

export function output(io: Io, json: boolean): Output {
  return {
    result(data, human) {
      io.stdout(json ? JSON.stringify(data, null, 2) : human);
    },
    error(e) {
      const message = e instanceof Error ? e.message : String(e);
      if (json) {
        const code = e instanceof Ver2Error ? e.code : e instanceof UsageError ? "USAGE" : "ERROR";
        const details = e instanceof Ver2Error ? e.details : undefined;
        io.stderr(JSON.stringify({ error: { code, message, details } }));
      } else {
        io.stderr(`ver2: ${message}`);
      }
      return exitCodeFor(e);
    },
  };
}
```

- [x] **Step 3: Typecheck and commit**

Run: `npm run typecheck -w @ver2/cli` → Expected: exit 0.
```bash
git add package.json package-lock.json cli
git commit -m "chore(cli): scaffold @ver2/cli with config and output"
```

---

### Task 16: CLI commands and entry point

**Files:**
- Create: `cli/src/commands.ts`, `cli/src/main.ts`, `cli/src/index.ts`
- Test: `cli/test/cli.test.ts`

- [x] **Step 1: Write the failing test**

`cli/test/cli.test.ts`:
```ts
import { createVer2, type Ver2 } from "@ver2/sdk";
import { MemoryObjectStore } from "@ver2/sdk/memory";
import { describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import { EXIT, type Io } from "../src/types.js";

const ENV = { R2_ACCOUNT_ID: "acc", R2_BUCKET: "bucket", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret" };
const enc = (s: string) => new TextEncoder().encode(s);

function harness(env: Record<string, string | undefined> = ENV) {
  const store = new MemoryObjectStore();
  // leaseMs 0: recovery may act immediately, so `reconcile` is testable without a clock.
  const client: Ver2 = createVer2({ store, leaseMs: 0 });
  const out: string[] = [];
  const err: string[] = [];
  const files = new Map<string, Uint8Array>([
    ["a.txt", enc("one")],
    ["b.txt", enc("two")],
  ]);
  const io: Io = {
    stdout: (line) => void out.push(line),
    stderr: (line) => void err.push(line),
    env,
    readFile: async (path) => {
      const f = files.get(path);
      if (!f) throw new Error(`ENOENT: ${path}`);
      return f;
    },
    writeFile: async (path, body) => {
      files.set(path, new Uint8Array(await new Response(body).arrayBuffer()));
    },
    writeStdout: async (body) => {
      out.push(await new Response(body).text());
    },
    client: () => client,
  };
  return { run: (...argv: string[]) => main(argv, io), out, err, files, store };
}

describe("ver2 CLI", () => {
  it("prints help", async () => {
    const h = harness();
    expect(await h.run("--help")).toBe(EXIT.ok);
    expect(h.out.join("\n")).toContain("Usage: ver2");
  });

  it("rejects a missing or unknown command", async () => {
    const h = harness();
    expect(await h.run()).toBe(EXIT.usage);
    expect(await h.run("frobnicate")).toBe(EXIT.usage);
    expect(h.err.join("\n")).toContain('Unknown command "frobnicate"');
  });

  it("reports missing configuration", async () => {
    const h = harness({});
    expect(await h.run("ls")).toBe(EXIT.usage);
    expect(h.err.join("\n")).toContain("R2_BUCKET");
  });

  it("round-trips put, versions and restore", async () => {
    const h = harness();
    expect(await h.run("put", "doc.txt", "a.txt", "--json")).toBe(EXIT.ok);
    const v1 = JSON.parse(h.out.pop()!);
    expect(await h.run("put", "doc.txt", "b.txt")).toBe(EXIT.ok);
    expect(await h.run("restore", "doc.txt", v1.versionId)).toBe(EXIT.ok);
    expect(await h.run("versions", "doc.txt", "--json")).toBe(EXIT.ok);
    const { versions } = JSON.parse(h.out.pop()!);
    expect(versions).toHaveLength(3);
    expect(versions[0].restoredFrom).toBe(v1.versionId);
    expect(new TextDecoder().decode(h.store.objects.get("doc.txt")!.bytes)).toBe("one");
  });

  it("sets Content-Type from --content-type", async () => {
    const h = harness();
    await h.run("put", "doc.txt", "a.txt", "--content-type", "text/plain");
    expect(h.store.objects.get("doc.txt")?.headers.contentType).toBe("text/plain");
  });

  it("downloads to a file or stdout", async () => {
    const h = harness();
    await h.run("put", "doc.txt", "a.txt");
    expect(await h.run("download", "doc.txt", "-o", "out.txt")).toBe(EXIT.ok);
    expect(new TextDecoder().decode(h.files.get("out.txt"))).toBe("one");
    expect(await h.run("download", "doc.txt")).toBe(EXIT.ok);
    expect(h.out.at(-1)).toBe("one");
  });

  it("rm keeps history and lists keys", async () => {
    const h = harness();
    await h.run("put", "doc.txt", "a.txt");
    expect(await h.run("rm", "doc.txt")).toBe(EXIT.ok);
    expect(await h.run("download", "doc.txt")).toBe(EXIT.error);
    expect(await h.run("ls", "--json")).toBe(EXIT.ok);
    expect(JSON.parse(h.out.pop()!).keys).toEqual(["doc.txt"]);
  });

  it("maps invalid keys to a usage error", async () => {
    expect(await harness().run("put", "a/../b", "a.txt")).toBe(EXIT.usage);
  });

  it("emits machine-readable errors with --json", async () => {
    const h = harness();
    await h.run("put", "doc.txt", "a.txt");
    expect(await h.run("restore", "doc.txt", "nope", "--json")).toBe(EXIT.error);
    expect(JSON.parse(h.err.pop()!).error.code).toBe("VERSION_NOT_FOUND");
  });

  it("reconcile reports when nothing needs attention", async () => {
    const h = harness();
    expect(await h.run("reconcile")).toBe(EXIT.ok);
    expect(h.out.at(-1)).toBe("nothing to reconcile");
  });

  it("reconcile exits 4 on stuck operations and --accept-live resolves them", async () => {
    const h = harness();
    await h.run("put", "doc.txt", "a.txt");
    let manifestWrites = 0;
    h.store.fault = (op, key, phase) => {
      if (op === "put" && key === ".ver2/m/doc.txt" && phase === "before" && ++manifestWrites === 2) {
        h.store.fault = undefined;
        throw new Error("crash");
      }
    };
    expect(await h.run("put", "doc.txt", "b.txt")).toBe(EXIT.incomplete);
    h.store.putDirect("doc.txt", "someone else");
    expect(await h.run("reconcile")).toBe(EXIT.incomplete);
    expect(h.out.at(-1)).toContain("stuck");
    expect(await h.run("reconcile", "doc.txt", "--accept-live")).toBe(EXIT.ok);
  });
});
```

Run: `npm test -w @ver2/cli` → Expected: FAIL, cannot resolve `../src/main.js`.

- [x] **Step 2: Commands**

`cli/src/commands.ts`:
```ts
import type { RecoveryResult, Ver2, VersionRecord } from "@ver2/sdk";
import type { Output } from "./output.js";
import { EXIT, type Flags, type Io, UsageError } from "./types.js";

export interface CommandContext {
  args: string[];
  flags: Flags;
  client: Ver2;
  io: Io;
  out: Output;
}

export type Handler = (c: CommandContext) => Promise<number>;

function need(args: string[], count: number, usage: string): string[] {
  if (args.length < count) throw new UsageError(`usage: ver2 ${usage}`);
  return args;
}

const formatVersion = (v: VersionRecord) =>
  [
    v.versionId,
    v.createdAt,
    v.kind === "delete" ? "deleted" : `${v.size} B  sha256 ${v.sha256?.slice(0, 12)}`,
    v.source + (v.restoredFrom ? ` (from ${v.restoredFrom})` : ""),
  ].join("  ");

const formatRecovery = (r: RecoveryResult) => `${r.key}: ${r.outcome}${r.reason ? ` (${r.reason})` : ""}`;

export const COMMANDS: Record<string, Handler> = {
  async put({ args, flags, client, io, out }) {
    const [key, file] = need(args, 2, "put <key> <file>") as [string, string];
    const contentType = flags["content-type"];
    const r = await client.put(key, await io.readFile(file), contentType ? { headers: { contentType } } : {});
    out.result(r, `${r.key} → ${r.versionId} (${r.size} B, sha256 ${r.sha256.slice(0, 12)})`);
    return EXIT.ok;
  },

  async rm({ args, client, out }) {
    const [key] = need(args, 1, "rm <key>") as [string];
    const r = await client.delete(key);
    out.result(r, r.versionId ? `${r.key} deleted (marker ${r.versionId})` : `${r.key}: nothing to delete`);
    return EXIT.ok;
  },

  async ls({ args, client, out }) {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.list(args[0] ?? "", { cursor });
      keys.push(...page.keys);
      cursor = page.cursor;
    } while (cursor);
    out.result({ keys }, keys.join("\n"));
    return EXIT.ok;
  },

  async versions({ args, client, out }) {
    const [key] = need(args, 1, "versions <key>") as [string];
    const versions = await client.versions.list(key);
    out.result({ key, versions }, versions.length ? versions.map(formatVersion).join("\n") : `${key}: no history`);
    return EXIT.ok;
  },

  async restore({ args, client, out }) {
    const [key, versionId] = need(args, 2, "restore <key> <versionId>") as [string, string];
    const r = await client.versions.restore(key, versionId);
    out.result(r, `${r.key} restored from ${versionId} as ${r.versionId}`);
    return EXIT.ok;
  },

  async download({ args, flags, client, io, out }) {
    const [key, versionId] = need(args, 1, "download <key> [versionId]") as [string, string | undefined];
    const { record, body } = await client.versions.download(key, versionId);
    if (flags.output) {
      await io.writeFile(flags.output, body);
      out.result(
        { key, versionId: record.versionId, output: flags.output, sha256: record.sha256 },
        `${key}@${record.versionId} → ${flags.output} (sha256 verified)`,
      );
    } else {
      await io.writeStdout(body);
    }
    return EXIT.ok;
  },

  async reconcile({ args, flags, client, out }) {
    const options = { dryRun: flags["dry-run"] ?? false, acceptLive: flags["accept-live"] ?? false };
    const results: RecoveryResult[] = [];
    if (args[0]) {
      const r = await client.recover(args[0], options);
      if (r.outcome !== "none") results.push(r);
    } else {
      for await (const r of client.recoverAll(options)) results.push(r);
    }
    out.result({ results }, results.length ? results.map(formatRecovery).join("\n") : "nothing to reconcile");
    return results.some((r) => r.outcome === "stuck") ? EXIT.incomplete : EXIT.ok;
  },
};
```

- [x] **Step 3: Dispatcher**

`cli/src/main.ts`:
```ts
import { parseArgs } from "node:util";
import { COMMANDS } from "./commands.js";
import { loadConfig } from "./config.js";
import { output } from "./output.js";
import { EXIT, type Flags, type Io } from "./types.js";

export const USAGE = `Usage: ver2 <command> [options]

Commands:
  put <key> <file>            Upload <file> as a new version of <key>
  rm <key>                    Delete <key> (its history is kept)
  ls [prefix]                 List versioned keys
  versions <key>              Show the version history of <key>
  restore <key> <versionId>   Make <versionId> the current version again
  download <key> [versionId]  Write a version to stdout or --output (sha256 verified)
  reconcile [key]             Settle interrupted operations (all keys if omitted)

Options:
  --json                      Machine-readable output
  --content-type <type>       put: Content-Type of the new version
  -o, --output <file>         download: write to <file>
  --dry-run                   reconcile: report without changing anything
  --accept-live               reconcile: resolve stuck operations by keeping the live object
  -h, --help                  Show this help

Configuration (environment or .env.local):
  R2_ACCOUNT_ID or R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
  VER2_NAMESPACE (default .ver2)

Exit codes: 0 ok · 1 error · 2 usage/config · 3 conflict · 4 incomplete · 5 integrity`;

export async function main(argv: string[], io: Io): Promise<number> {
  let positionals: string[];
  let flags: Flags;
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: "boolean" },
        "content-type": { type: "string" },
        output: { type: "string", short: "o" },
        "dry-run": { type: "boolean" },
        "accept-live": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    positionals = parsed.positionals;
    flags = parsed.values;
  } catch (e) {
    io.stderr(`${(e as Error).message}\n\n${USAGE}`);
    return EXIT.usage;
  }

  if (flags.help) {
    io.stdout(USAGE);
    return EXIT.ok;
  }
  const [command, ...args] = positionals;
  if (!command) {
    io.stderr(USAGE);
    return EXIT.usage;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    io.stderr(`Unknown command "${command}".\n\n${USAGE}`);
    return EXIT.usage;
  }

  const out = output(io, flags.json ?? false);
  try {
    const client = io.client(loadConfig(io.env));
    return await handler({ args, flags, client, io, out });
  } catch (e) {
    return out.error(e);
  }
}
```

- [x] **Step 4: Run the tests**

Run: `npm test -w @ver2/cli` → Expected: 11 passed.

- [x] **Step 5: Binary entry point**

`cli/src/index.ts`:
```ts
#!/usr/bin/env node
import { createWriteStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { createClient } from "./config.js";
import { main } from "./main.js";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);

const toNode = (body: ReadableStream<Uint8Array>) => Readable.fromWeb(body as NodeReadableStream<Uint8Array>);

process.exitCode = await main(process.argv.slice(2), {
  stdout: (line) => void process.stdout.write(`${line}\n`),
  stderr: (line) => void process.stderr.write(`${line}\n`),
  env: process.env,
  readFile: async (path) => new Uint8Array(await readFile(path)),
  writeFile: (path, body) => pipeline(toNode(body), createWriteStream(path)),
  writeStdout: (body) => pipeline(toNode(body), process.stdout, { end: false }),
  client: createClient,
});
```

- [x] **Step 6: Build and smoke-test the binary**

Run:
```bash
npm run build
node cli/dist/index.js --help
```
Expected: the usage text, exit 0. Then `node cli/dist/index.js ls` with no credentials → `ver2: Missing configuration: …`, exit 2.

- [x] **Step 7: Commit**

```bash
git add cli
git commit -m "feat(cli): add put, rm, ls, versions, restore, download and reconcile"
```

---

### Task 17: End-to-end against R2, package READMEs

**Files:**
- Test: `sdk/test/integration/ver2.test.ts`
- Create: `sdk/README.md`, `cli/README.md`

- [x] **Step 1: Integration test**

`sdk/test/integration/ver2.test.ts`:
```ts
import { afterAll, describe, expect, it } from "vitest";
import { createVer2, type Ver2 } from "../../src/index.js";
import type { S3ObjectStore } from "../../src/storage/s3.js";
import { cleanup, hasR2, makeS3Store, runPrefix } from "./env.js";

const text = (s: ReadableStream<Uint8Array>) => new Response(s).text();

describe.skipIf(!hasR2)("Ver2 against R2", () => {
  const store = hasR2 ? makeS3Store() : (undefined as unknown as S3ObjectStore);
  // Namespace inside the run prefix so cleanup removes everything this run wrote.
  const ver2 = hasR2 ? createVer2({ store, namespace: `${runPrefix}.ver2` }) : (undefined as unknown as Ver2);
  afterAll(() => cleanup(store, runPrefix));

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
```

Run (with `.env.local`): `npm test -w @ver2/sdk -- integration` → Expected: contract (13) + Ver2 (3) passed.

- [x] **Step 2: Package READMEs**

`sdk/README.md`:
````markdown
# @ver2/sdk

Object versioning for Cloudflare R2. Live objects stay at their keys; every write keeps an immutable version.

```ts
import { createVer2 } from "@ver2/sdk";
import { S3ObjectStore } from "@ver2/sdk/s3";

const ver2 = createVer2({
  store: new S3ObjectStore({
    bucket: "my-bucket",
    accountId: process.env.R2_ACCOUNT_ID,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  }),
});

const { versionId } = await ver2.put("docs/report.pdf", bytes, { headers: { contentType: "application/pdf" } });
await ver2.versions.list("docs/report.pdf");
await ver2.versions.restore("docs/report.pdf", versionId);
await ver2.delete("docs/report.pdf");
```

Errors are `Ver2Error` subclasses; switch on `error.code`. See the repository README for guarantees and limitations.
````

`cli/README.md`:
````markdown
# @ver2/cli

```bash
npm i -g @ver2/cli
export R2_ACCOUNT_ID=… R2_BUCKET=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=…
ver2 put docs/report.pdf ./report.pdf --content-type application/pdf
ver2 versions docs/report.pdf
ver2 restore docs/report.pdf <versionId>
ver2 download docs/report.pdf <versionId> -o old.pdf
ver2 reconcile --dry-run
```

`ver2 --help` lists every command, option and exit code. Configuration is read from the environment or `.env.local`.
````

- [x] **Step 3: Full verification**

Run:
```bash
npm run typecheck
npm test
npm run build
```
Expected: all exit 0; integration suites pass with credentials, skip without.

- [x] **Step 4: Commit**

```bash
git add sdk/test/integration/ver2.test.ts sdk/README.md cli/README.md
git commit -m "test(sdk): add end-to-end R2 lifecycle tests and package READMEs"
```

---

## Out of scope (later phases, see the architecture spec)

Streaming/multipart bodies and staged uploads (Phase 2) · SQL metadata stores and `ver2 meta` commands (Phase 3) · Workers binding driver (Phase 4) · GC, retention, audit hooks, OpenTelemetry, authorization hooks (Phase 5).
