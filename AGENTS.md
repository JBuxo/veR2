# AGENTS.md

Instructions for AI coding agents (and humans) working in this repository. Tool-specific files such as `CLAUDE.md` import this one, so keep project rules **here**.

## What this is

**veR2** adds object versioning to Cloudflare R2. Live objects stay at their keys, and every `put` / `delete` / `restore` keeps an immutable version in a reserved namespace (`.ver2/`). It ships as `@ver2/sdk` (library) and `@ver2/cli` (`ver2` command).

Status: **pre-alpha**. Design is in `docs/superpowers/specs/2026-10-13-ver2-architecture.md`; Phase 1 (SDK + CLI, plan `docs/superpowers/plans/2026-10-13-ver2-phase1-core.md`) is complete and published on npm as `0.1.x`. The website follows `docs/superpowers/plans/2026-10-16-ver2-site.md`.

## Repository layout

```
sdk/          @ver2/sdk: engine, storage drivers, metadata stores
cli/          @ver2/cli: the `ver2` command (thin wrapper over the SDK)
site/         @ver2/site: website (landing + docs), static export, never published
docs/
  superpowers/specs/    architecture and design decisions
  superpowers/plans/    implementation plans (task-by-task, TDD)
  research/             verified R2 behavior the design depends on
what-is-defined.md      original research questions
```

## Commands

```bash
npm install                 # once, at the repo root
npm test                    # all workspaces; R2 integration tests skip without credentials
npm run typecheck
npm run build
npm test -w @ver2/sdk -- put    # one package, filtered by file name
npm run dev -w @ver2/site       # website at http://localhost:3000
```

R2 integration tests read the repo-root `.env.local` (`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). Use a **dedicated test bucket**. Tests write under `ver2-it/<run>/` and clean up after themselves.

## Architecture invariants (do not break)

1. **The read path never changes.** Live objects stay at their original keys. Never move, rename or wrap them.
2. **Every write is journaled.** Claim (`pending` in the manifest, CAS) → storage work → commit. Never write to the live key before the claim is persisted.
3. **Version objects are immutable.** Create them with `If-None-Match: *` under a fresh ULID. Never overwrite one.
4. **Promotion is guarded.** Copy version → live with `cf-copy-destination-if-match` / `-if-none-match`. The standard `If-Match` on a copy destination is **ignored by R2**; don't use it.
5. **Identity is SHA-256, not ETag.** ETags change on multipart copies and don't change on metadata-only edits.
6. **Never guess.** If recovery can't prove the outcome from storage evidence, mark the op `stuck` and surface `OperationIncomplete`. Never retry a destructive step blindly.
7. **Validate keys first.** Every public entry point runs `canonicalKey` (NFC, no lone surrogates, no C0/DEL control characters, no `.`/`..` segments, not inside the namespace, length limit) before any I/O. R2 resolves dot segments, so an unvalidated key can write somewhere else. Backslash is allowed: it round-trips on R2 through the S3 API, and storage drivers must percent-encode keys rather than building URLs with WHATWG parsing (which turns `\` into `/`).
8. **`sdk/src` is runtime-agnostic.** No `node:*` imports. Use Web Streams, `Uint8Array`, `crypto.getRandomValues`, `@noble/hashes`. It must run in Workers later.
9. **Storage behavior needs evidence.** Any new assumption about R2 (a header, a status code, a consistency property) needs a recorded observation against real R2 in `docs/research/r2-behavior.md`, plus a case in the `ObjectStore` contract suite.

## Testing rules

- **TDD.** Write the failing test first, watch it fail, implement, watch it pass.
- **Unit tests use `MemoryObjectStore`**, which mirrors verified R2 semantics and supports fault injection (`fault` hook: throw in `before` = failed request, throw in `after` = request landed but the response was lost). Use `putDirect` to simulate non-veR2 clients.
- **The contract suite** (`sdk/test/storage/contract.ts`) runs against both the memory store and real R2. If you change store behavior, add a contract case so the fake can't drift from reality.
- **Crash paths are first-class.** Every new write path needs tests for: crash before the storage work, crash after it but before commit, and a direct write racing it.
- Don't mock the AWS SDK. Test `S3ObjectStore` against R2 through the contract suite.

## Code style

- TypeScript strict, ESM, `nodenext`; relative imports end in `.js`.
- Public errors are `Ver2Error` subclasses with a stable `code`. Internal storage failures are `StoreError` and are mapped at the facade (`toPublicError`).
- Small files with one responsibility. Match the surrounding comment density: explain *why* (usually an R2 quirk), not *what*.
- No new runtime dependencies in `sdk` without discussion in an issue.

## Commits and PRs

- Conventional Commits (`feat(sdk): …`, `fix(cli): …`, `docs: …`, `test: …`, `chore: …`).
- One logical change per commit. PRs need passing `npm test` and `npm run typecheck`, and must say whether R2 integration tests were run.
- Never commit credentials, `.env*` files (except `.env.example`), bucket names from real deployments, or probe output.

## Security

- Credentials come from the environment or `.env.local`. Never log them, never put them in error messages or test fixtures.
- Report vulnerabilities privately (see `SECURITY.md`), not in issues.
- Treat key validation and the reserved namespace as security boundaries.
