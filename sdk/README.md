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
