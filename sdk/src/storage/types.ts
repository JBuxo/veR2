export interface ObjectHeaders {
  contentType?: string;
  contentDisposition?: string;
  cacheControl?: string;
  contentEncoding?: string;
  contentLanguage?: string;
  metadata?: Record<string, string>;
}

export interface ObjectInfo {
  key: string;
  etag: string;
  size: number;
  lastModified: Date;
  headers: ObjectHeaders;
}

export interface PutOptions {
  headers?: ObjectHeaders;
  ifMatch?: string;
  ifNoneMatch?: "*";
}

export interface CopyOptions {
  sourceIfMatch?: string;
  /** R2 extension `cf-copy-destination-if-match`. */
  destIfMatch?: string;
  /** R2 extension `cf-copy-destination-if-none-match`. */
  destIfNoneMatch?: "*";
}

export interface GetOptions {
  ifMatch?: string;
}

export interface ListResult {
  keys: string[];
  cursor?: string;
}

/**
 * The only boundary that talks to object storage. Implementations must throw
 * StoreError for storage failures and return null for missing objects on head/get.
 */
export interface ObjectStore {
  head(key: string): Promise<ObjectInfo | null>;
  get(key: string, options?: GetOptions): Promise<{ info: ObjectInfo; body: ReadableStream<Uint8Array> } | null>;
  put(key: string, body: Uint8Array, options?: PutOptions): Promise<{ etag: string }>;
  /** Copies bytes and headers unchanged (metadata directive COPY). */
  copy(sourceKey: string, destKey: string, options?: CopyOptions): Promise<{ etag: string }>;
  /** Unconditional: R2 ignores If-Match on DeleteObject. */
  delete(key: string): Promise<void>;
  list(prefix: string, options?: { cursor?: string; limit?: number }): Promise<ListResult>;
}

export type StoreErrorKind = "precondition-failed" | "not-found" | "rate-limited" | "other";

export class StoreError extends Error {
  readonly kind: StoreErrorKind;
  readonly status: number | undefined;

  constructor(kind: StoreErrorKind, message: string, status?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StoreError";
    this.kind = kind;
    this.status = status;
  }
}

export const isPreconditionFailed = (e: unknown): boolean => e instanceof StoreError && e.kind === "precondition-failed";
