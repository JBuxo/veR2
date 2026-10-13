# Contributing to veR2

Thanks for helping. veR2 protects people's data, so the bar is correctness first: every change comes with tests, and every assumption about R2 comes with evidence.

## Before you start

- **Bugs and small fixes:** open a PR directly, or an issue if you're unsure.
- **Features, new dependencies, API changes:** open an issue first so we can agree on the design. Larger work follows the spec → plan → implementation flow in `docs/superpowers/`.
- Read [AGENTS.md](AGENTS.md). Its architecture invariants and testing rules apply to humans too.

## Setup

Requires Node.js ≥ 22.

```bash
git clone https://github.com/JBuxo/ver2.git
cd ver2
npm install
npm test
npm run typecheck
```

### Running the R2 integration tests

Unit tests run against an in-memory store and need nothing. The integration tests prove that store matches real R2, and they need a bucket:

1. In the Cloudflare dashboard → **R2** → create a bucket used **only for testing**.
2. **Manage API tokens** → **Create API token**: permission **Object Read & Write**, scoped to that bucket only.
3. Copy `.env.example` to `.env.local` and fill in the account ID, bucket, access key ID and secret. `.env.local` is git-ignored.
4. `npm test`. Tests write under `ver2-it/<run>/` and delete what they create.

## Making a change

1. Branch from `main`.
2. Write a failing test, make it pass, refactor. Write paths need crash and race tests (see AGENTS.md → Testing rules).
3. Changed how a storage driver behaves? Add a case to `sdk/test/storage/contract.ts`.
4. Relying on new R2 behavior? Record what you observed and how in `docs/research/r2-behavior.md`.
5. `npm test && npm run typecheck`.
6. Commit with [Conventional Commits](https://www.conventionalcommits.org/) (`feat(sdk): …`, `fix(cli): …`).

## Pull requests

- Keep PRs focused; one logical change each.
- Fill in the PR template, including whether you ran the R2 integration tests.
- CI must pass. A maintainer runs integration tests against R2 before merging changes to storage drivers or the engine.

## Code of conduct

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).
