# veR2 — Technical Definitions & Research Notes

## Definitions

## Buckets

A bucket is a logical container for objects in object storage. Each object is identified by a key within that bucket.

For veR2, a bucket contains both the application's current objects and veR2's internal historical copies. veR2 must distinguish between user-managed objects and its reserved internal namespace.

**What to verify**

- How bucket names and endpoints are configured.
- Whether the intended R2 credentials have the required read, write, copy and delete permissions.
- How veR2's internal prefix is protected from accidental modification.
- Object key length limits and unusual keys, including Unicode and encoded characters.

### ETag

An entity tag is an identifier returned by object storage that can be used to determine whether an object representation has changed.

An ETag is not universally a cryptographic checksum. Multipart uploads and encryption can affect its relationship to the underlying content.

veR2 can use ETags for conditional operations where supported, but should not treat an ETag as proof that two objects contain identical bytes.

**What to verify**

- Whether ETags change after overwrites and copies.
- ETag behavior for multipart uploads.
- Whether copied objects retain or receive different ETags.
- Whether R2's conditional requests use the expected ETag semantics.

### HEAD

`HEAD` retrieves object metadata without returning the object body. In the S3 API, `HeadObject` can provide information such as size, ETag, content type, modification time and other metadata.

veR2 can use it to inspect an existing object before attempting to preserve it.

**What to verify**

- Which metadata fields R2 returns.
- How missing objects and insufficient permissions are reported.
- Whether conditional `HEAD` requests behave as expected.
- How metadata changes after a copy or overwrite.

### GET

`GET` retrieves an object's contents. `GetObject` can also return response metadata and supports streaming the object body.

veR2 may use it to download historical versions, calculate checksums, or restore data when a server-side copy is unsuitable.

**What to verify**

- Streaming behavior for large objects.
- How interrupted downloads and retries are handled.
- Whether response bodies must be explicitly consumed or closed.
- Range requests and multipart-related behavior where relevant.

### PUT

`PUT` creates or replaces an object at a specified key. Writing to an existing key normally changes the contents returned by subsequent reads.

This is the central operation veR2 needs to protect. Before replacing an existing object, veR2 must preserve its previous contents and ensure the preservation process succeeded.

**What to verify**

- Whether conditional writes are supported and under what conditions.
- Metadata and content-header behavior on overwrite.
- Request size limits and multipart upload requirements.
- What happens when a request times out after the server has processed it.

### DELETE

`DELETE` removes an object from its key. Without native bucket versioning, the application cannot assume that deleting the current object leaves its previous contents recoverable.

veR2 should implement logical deletion by preserving the current contents and recording a delete marker before removing the original key.

**What to verify**

- Deletion of existing versus missing objects.
- Whether repeated deletes behave consistently.
- Whether conditional deletion is supported.
- How partial failure between preserving the object, updating metadata and deleting the original is recovered.

### CopyObject

`CopyObject` copies an existing object to another key without requiring the application to download and re-upload its contents.

veR2 can use this to preserve an old object under a unique historical key before replacing the original.

**What to verify**

- Maximum supported single-copy object size and multipart copy requirements.
- Source and destination conditional headers.
- Metadata copying versus replacement.
- Whether the source can change between inspection and copy.
- How to verify the copied object's contents.

---

## Consistency, Conditional Requests and Concurrency

### Optimistic Concurrency Control

Optimistic concurrency control allows an operation to proceed only when the state it previously observed is still valid. It is useful when concurrent modifications are uncommon but must not silently overwrite one another.

For veR2, a writer might inspect an object's ETag and then attempt an operation conditional on the object still matching that ETag.

**Key limitation:** A conditional copy alone does not make the entire sequence of preserving the old object, writing the new object and committing metadata atomic.

### Compare-and-swap

Compare-and-swap means updating a value only if it still matches an expected value.

In veR2, the equivalent is checking that an object has not changed since it was inspected before performing a destructive operation.

A database can implement compare-and-swap on metadata, but that does not automatically provide compare-and-swap guarantees for an independently modified R2 object.

### If-Match / If-None-Match

These HTTP conditional headers allow requests to depend on an object's current representation.

- `If-Match`: proceed only if the supplied entity tag matches the current representation.
- `If-None-Match`: proceed only if the supplied entity tag does not match the current representation; `*` can express an existence-related condition for supported operations.

veR2 can use these to prevent certain stale reads or unintended overwrites, provided the relevant R2 operation supports the required condition.

**What to verify**

