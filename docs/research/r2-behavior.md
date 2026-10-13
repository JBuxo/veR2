# Verified R2 behavior

veR2's guarantees depend on how Cloudflare R2 actually behaves, not on what the S3 API documents. Everything here was observed against real R2 through the S3 API with AWS SDK for JavaScript v3. Each item was observed in two independent runs on 2026-10-13 unless noted.

When R2 changes, update this file. Contributors adding a new storage assumption must add an entry here, with how it was observed, plus a case in `sdk/test/storage/contract.ts`.

## Conditional requests

| Operation | Condition | Observed |
|---|---|---|
| PutObject | `If-None-Match: *` | Honored: 412 if the key exists |
| PutObject | `If-Match: <etag>` | Honored: 412 if stale **or** the key is missing |
| PutObject | `If-None-Match: <etag>` (not `*`) | Proceeds when the ETag differs (standard HTTP semantics) |
| CopyObject | `x-amz-copy-source-if-match` / `-if-none-match` / `-if-unmodified-since` | Honored (412) |
| CopyObject | `If-Match` / `If-None-Match` on the **destination** | **Ignored**: destination overwritten |
| CopyObject | `cf-copy-destination-if-match` / `cf-copy-destination-if-none-match: *` | Honored (412; 200 on match or absent). Observed in one run, then confirmed in the full re-run |
| DeleteObject | `If-Match` | **Ignored**: object deleted despite a stale ETag |
| HeadObject / GetObject | `If-Match` / `If-None-Match` | Honored (412 / 304) |

## Concurrency

- 8 clients racing `PutObject If-Match` on the same ETag: exactly 1 succeeded, 7 got 412 (both runs).
- 8 clients racing `If-None-Match: *`: exactly 1 succeeded (both runs).
- 8 unconditional writers to one key: 4 succeeded, 4 got **429** (per-key write rate limit).
- Unread response bodies hold sockets: with a 2-socket pool and two unread GET bodies, a third request stalled until aborted.

## Ambiguous outcomes

- Client-aborted 8 MiB PUTs, aborted at fractions of the measured upload time: aborts early in the upload never landed. Aborts at roughly ≥ 50% of the upload time usually landed even though the client saw an error. Exact boundaries vary by run.
- No partially written object was ever observed.

## ETags

- Single-part ETag is the quoted MD5 of the content; identical bytes produce identical ETags.
- Metadata-only rewrites keep the same ETag.
- CopyObject keeps the ETag for single-part sources. For a multipart source, the copy gets a **new**, plain-MD5-style ETag (bytes identical).
- `UploadPartCopy` reassembly keeps the multipart `-N` ETag form.

## Keys

- Max key length is 1024 bytes (1025 rejected with `InvalidObjectName`).
- Spaces, `+`, `%`, `?`, `#`, backslash, tab, emoji, CJK, `//` and a trailing `/` all round-trip through put/head/get/list/copy/delete.
- NFC and NFD spellings of the same text address **the same object**.
- **Dot segments:** R2 removes `.` and `..` path segments (after decoding `%2E`) before verifying the signature and storing the object. Requests signed over the literal path fail with `SignatureDoesNotMatch` (that's what the AWS SDK does). Requests signed over the normalized path succeed and store under the normalized key: `a/b/../../leaf` is stored as `leaf`. Literal dot-segment keys cannot exist through the S3 API. Dots inside a segment (`.hidden`, `..x`, `x..`) are ordinary characters.

## Multipart

- All non-final parts must be the same size (`InvalidPart` otherwise), and each must be at least 5 MiB (`EntityTooSmall`).
- `@aws-sdk/lib-storage` `Upload` works with fixed part sizes.

## Other

- Missing keys: HEAD → 404 with no error code (map by status), GET → `NoSuchKey`, DELETE → 204.
- Range requests: suffix and open-ended ranges work; unsatisfiable → 416; multi-range → 400.
- Non-ASCII custom metadata values are rejected client-side by Node's HTTP layer before reaching R2.
- `MetadataDirective: REPLACE` resets every content header that is not re-sent.
