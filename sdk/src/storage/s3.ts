import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { ConfigurationError } from "../errors.js";
import {
  type CopyOptions,
  type GetOptions,
  type ListResult,
  type ObjectHeaders,
  type ObjectInfo,
  type ObjectStore,
  type PutOptions,
  StoreError,
} from "./types.js";

export interface S3StoreOptions {
  bucket: string;
  /** Cloudflare account id; derives https://<accountId>.r2.cloudflarestorage.com when `endpoint` is not set. */
  accountId?: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  /**
   * Bring your own client. Overrides endpoint, credentials, retries and timeouts, and bypasses the R2 endpoint
   * check. You are then responsible for `requestChecksumCalculation` / `responseChecksumValidation` = "WHEN_REQUIRED",
   * which R2 needs.
   */
  client?: S3Client;
  /** Total attempts per request (default 3). */
  maxAttempts?: number;
  /**
   * Per-request timeout in ms (default 60000). The timer also covers uploading the request body, so a large single
   * PUT on a slow link can exceed it; Phase 1 buffers bodies, so raise it for large objects. Once response headers
   * arrive there is no idle timeout on the body stream.
   */
  requestTimeoutMs?: number;
  /** Connection timeout in ms (default 10000). */
  connectionTimeoutMs?: number;
  /** veR2's guards rely on R2's cf-copy-destination-* headers; other S3 servers silently ignore them. */
  allowNonR2Endpoint?: boolean;
}

interface HeadLike {
  ETag?: string;
  ContentLength?: number;
  LastModified?: Date;
  ContentType?: string;
  ContentDisposition?: string;
  CacheControl?: string;
  ContentEncoding?: string;
  ContentLanguage?: string;
  Metadata?: Record<string, string>;
}

const compact = (h: ObjectHeaders): ObjectHeaders =>
  Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined)) as ObjectHeaders;

function toInfo(key: string, res: HeadLike): ObjectInfo {
  return {
    key,
    etag: res.ETag ?? "",
    size: res.ContentLength ?? 0,
    lastModified: res.LastModified ?? new Date(0),
    headers: compact({
      contentType: res.ContentType,
      contentDisposition: res.ContentDisposition,
      cacheControl: res.CacheControl,
      contentEncoding: res.ContentEncoding,
      contentLanguage: res.ContentLanguage,
      metadata: res.Metadata ?? {},
    }),
  };
}

const NETWORK_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN", "ECONNABORTED", "EHOSTUNREACH", "ENETUNREACH", "ERR_STREAM_PREMATURE_CLOSE"]);

/** R2 HEAD errors carry no error code, so classify by HTTP status. No status means no HTTP response: network. */
function toStoreError(op: string, key: string, e: unknown): StoreError {
  const x = e as { $metadata?: { httpStatusCode?: number }; name?: string; code?: string; $retryable?: unknown };
  const status = x?.$metadata?.httpStatusCode;
  const message = e instanceof Error ? e.message : String(e);
  if (status === undefined && (x?.name === "TimeoutError" || x?.name === "AbortError" || (x?.code !== undefined && NETWORK_CODES.has(x.code)) || x?.$retryable)) {
    return new StoreError("network", `${op} ${key}: network ${message}`, undefined, { cause: e });
  }
  const kind =
    status === 412 ? "precondition-failed" : status === 404 ? "not-found" : status === 429 ? "rate-limited" : "other";
  return new StoreError(kind, `${op} ${key}: HTTP ${status ?? "?"} ${message}`, status, { cause: e });
}

const needEtag = (op: string, key: string, etag: string | undefined): string => {
  if (!etag) throw new StoreError("other", `${op} ${key}: response had no ETag`);
  return etag;
};