- Which R2 operations support each condition.
- Whether the condition applies to the source, destination or both.
- How failed preconditions are surfaced through the AWS SDK.
- Whether the guarantee is sufficient for the intended write algorithm.

### Race Conditions

A race condition occurs when the result of an operation depends on the timing or interleaving of concurrent operations.

For example, veR2 reads object A, another client replaces it with B, and veR2 then copies what is now B while believing it preserved A.

This can produce incorrect history even when every individual storage request succeeds.

### Idempotency

An operation is idempotent when repeating it produces the same logical outcome as executing it once.

Retries are unavoidable in distributed systems: a client may time out without knowing whether R2 completed its request.

veR2 should assign each logical operation an identifier and persist enough state to distinguish a retry from a new upload. It should not blindly create another version every time a request is retried.

### What happens if two clients overwrite the same key at nearly the same time?

Without coordination, both clients may inspect the same initial object and attempt to preserve or replace it. The resulting history may omit an intermediate version or associate the wrong contents with a version record.

veR2 must define its concurrency guarantee explicitly.

For the initial implementation, it can coordinate writers that pass through the same veR2 instance or shared metadata database. Conditional storage operations should protect against supported stale-write cases.

However, a local lock cannot coordinate other veR2 instances or external applications that write directly to R2. A shared database lock also cannot prevent an uncooperative external writer from changing the object between R2 operations.

**What to verify**

- Two concurrent writers using the same veR2 instance.
- Two independent veR2 processes sharing metadata.
- A veR2 writer racing with a direct R2 upload.
- Whether the proposed algorithm can detect a conflict or silently records incorrect history.

---

## Transactions and Crash Recovery

### Database Transactions

A database transaction groups database changes into an atomic unit. Either all changes in the transaction commit, or none do.

veR2 can use database transactions to create version records, update the current-version pointer and advance operation state consistently.

However, database transactions do not include R2 operations. A database commit cannot roll back an object upload or copy that has already succeeded.

### Unique Constraints

A unique constraint prevents duplicate values in a database column or combination of columns.

veR2 should enforce uniqueness for version identifiers and logical operation identifiers. This prevents retries from accidentally inserting duplicate records for the same operation.

Unique constraints are a safety mechanism, not a substitute for idempotency logic.

### Operation Journals

An operation journal persistently records the intent and progress of an operation.

For example, a journal entry may record the object key, operation ID, expected previous ETag, historical key, intended new version and current operation state.

The journal allows veR2 to identify incomplete work after a process crash rather than guessing from incomplete metadata.

### State Machines

A state machine defines the valid states of an operation and the transitions between them.

An initial veR2 write operation might progress through:

`PENDING → PRESERVING → PRESERVED → WRITING → COMMITTED`

Failures should leave the operation in a recoverable state, or explicitly mark it as requiring intervention.

Each transition must specify its preconditions, persistent updates and recovery behavior.

### Reconciliation

Reconciliation compares the metadata database with the actual state of R2 and resolves discrepancies where it is safe to do so.

Examples include:

- An operation marked `PRESERVED` whose historical object is missing.
- A historical object that exists but has no committed version record.
- An operation marked `WRITING` where the current object may or may not have been replaced.
- A database current-version pointer that does not match the observed object.

Reconciliation must not blindly retry destructive operations. It should inspect the actual state and either perform a safe repair or report an ambiguous operation.

### How do we recover when R2 succeeds but the metadata database update fails?

Suppose veR2 successfully copies the old object to its historical key but fails to commit the corresponding version record.

The historical bytes exist, but the database does not yet recognize them as a committed version.

The operation journal should already contain the intended historical key and operation ID. Recovery can inspect that key, verify its contents and complete the missing metadata transaction.

The more difficult case is when a new object upload succeeds but the final metadata commit fails. Recovery must determine whether the upload occurred, whether the current object still matches the expected operation and whether another writer intervened.

If the available evidence cannot establish a safe outcome, veR2 should flag the operation for manual recovery rather than guessing.

---

## Content Integrity and Metadata

### Checksums vs. ETags

A checksum is a calculated value used to verify content integrity. SHA-256 is suitable for verifying that a historical copy contains the same bytes as the original.

An ETag is an object-storage identifier with semantics that depend on the operation and implementation. It can be useful for conditional requests without being a universal content hash.

veR2 should use ETags for supported concurrency checks and SHA-256 for content-integrity verification.

### Immutable Object Keys

An immutable historical key is a unique key assigned to a version and never reused for a different version's contents.

For example:

`.r2vault/objects/<bucket-id>/<object-id>/<version-id>`

