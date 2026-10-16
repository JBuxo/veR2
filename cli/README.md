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
