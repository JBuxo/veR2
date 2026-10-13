# veR2 Architecture

**Status:** Draft for review · **Date:** 2026-10-13 · **Evidence:** `testbench/` probe runs `2026-10-13T18-24-49-884Z-3udm`, `2026-10-13T18-36-05-466Z-8hrc` (local only)

## Goal

Object versioning for Cloudflare R2 that drops into an existing application. It scales from "one script with R2 credentials" to "multi-region enterprise deployment with a shared database, audit and retention". Every tier uses the same public API and the same on-bucket format, so moving up a tier is a configuration change, not a migration.

## Principles

1. **The read path never changes.** Live objects stay at their original keys. Public URLs, CDN caching, presigned GETs and direct reads keep working, and veR2 is never between a reader and R2.
2. **Writes go through veR2.** `put`, `delete` and `restore` replace direct `PutObject`/`DeleteObject` calls.
3. **R2 is always enough to recover.** Version bytes are immutable objects inside the bucket. Every metadata store either lives in R2 or can be rebuilt from it.
4. **Never guess.** Any operation whose outcome cannot be proven from evidence becomes `OperationIncomplete` and needs a human. It is never silently "fixed".
5. **Only verified guarantees.** Every storage behavior the design relies on was observed in the probe runs, in both runs.

## Verified R2 facts the design relies on

| Fact | Used for |
|---|---|
| `PutObject` `If-Match` / `If-None-Match: *` are exact CAS (8 racers → 1 winner, both runs) | Manifest lock + commit; immutable version objects |
| `CopyObject` `x-amz-copy-source-if-match` honored (412) | Preserving exactly the object that was inspected |
| `cf-copy-destination-if-match` / `cf-copy-destination-if-none-match: *` honored | Promoting a version to live without clobbering a concurrent direct write |
| Standard `If-Match` / `If-None-Match` on the copy **destination** are ignored | Never rely on them |
| `DeleteObject` ignores `If-Match` | Documented gap: a direct write between inspect and delete is lost |
| Aborted PUTs often land anyway; objects are never partially written | Pending-operation journal + evidence-based recovery |
| Single-part copy keeps ETag; multipart copy gets a new ETag | Identity = SHA-256 in metadata, never ETag |
| Metadata-only change keeps ETag | ETag cannot detect header edits |
| `.`/`..` segments are resolved by R2 (`a/b/../../x` → `x`), `%2E` too | Key policy rejects dot segments; traversal into the internal namespace is impossible through veR2 |
| NFC/NFD forms of a key address the same object | Keys are NFC-normalized before use |
| Key limit 1024 bytes | Key policy reserves room for the manifest path |
| Concurrent writes to one key → 429 | `StorageError { retryable: true }` |
| Unread response bodies pin sockets | Store drivers always consume or cancel bodies |
| HEAD errors carry no error code | Driver error mapping uses HTTP status |

## Components

```
┌──────────────────────────────── @ver2/sdk ─────────────────────────────────┐
│  Ver2 facade: put · delete · list · versions.{list,restore,download}       │
│              recover                                                       │
│        │                                                                   │
│  engine/  put · delete · restore · recover · promote · adopt               │
│        │                         │                                         │
│  keys (policy)   hash (SHA-256)  │   errors (public)                       │
│        │                         │                                         │
│  ObjectStore interface ◄─────────┴────────► MetadataStore interface        │
│   ├─ S3ObjectStore      (Phase 1)            ├─ ObjectStoreManifests (P1)  │
│   ├─ MemoryObjectStore  (Phase 1, tests)     ├─ SqliteMetadata       (P3)  │
│   └─ R2BindingStore     (Phase 4, Workers)   ├─ PostgresMetadata     (P3)  │
│                                              └─ D1Metadata           (P3)  │
└────────────────────────────────────────────────────────────────────────────┘
┌──────── @ver2/cli (`ver2`) ────────┐
│ put · rm · ls · versions · restore │──► same SDK
│ download · reconcile               │
└────────────────────────────────────┘
```

- **ObjectStore** is the only code that talks to object storage. It exposes conditional put/copy/get, head, delete, list and typed `StoreError`s (`precondition-failed`, `not-found`, `rate-limited`, `other`). Drivers advertise capabilities. Phase 4's binding driver lacks server-side copy, so the engine streams instead.
- **MetadataStore** is per-key manifest storage with compare-and-swap: `read(key) → {manifest, rev}` and `write(key, manifest, expectedRev)`. The engine is identical across stores.
- **The engine** is runtime-agnostic: Web Streams, `Uint8Array`, `crypto.getRandomValues`, `@noble/hashes`. No Node built-ins, so the same engine runs in Node, Bun, Deno and Workers.