Once committed, the historical object should not be overwritten by normal veR2 operations.

This simplifies restoration, auditing and recovery because each version refers to a stable object location.

### Content Metadata

Objects can include HTTP metadata such as:

- `Content-Type`
- `Content-Disposition`
- `Cache-Control`
- `Content-Encoding`
- `Content-Language`
- Custom user metadata

A content-preserving copy must also preserve or intentionally transform the relevant metadata.

Restoring only the bytes may change how a browser or application serves the object, so veR2 must capture and restore the metadata that forms part of the application's expected behavior.

### Copy Semantics and Multipart Integrity

A server-side copy can preserve an object without transferring all its bytes through the application.

However, copy operations have source conditions, destination constraints, size limits and metadata semantics. Large objects may require multipart copy operations.

Multipart uploads can also produce ETags that are not ordinary MD5 hashes of the complete object.

veR2 should determine when a single copy is sufficient, when multipart handling is necessary and how each path verifies the resulting contents.

### How do we verify a historical copy contains the original bytes and can be restored correctly?

The strongest practical test is to calculate SHA-256 for the original contents, preserve the object, retrieve the historical copy and compare the hashes.

Then restore the historical version to the original key and calculate the hash again.

The test should also verify relevant HTTP metadata and include:

- Empty objects.
- Binary and Unicode content.
- Large objects and multipart uploads.
- Objects with custom metadata.
- Interrupted copies and restores.

Where streaming is used, the implementation should calculate the hash incrementally rather than loading an entire large object into memory.

---

## TypeScript SDK and CLI Engineering

### AWS SDK v3 S3 Client

The AWS SDK v3 S3 client provides typed commands for S3 operations and can target Cloudflare R2 using its S3-compatible endpoint.

veR2 should encapsulate SDK setup, credentials, endpoint configuration, request conditions, retries and response normalization.

The SDK's support for a command does not establish that R2 supports every feature or header associated with it.

### Typed Public APIs

The public API should expose stable concepts such as `put`, `delete`, `versions.list`, `versions.restore` and `versions.download`.

Consumers should receive predictable types for version records, operation results and errors without needing to understand internal database rows or R2-specific response structures.

Use explicit result types and typed exceptions for expected failure categories. Avoid exposing internal implementation details as part of the public contract.

### Command Parsing

The CLI translates user input into SDK operations.

It should validate commands and arguments, support machine-readable output where useful, and distinguish successful operations, conflicts, recoverable failures and configuration errors.

Destructive commands should be explicit, and recovery commands should support dry-run behavior.

### Configuration

Configuration should cover the R2 endpoint, bucket, credentials, metadata database location and internal namespace.

Credentials should be loaded from environment variables or a supported secret provider, never committed to source control or written to diagnostic logs.

The CLI and SDK should share configuration semantics without requiring the application to use the CLI's configuration files.

### Error Mapping and Integration Testing

The AWS SDK exposes service errors, transport errors and other exceptions. veR2 should normalize these into a smaller set of meaningful public errors, such as:

- `ObjectNotFound`
- `VersionNotFound`
- `ConcurrencyConflict`
- `IntegrityCheckFailed`
- `OperationIncomplete`
- `ConfigurationError`

Integration tests should run against a real R2 test bucket to validate actual API behavior. Unit tests can mock failures and exercise the operation state machine, but mocks cannot establish R2's real conditional-write or copy semantics.

### How do we expose a consistent developer API without leaking storage implementation details?

Keep the public API independent of the storage implementation wherever possible.

For example, `versions.restore(key, versionId)` should mean the same thing to a caller whether the implementation uses a server-side copy or a streamed download and upload.

Internally, the SDK can choose the appropriate storage operation based on verified capabilities. Public errors, return types and version semantics should remain consistent.

Document the limits of each guarantee explicitly, particularly around concurrent direct writes, crash recovery and metadata database loss.

---

## Research Completion Criteria

Before starting implementation, verify the following against a real R2 test bucket:

1. The required copy, conditional-write, read and delete operations behave as expected.
2. The concurrency strategy prevents or detects the conflicts it claims to handle.
3. Interrupted operations can be recovered without silently losing historical data.
4. SHA-256 verification succeeds for copied and restored objects, including multipart uploads.
5. Relevant HTTP metadata survives preservation and restoration.
6. The SDK and CLI can report incomplete or ambiguous operations without falsely reporting success.

The purpose of this research is not to prove that veR2 can never lose data. It is to establish precisely which guarantees we can implement, which guarantees R2 itself provides, and which failure cases must remain documented limitations.
