## What and why

<!-- What changes, and the problem it solves. Link the issue: Closes #… -->

## How it was tested

- [ ] `npm test` and `npm run typecheck` pass
- [ ] New write paths have crash-before / crash-after / direct-write-race tests
- [ ] Ran R2 integration tests against a real bucket (say which, or why not)

## Checklist

- [ ] Storage driver behavior changed → contract case added in `sdk/test/storage/contract.ts`
- [ ] New R2 assumption → evidence recorded in `docs/research/r2-behavior.md`
- [ ] Public API changed → README / package README updated
- [ ] No credentials, `.env*` files or probe output committed
