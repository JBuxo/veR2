import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const encoder = new TextEncoder();

export const toBytes = (data: Uint8Array | string): Uint8Array => (typeof data === "string" ? encoder.encode(data) : data);

export const sha256Hex = (data: Uint8Array): string => bytesToHex(sha256(data));

/** Hash a stream without holding it in memory. Consumes the stream. */
export async function sha256OfStream(stream: ReadableStream<Uint8Array>): Promise<{ sha256: string; size: number }> {
  const h = sha256.create();
  let size = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    h.update(value);
    size += value.byteLength;
  }
  return { sha256: bytesToHex(h.digest()), size };
}

/** Pass-through stream that errors at the end if the content's SHA-256 is not `expected`. */
export function verifyingStream(expected: string, onMismatch: (actual: string) => Error): TransformStream<Uint8Array, Uint8Array> {
  const h = sha256.create();
  return new TransformStream({
    transform(chunk, controller) {
      h.update(chunk);
      controller.enqueue(chunk);
    },
    flush(controller) {
      const actual = bytesToHex(h.digest());
      if (actual !== expected) controller.error(onMismatch(actual));
    },
  });
}
