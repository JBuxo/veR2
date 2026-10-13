@AGENTS.md

## Claude Code notes

- Project rules live in `AGENTS.md` (imported above). Update that file, not this one, when a rule applies to every agent.
- Implementation plans live in `docs/superpowers/plans/`. Execute them task-by-task and tick the checkboxes as you go.
- `testbench/` (if present) is a maintainer's local R2 probe harness, excluded from git. Never commit it or copy its output into the repo. Summarize findings in `docs/research/r2-behavior.md` instead.
- Before claiming a task is done, run `npm test` and `npm run typecheck` and report the actual output.
