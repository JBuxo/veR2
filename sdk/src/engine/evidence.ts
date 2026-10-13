import type { ObjectHeaders, ObjectInfo } from "../storage/types.js";

const HEADER_FIELDS = ["contentType", "contentDisposition", "cacheControl", "contentEncoding", "contentLanguage"] as const;

function sameMetadata(a: Record<string, string> = {}, b: Record<string, string> = {}): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && a[k] === b[k]);
}

const sameHeaders = (a: ObjectHeaders, b: ObjectHeaders): boolean =>
  HEADER_FIELDS.every((f) => a[f] === b[f]) && sameMetadata(a.metadata, b.metadata);

/**
 * True when two objects hold the same content: same ETag (bytes) and same headers.
 * ETag alone is not enough evidence that a version reached the live key: a
 * headers-only change keeps the ETag, so the bytes can match while the headers don't.
 */
export const sameContent = (a: ObjectInfo, b: ObjectInfo): boolean => a.etag === b.etag && sameHeaders(a.headers, b.headers);