## On-bucket layout (all tiers)

```
<key>                                   live object (unchanged location)
<ns>/m/<key>                            manifest (JSON) — ObjectStoreManifests only
<ns>/o/<sha256(key)>/<versionId>        immutable version bytes + original headers
```

`<ns>` defaults to `.ver2`. Keys under `<ns>/` are rejected by the key policy. Max user key = 1024 − bytes(`<ns>/m/`) (1016 for `.ver2`).

## Manifest

```ts
Manifest   { schema: 1, key, current: versionId|null, liveEtag: string|null,
             versions: VersionRecord[], pending: PendingOp|null }
VersionRecord { versionId, kind: "put"|"delete", objectKey?, sha256?, size?, etag?,
                headers?, source: "ver2"|"external"|"restore", restoredFrom?, createdAt }
PendingOp  { opId, type: "put"|"delete"|"restore", record, expectedLiveEtag, startedAt, stuck? }
```

`pending` is the operation journal. The manifest's CAS revision is the per-key lock. A pending op older than `leaseMs` (default 60 s) is presumed crashed and recovered. A younger one means "busy" (`ConcurrencyConflict`).

## Write algorithms

**put(key, bytes)**
1. Read manifest. If an op is pending: stuck → `OperationIncomplete`; within lease → `ConcurrencyConflict`; expired → recover first.
2. `HEAD key`. If its ETag ≠ `manifest.liveEtag`, someone wrote directly. Adopt the object: copy it to a version object (`source-if-match`, `dest-if-none-match: *`), hash it, and record it as `external`. If it is absent but the manifest says live, record an `external` delete marker.
3. Hash the bytes, then CAS-write the manifest with `pending = {put, record, expectedLiveEtag}`. This is the lock.
4. `PUT <ns>/o/…/<vid>` with `If-None-Match: *`.
5. Promote: `COPY version → key` with `source-if-match` plus `cf-copy-destination-if-match: expectedLiveEtag` (or `if-none-match: *` when absent). A 412 means a direct write raced us: abandon (clear pending, delete the orphan) → `ConcurrencyConflict`.
6. CAS-write the manifest: append the record, set `current`/`liveEtag`, clear `pending`.

**delete(key):** steps 1–2, then pending `{delete}`, then unconditional `DELETE key`, then commit a delete marker. The bytes are already safe, because the current version is always a version object (write-through).

**restore(key, vid):** steps 1–2, then pending `{restore}`, then promote the existing version object, then commit a new record with `source: restore` and `restoredFrom: vid`. No byte copy inside the history.

**Retried-request ambiguity:** a retried conditional request can 412 because its first attempt already landed. Each 412 path re-checks the evidence: live has the version's content (same ETag **and** same headers; ETag alone misses header-only changes), manifest bytes == what we wrote, version object exists with the expected size.

## Recovery (evidence table)

| Pending | Evidence | Outcome |
|---|---|---|
| put/restore | version object exists **and** live has the same content (ETag **and** headers) | roll forward (commit) |
| put/restore | live ETag == `expectedLiveEtag` | roll back (clear; delete orphan if put) |
| delete | live absent | roll forward |
| delete | live ETag == `expectedLiveEtag` | roll back |
| any | anything else | **stuck**: `OperationIncomplete`; `reconcile --accept-live` adopts the live object as an external version and clears |

## Tiers

| Tier | Install | Metadata | Fits |
|---|---|---|---|
| **Lite** | `@ver2/sdk` + R2 credentials | Manifests in R2 | Scripts, single servers, serverless, multi-instance. Zero extra infra. |
| **Team** | + `@ver2/sdk` SQL adapter | SQLite / Postgres / D1, plus a manifest mirror in R2 | Cross-key queries ("what changed today"), dashboards, retention |
| **Enterprise** | + Postgres authoritative, audit sink, policies | Postgres (manifests rebuildable from R2) | Audit trails, retention/legal hold, OTel, authz hooks, multi-bucket |
| **Edge** | + Workers binding driver | any of the above | Running veR2 inside Cloudflare Workers |

## Phases

