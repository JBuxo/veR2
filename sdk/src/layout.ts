import { sha256Hex, toBytes } from "./hash.js";

export interface Layout {
  manifestPrefix: string;
  manifestKey(key: string): string;
  versionKey(key: string, versionId: string): string;
}

/**
 * Where veR2 keeps its own objects inside the bucket.
 * `key` arguments must already be canonical (NFC, via `canonicalKey`): version paths hash its UTF-8 bytes.
 */
export function layout(namespace: string): Layout {
  return {
    manifestPrefix: `${namespace}/m/`,
    manifestKey: (key) => `${namespace}/m/${key}`,
    // Hashing the key keeps version paths short no matter how long the key is.
    versionKey: (key, versionId) => `${namespace}/o/${sha256Hex(toBytes(key))}/${versionId}`,
  };
}
