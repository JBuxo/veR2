import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { S3ObjectStore } from "../../src/storage/s3.js";
import type { ObjectStore } from "../../src/storage/types.js";

// Credentials live in the repo-root .env.local (never committed).
const root = fileURLToPath(new URL("../../../", import.meta.url));
for (const f of [".env.local", ".env"]) if (existsSync(root + f)) process.loadEnvFile(root + f);

const env = process.env;
export const hasR2 = Boolean(
  env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && (env.R2_ACCOUNT_ID || env.R2_ENDPOINT),
);

/** Unique per run so concurrent CI runs never collide. */
export const runPrefix = `ver2-it/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}/`;

export function makeS3Store(): S3ObjectStore {
  return new S3ObjectStore({
    bucket: env.R2_BUCKET ?? "",
    accountId: env.R2_ACCOUNT_ID || undefined,
    endpoint: env.R2_ENDPOINT || undefined,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID ?? "", secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "" },
  });
}

export async function cleanup(store: ObjectStore, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await store.list(prefix, { cursor });
    for (const key of page.keys) await store.delete(key);
    cursor = page.cursor;
  } while (cursor);
}