const copySource = (bucket: string, key: string) => `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

/** Attach headers the SDK input types don't model (R2's cf-copy-destination-*). Added before signing. */
function withHeaders(cmd: CopyObjectCommand, headers: Record<string, string>): CopyObjectCommand {
  if (Object.keys(headers).length === 0) return cmd;
  cmd.middlewareStack.add(
    (next) => async (args) => {
      const request = args.request as { headers?: Record<string, string> };
      if (!request.headers) throw new Error("cannot attach cf-copy-destination guard: request has no headers");
      Object.assign(request.headers, headers);
      return next(args);
    },
    { step: "build", name: "ver2CopyDestinationConditions" },
  );
  return cmd;
}

/** ObjectStore over the S3 API for Cloudflare R2 only: the guards depend on R2-specific headers. */
export class S3ObjectStore implements ObjectStore {
  readonly bucket: string;
  private readonly client: S3Client;

  constructor(options: S3StoreOptions) {
    if (!options.bucket) throw new ConfigurationError("S3ObjectStore: bucket is required");
    this.bucket = options.bucket;
    if (options.client) {
      this.client = options.client;
      return;
    }
    const endpoint =
      options.endpoint ?? (options.accountId ? `https://${options.accountId}.r2.cloudflarestorage.com` : undefined);
    if (!endpoint) throw new ConfigurationError("S3ObjectStore: endpoint or accountId is required");
    let hostname: string;
    try {
      hostname = new URL(endpoint).hostname;
    } catch {
      throw new ConfigurationError(`S3ObjectStore: endpoint is not a valid URL: ${JSON.stringify(endpoint)}`);
    }
    if (!options.allowNonR2Endpoint && !hostname.endsWith(".r2.cloudflarestorage.com")) {
      throw new ConfigurationError(
        "S3ObjectStore: endpoint is not an R2 endpoint. veR2's guards rely on R2's cf-copy-destination-* headers, which other S3 implementations silently ignore. Set allowNonR2Endpoint: true to override.",
      );
    }
    this.client = new S3Client({
      region: "auto",
      endpoint,
      credentials: options.credentials,
      maxAttempts: options.maxAttempts ?? 3,
      requestHandler: {
        requestTimeout: options.requestTimeoutMs ?? 60_000,
        connectionTimeout: options.connectionTimeoutMs ?? 10_000,
        throwOnRequestTimeout: true,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      needEtag("head", key, res.ETag);
      return toInfo(key, res);
    } catch (e) {
      if (e instanceof StoreError) throw e;
      const err = toStoreError("head", key, e);
      if (err.kind === "not-found") return null;
      throw err;
    }
  }

  async get(key: string, options: GetOptions = {}): Promise<{ info: ObjectInfo; body: ReadableStream<Uint8Array> } | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, IfMatch: options.ifMatch }));
      if (!res.Body) throw new StoreError("other", `get ${key}: response had no body`);
      if (!res.ETag) {
        await res.Body.transformToWebStream().cancel();
        throw new StoreError("other", `get ${key}: response had no ETag`);
      }
      return { info: toInfo(key, res), body: res.Body.transformToWebStream() as ReadableStream<Uint8Array> };
    } catch (e) {
      if (e instanceof StoreError) throw e;
      const err = toStoreError("get", key, e);
      if (err.kind === "not-found") return null;
      throw err;
    }
  }

  async put(key: string, body: Uint8Array, options: PutOptions = {}): Promise<{ etag: string }> {
    const h = options.headers ?? {};
    try {
      const res = await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: h.contentType,
          ContentDisposition: h.contentDisposition,
          CacheControl: h.cacheControl,
          ContentEncoding: h.contentEncoding,
          ContentLanguage: h.contentLanguage,
          Metadata: h.metadata,
          IfMatch: options.ifMatch,
          IfNoneMatch: options.ifNoneMatch,
        }),
      );
      return { etag: needEtag("put", key, res.ETag) };
    } catch (e) {
      if (e instanceof StoreError) throw e;
      throw toStoreError("put", key, e);
    }
  }

  async copy(sourceKey: string, destKey: string, options: CopyOptions = {}): Promise<{ etag: string }> {
    const extra: Record<string, string> = {};
    if (options.destIfMatch !== undefined) extra["cf-copy-destination-if-match"] = options.destIfMatch;
    if (options.destIfNoneMatch !== undefined) extra["cf-copy-destination-if-none-match"] = options.destIfNoneMatch;
    try {
      const cmd = new CopyObjectCommand({
        Bucket: this.bucket,
        Key: destKey,
        CopySource: copySource(this.bucket, sourceKey),
        CopySourceIfMatch: options.sourceIfMatch,
        MetadataDirective: "COPY",
      });
      const res = await this.client.send(withHeaders(cmd, extra));
      return { etag: needEtag("copy", destKey, res.CopyObjectResult?.ETag) };
    } catch (e) {
      if (e instanceof StoreError) throw e;
      throw toStoreError("copy", destKey, e);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (e) {
      throw toStoreError("delete", key, e);
    }
  }

  async list(prefix: string, options: { cursor?: string; limit?: number } = {}): Promise<ListResult> {
    const raw = options.limit ?? 1000;
    const limit = Math.min(1000, Math.max(1, Math.trunc(Number.isFinite(raw) ? raw : 1000)));
    try {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: options.cursor, MaxKeys: limit }),
      );
      return {
        keys: (res.Contents ?? []).flatMap((o) => (o.Key ? [o.Key] : [])),
        cursor: res.IsTruncated ? res.NextContinuationToken : undefined,
      };
    } catch (e) {
      throw toStoreError("list", prefix, e);
    }
  }
}
