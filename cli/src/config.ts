import { ConfigurationError, createVer2, type Ver2 } from "@ver2/sdk";
import { S3ObjectStore } from "@ver2/sdk/s3";

export interface Ver2Config {
  bucket: string;
  accountId?: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  namespace?: string;
}

export function loadConfig(env: Record<string, string | undefined>): Ver2Config {
  const missing: string[] = [];
  if (!env.R2_BUCKET) missing.push("R2_BUCKET");
  if (!env.R2_ACCOUNT_ID && !env.R2_ENDPOINT) missing.push("R2_ACCOUNT_ID or R2_ENDPOINT");
  if (!env.R2_ACCESS_KEY_ID) missing.push("R2_ACCESS_KEY_ID");
  if (!env.R2_SECRET_ACCESS_KEY) missing.push("R2_SECRET_ACCESS_KEY");
  if (missing.length > 0) {
    throw new ConfigurationError(`Missing configuration: ${missing.join(", ")}. Set them in the environment or .env.local.`);
  }
  return {
    bucket: env.R2_BUCKET as string,
    accountId: env.R2_ACCOUNT_ID || undefined,
    endpoint: env.R2_ENDPOINT || undefined,
    accessKeyId: env.R2_ACCESS_KEY_ID as string,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY as string,
    namespace: env.VER2_NAMESPACE || undefined,
  };
}

export function createClient(config: Ver2Config): Ver2 {
  const store = new S3ObjectStore({
    bucket: config.bucket,
    accountId: config.accountId,
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return createVer2({ store, namespace: config.namespace });
}
