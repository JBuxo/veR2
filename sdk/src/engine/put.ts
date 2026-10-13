import { sha256Hex, toBytes } from "../hash.js";
import { canonicalKey } from "../keys.js";
import type { PendingOp, VersionRecord } from "../meta/types.js";
import { isPreconditionFailed, type ObjectHeaders } from "../storage/types.js";
import { claim, loadForWrite } from "./claim.js";
import type { EngineContext } from "./context.js";
import { syncLive } from "./live.js";
import { promote } from "./promote.js";
import { runClaimed } from "./run-claimed.js";

export interface PutOptions {
  headers?: ObjectHeaders;
}

export interface PutResult {
  key: string;
  versionId: string;
  sha256: string;
  size: number;
  /** ETag of the live object after the write. */
  etag: string;
}

export async function put(ctx: EngineContext, rawKey: string, data: Uint8Array | string, options: PutOptions = {}): Promise<PutResult> {
  const key = canonicalKey(rawKey, ctx.policy);
  const bytes = toBytes(data);
  const loaded = await loadForWrite(ctx, key);
  const live = await ctx.store.head(key);
  const manifest = await syncLive(ctx, key, loaded.manifest, live);

  const versionId = ctx.newId();
  const objectKey = ctx.paths.versionKey(key, versionId);
  const sha256 = sha256Hex(bytes);
  const headers = options.headers ?? {};
  const record: VersionRecord = {
    versionId,
    kind: "put",
    objectKey,
    sha256,
    size: bytes.byteLength,
    headers,
    source: "ver2",
    createdAt: ctx.now().toISOString(),
  };
  const op: PendingOp = {
    opId: ctx.newId(),
    type: "put",
    record,
    expectedLiveEtag: live?.etag ?? null,
    startedAt: ctx.now().toISOString(),
  };
  const rev = await claim(ctx, key, manifest, loaded.rev, op);

  const { liveEtag } = await runClaimed(
    ctx,
    key,
    { manifest, rev, op },
    async () => {
      const objectEtag = await putVersionObject(ctx, objectKey, bytes, headers);
      return { objectEtag, liveEtag: await promote(ctx, key, objectKey, objectEtag, op.expectedLiveEtag) };
    },
    (r) => ({
      ...manifest,
      versions: [...manifest.versions, { ...record, etag: r.objectEtag }],
      current: versionId,
      liveEtag: r.liveEtag,
      pending: null,
    }),
  );
  return { key, versionId, sha256, size: bytes.byteLength, etag: liveEtag };
}

async function putVersionObject(ctx: EngineContext, objectKey: string, bytes: Uint8Array, headers: ObjectHeaders): Promise<string> {
  try {
    return (await ctx.store.put(objectKey, bytes, { headers, ifNoneMatch: "*" })).etag;
  } catch (e) {
    if (!isPreconditionFailed(e)) throw e;
    // Version keys are unique per operation, so an object already here is our own earlier attempt.
    const existing = await ctx.store.head(objectKey);
    if (existing && existing.size === bytes.byteLength) return existing.etag;
    throw e;
  }
}
