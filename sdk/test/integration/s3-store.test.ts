import { afterAll, describe } from "vitest";
import type { S3ObjectStore } from "../../src/storage/s3.js";
import { objectStoreContract } from "../storage/contract.js";
import { cleanup, hasR2, makeS3Store, runPrefix } from "./env.js";

describe.skipIf(!hasR2)("S3ObjectStore against R2", () => {
  const store = hasR2 ? makeS3Store() : (undefined as unknown as S3ObjectStore);
  afterAll(() => cleanup(store, runPrefix));
  objectStoreContract("s3 (R2)", () => ({ store, prefix: runPrefix }));
});