| Phase | Delivers | Plan |
|---|---|---|
| 1 | Lite core: key policy, errors, S3 + memory stores, manifest store, put/delete/restore/download/recover, CLI | `plans/2026-10-13-ver2-phase1-core.md` |
| 2 | Large objects: streaming bodies, multipart (probe R2 conditional `CompleteMultipartUpload` first), staged uploads + `commit` for browser presigned PUTs | to write |
| 3 | SQL metadata stores (SQLite via `node:sqlite`, Postgres, D1 over HTTP), shared `MetadataStore` contract suite, `ver2 meta migrate`, `ver2 meta rebuild` from R2 | to write |
| 4 | Workers `R2Bucket` binding driver (probe `onlyIf` semantics; no server-side copy → streamed promote) | to write |
| 5 | Enterprise: GC + retention/legal hold, audit event hooks, OpenTelemetry, authorization hooks, multi-bucket | to write |

## Documented limitations

- A **direct** `DeleteObject` (or a direct write racing veR2's delete) cannot be prevented or undone. R2 ignores delete conditions.
- Direct writes are preserved on the next veR2 write to that key, unless another direct write overwrites them first.
- ~5–6 R2 requests per `put`. R2 allows roughly 1 write/s per key (manifest + live), so hot keys see 429s.
- Phase 1 buffers bodies in memory (single PUT, ≤ 5 GiB). Streaming arrives in Phase 2.
- A key's whole history lives in one manifest object that is read and CAS-rewritten about twice per write. At roughly 300–400 bytes per version, 10k versions is about 4 MB per round trip. Latency and the conflict window grow linearly with history length. Before GA: retention/pruning (Phase 5) and, if needed, segmented history (a small head manifest plus immutable history chunks).
- Manifest revisions are content-derived (ETags), so CAS compares contents, not versions. Exclusivity comes from the unique `opId` in each claim, not from a write succeeding.
- A corrupt or unsupported-schema manifest raises `MANIFEST_INVALID` for that key. Phase 1 has no automated repair: the version objects are intact, but the manifest must be fixed or removed by hand (`ver2 meta rebuild` from version objects is Phase 3).
- veR2's own delete has a residual race. It confirms its claim and that its lease is fresh (≤ half the lease) immediately before the unconditional DELETE. But if the process stalls longer than the lease between that check and the request, recovery can roll it back, another writer can commit, and the late DELETE removes that committed object. The next write records it as an external delete; the bytes stay in the version object. R2 offers no conditional DELETE to close this.
- After a client-side timeout, a writer settles its own op from evidence at once. A copy that lands on the server after that check but before the orphan is deleted can briefly leave live bytes the manifest doesn't know. The next write adopts them as `external`, so nothing is lost, but history is briefly incomplete.
- A copy of a multipart object gets a new ETag, so a lost-response adoption copy of a multipart live object can't be proven to have landed. veR2 reports `ConcurrencyConflict` (safe) instead of self-healing.
- The half-lease self-fence is checked before a promote is sent. A slow server-side copy of a large object can still land after the lease has expired and recovery has acted. The copy guards (`source-if-match`, `cf-copy-destination-if-match`) keep it from clobbering a newer committed state, but it can still land on a rolled-back state, where it is adopted as `external` on the next write.
- A request that fails without a response (network error or timeout) leaves its op pending: it may still land, so veR2 waits out the lease (60 s) before recovery decides, and retries see `ConcurrencyConflict` meanwhile. Only errors R2 actually answered (HTTP status) are settled immediately.
- An answered 5xx on a DELETE is treated as "did not apply" when live is still present. If it applies later, the next write records it as an `external` delete: history stays consistent but loses attribution.
- Header-only direct edits (same bytes, new headers) are not detected: live-state sync and promote guards compare ETags, which don't change. Such an edit is overwritten by the next veR2 write without being recorded.
- Lease expiry compares the local clock with a `startedAt` written by another client. Clock skew can make an in-flight op look crashed early, or make a crashed one wait longer. The CAS write and the copy guards keep this safe; it only affects liveness.
- Unreferenced objects can accumulate: adoption copies made before a lost claim, and version objects of ops that were abandoned without cleanup. They are harmless; Phase 5 GC collects them.
- A claim whose PUT landed but whose response was lost leaves a "ghost" lock. Retries see `ConcurrencyConflict` until the lease (60 s) expires and recovery rolls it back.
