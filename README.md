# veR2

**Object versioning for Cloudflare R2.** Add version history to an existing R2 bucket without changing how anything reads from it.

> **Status: pre-alpha.** The architecture is designed and the R2 behavior it depends on has been verified. Phase 1 (SDK + CLI) is published on npm as `0.1.x`: `npm i @ver2/sdk` / `npm i -g @ver2/cli`. APIs will change.

## Why

R2 has no native object versioning. An overwrite or delete is permanent. veR2 keeps every version, lets you restore any of them, and tells you honestly when it can't guarantee something.

## How it works

```
your app ──► veR2 SDK ──► R2 bucket
                            ├── uploads/a.png         live object (same key as always)
                            ├── .ver2/o/…/<version>   immutable version bytes
                            └── .ver2/m/uploads/a.png manifest: history + in-flight op journal
readers ──────────────────► uploads/a.png   (unchanged: CDN, public URLs, presigned GETs)
```

- **Reads don't change.** Live objects stay at their keys, and veR2 is never in the read path.
- **Writes go through veR2.** Each write keeps an immutable copy, promotes it to the live key with R2's conditional-copy guards, and journals every step so a crash can be finished or undone from evidence.
- **Direct writes are caught.** If something writes to R2 behind veR2's back, the next veR2 write preserves that object as an `external` version before replacing it.
- **Only R2 credentials needed** at the Lite tier. Metadata lives in the bucket. SQL metadata stores (SQLite, Postgres, D1), a Workers driver and enterprise features (retention, audit, policies) are planned. See the [architecture](docs/superpowers/specs/2026-10-13-ver2-architecture.md).

```ts
import { createVer2 } from "@ver2/sdk";
import { S3ObjectStore } from "@ver2/sdk/s3";

const ver2 = createVer2({ store: new S3ObjectStore({ bucket, accountId, credentials }) });

const { versionId } = await ver2.put("docs/report.pdf", bytes);
await ver2.versions.list("docs/report.pdf");
await ver2.versions.restore("docs/report.pdf", versionId);
```

```bash
ver2 put docs/report.pdf ./report.pdf
ver2 versions docs/report.pdf
ver2 restore docs/report.pdf <versionId>
```

## Guarantees and limitations

veR2 guarantees what R2 lets it guarantee and documents the rest. The evidence is in [docs/research/r2-behavior.md](docs/research/r2-behavior.md).

| | |
|---|---|
| ✅ Concurrent veR2 writers to one key | Serialized; losers get `ConcurrencyConflict` |
| ✅ A direct write racing a veR2 write | Detected; never silently clobbered |
| ✅ Crash mid-operation | Rolled forward/back from evidence, or flagged `OperationIncomplete` |
| ✅ Version integrity | SHA-256 verified on download |
| ⚠️ Direct deletes (outside veR2) | Cannot be prevented or undone: R2 ignores delete conditions |
| ⚠️ Hot keys | R2 allows about 1 write/s per key; expect 429s on rapid rewrites |
| ⚠️ Large objects | Phase 1 buffers bodies in memory; streaming/multipart comes in Phase 2 |

## Repository

| Path | |
|---|---|
| `sdk/` | `@ver2/sdk`: engine, storage drivers, metadata stores |
| `cli/` | `@ver2/cli`: the `ver2` command |
| `site/` | Website: landing page and docs (Next.js, static export) |
| `docs/superpowers/specs/` | Architecture and design decisions |
| `docs/superpowers/plans/` | Implementation plans |
| `docs/research/` | Verified R2 behavior |
| `what-is-defined.md` | The original research questions |

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md). AI coding agents should read [AGENTS.md](AGENTS.md). Report security issues privately per [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE)
