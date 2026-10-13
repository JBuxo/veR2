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
  /** Bring your own client (custom retries, request handler). Overrides endpoint and credentials. */
  client?: S3Client;
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

/** R2 HEAD errors carry no error code, so classify by HTTP status. */
function toStoreError(e: unknown): StoreError {
  const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  const kind =
    status === 412 ? "precondition-failed" : status === 404 ? "not-found" : status === 429 ? "rate-limited" : "other";
  return new StoreError(kind, e instanceof Error ? e.message : String(e), status, { cause: e });
}

const copySource = (bucket: string, key: string) => `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

/** Attach headers the SDK input types don't model (R2's cf-copy-destination-*). Added before signing. */
function withHeaders(cmd: CopyObjectCommand, headers: Record<string, string>): CopyObjectCommand {
  if (Object.keys(headers).length === 0) return cmd;
  cmd.middlewareStack.add(
    (next) => async (args) => {
      const request = args.request as { headers?: Record<string, string> };
      if (request.headers) Object.assign(request.headers, headers);
      return next(args);
    },
    { step: "build", name: "ver2CopyDestinationConditions" },
  );
  return cmd;
}

/** ObjectStore over the S3 API, tuned for Cloudflare R2. */
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
    this.client = new S3Client({
      region: "auto",
      endpoint,
      credentials: options.credentials,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      return toInfo(key, await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })));
    } catch (e) {
      const err = toStoreError(e);
      if (err.kind === "not-found") return null;
      throw err;
    }
  }

  async get(key: string, options: GetOptions = {}): Promise<{ info: ObjectInfo; body: ReadableStream<Uint8Array> } | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, IfMatch: options.ifMatch }));
      if (!res.Body) throw new StoreError("other", `GetObject returned no body for ${key}`);
      return { info: toInfo(key, res), body: res.Body.transformToWebStream() as ReadableStream<Uint8Array> };
    } catch (e) {
      if (e instanceof StoreError) throw e;
      const err = toStoreError(e);
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
      return { etag: res.ETag ?? "" };
    } catch (e) {
      throw toStoreError(e);
    }
  }

  async copy(sourceKey: string, destKey: string, options: CopyOptions = {}): Promise<{ etag: string }> {
    const extra: Record<string, string> = {};
    if (options.destIfMatch !== undefined) extra["cf-copy-destination-if-match"] = options.destIfMatch;
    if (options.destIfNoneMatch !== undefined) extra["cf-copy-destination-if-none-match"] = options.destIfNoneMatch;
    const cmd = new CopyObjectCommand({
      Bucket: this.bucket,
      Key: destKey,
      CopySource: copySource(this.bucket, sourceKey),
      CopySourceIfMatch: options.sourceIfMatch,
      MetadataDirective: "COPY",
    });
    try {
      const res = await this.client.send(withHeaders(cmd, extra));
      return { etag: res.CopyObjectResult?.ETag ?? "" };
    } catch (e) {
      throw toStoreError(e);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (e) {
      throw toStoreError(e);
    }
  }

  async list(prefix: string, options: { cursor?: string; limit?: number } = {}): Promise<ListResult> {
    try {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: options.cursor, MaxKeys: options.limit }),
      );
      return {
        keys: (res.Contents ?? []).flatMap((o) => (o.Key ? [o.Key] : [])),
        cursor: res.IsTruncated ? res.NextContinuationToken : undefined,
      };
    } catch (e) {
      throw toStoreError(e);
    }
  }
}
