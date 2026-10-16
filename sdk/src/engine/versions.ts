import { CorruptManifestError, IntegrityCheckFailedError, ObjectNotFoundError, VersionNotFoundError } from "../errors.js";
import { verifyingStream } from "../hash.js";
import { canonicalKey } from "../keys.js";
import type { VersionRecord } from "../meta/types.js";
import { isPreconditionFailed } from "../storage/types.js";
import type { EngineContext } from "./context.js";
import { isOwnVersionObject } from "./evidence.js";

export interface DownloadResult {
  record: VersionRecord;
  /** Errors with IntegrityCheckFailedError at the end if the SHA-256 does not match. */
  body: ReadableStream<Uint8Array>;
}

/** Version history, newest first. */
export async function listVersions(ctx: EngineContext, rawKey: string): Promise<VersionRecord[]> {
  const key = canonicalKey(rawKey, ctx.policy);
  const snap = await ctx.meta.read(key);
  return snap ? [...snap.manifest.versions].reverse() : [];
}

export async function download(ctx: EngineContext, rawKey: string, versionId?: string): Promise<DownloadResult> {
  const key = canonicalKey(rawKey, ctx.policy);
  const snap = await ctx.meta.read(key);
  const id = versionId ?? snap?.manifest.current ?? null;
  if (!snap || id === null) throw new ObjectNotFoundError(key);
  const record = snap.manifest.versions.find((v) => v.versionId === id && v.kind === "put");
  const objectKey = record?.objectKey;
  const expected = record?.sha256;
  if (!record || !objectKey || !expected) throw new VersionNotFoundError(key, id);
  // The manifest names the object we read: never let it point outside this key's history.
  if (!isOwnVersionObject(ctx, key, objectKey)) {
    throw new CorruptManifestError(key, `version ${id} points outside this key's history`);
  }

  let res;
  try {
    res = await ctx.store.get(objectKey, { ifMatch: record.etag });
  } catch (e) {
    if (isPreconditionFailed(e)) throw new IntegrityCheckFailedError(key, id, "the version object was replaced");
    throw e;
  }
  if (!res) throw new IntegrityCheckFailedError(key, id, "the version object is missing");
  const verify = verifyingStream(expected, (actual) => new IntegrityCheckFailedError(key, id, `sha256 ${actual} does not match ${expected}`));
  return { record, body: res.body.pipeThrough(verify) };
}
