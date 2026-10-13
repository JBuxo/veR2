import { ConfigurationError, InvalidKeyError } from "./errors.js";

export const MAX_R2_KEY_BYTES = 1024;

export interface KeyPolicy {
  namespace: string;
}

const encoder = new TextEncoder();
const LONE_SURROGATE = /\p{Cs}/u;
const hasControlChar = (s: string) => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
};
const isDotSegment = (s: string) => s === "." || s === "..";

/** Longest user key whose manifest key (`<ns>/m/<key>`) still fits R2's 1024-byte limit. */
export function maxKeyBytes(policy: KeyPolicy): number {
  return MAX_R2_KEY_BYTES - encoder.encode(`${policy.namespace}/m/`).length;
}

/**
 * Validate a user key and return its canonical (NFC) form, or throw InvalidKeyError.
 * Every engine entry point calls this before touching storage.
 */
export function canonicalKey(key: string, policy: KeyPolicy): string {
  if (typeof key !== "string" || key.length === 0) {
    throw new InvalidKeyError(String(key), "key must be a non-empty string");
  }
  if (LONE_SURROGATE.test(key)) throw new InvalidKeyError(key, "key contains an unpaired UTF-16 surrogate");
  const k = key.normalize("NFC");
  if (hasControlChar(k)) throw new InvalidKeyError(key, "key contains a control character");
  if (k.split("/").some(isDotSegment)) {
    throw new InvalidKeyError(key, "'.' and '..' path segments are not allowed (R2 resolves them, so the object would land elsewhere)");
  }
  if (k === policy.namespace || k.startsWith(`${policy.namespace}/`)) {
    throw new InvalidKeyError(key, `keys under the reserved namespace "${policy.namespace}/" are managed by veR2`);
  }
  const bytes = encoder.encode(k).length;
  const max = maxKeyBytes(policy);
  if (bytes > max) {
    throw new InvalidKeyError(key, `key is ${bytes} bytes; the maximum is ${max} (R2's 1024-byte limit minus the manifest path)`);
  }
  return k;
}

/** Validate the internal namespace prefix (no leading/trailing slash, no empty or dot segments). */
export function validateNamespace(namespace: string): string {
  const segments = namespace.split("/");
  if (LONE_SURROGATE.test(namespace) || hasControlChar(namespace) || namespace !== namespace.normalize("NFC")) {
    // Non-NFC would let NFC-normalized keys slip past the reserved-namespace prefix check.
    throw new ConfigurationError(
      `Invalid namespace ${JSON.stringify(namespace)}: must be NFC-normalized, without control characters or lone surrogates`,
    );
  }
  if (namespace.length === 0 || segments.some((s) => s.length === 0 || isDotSegment(s))) {
    throw new ConfigurationError(
      `Invalid namespace ${JSON.stringify(namespace)}: use non-empty segments separated by "/", without "." or ".."`,
    );
  }
  if (maxKeyBytes({ namespace }) < 1) {
    throw new ConfigurationError(`Invalid namespace ${JSON.stringify(namespace)}: too long, leaves no room for keys`);
  }
  // Version keys are `<ns>/o/<64 hex>/<26-char id>`; they must fit too.
  if (encoder.encode(namespace).length + 3 + 64 + 1 + 26 > MAX_R2_KEY_BYTES) {
    throw new ConfigurationError(`Invalid namespace ${JSON.stringify(namespace)}: too long, version keys would exceed R2's 1024-byte limit`);
  }
  return namespace;
}
