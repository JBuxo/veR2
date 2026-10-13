const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/**
 * Unique id in ULID layout (10 chars of milliseconds + 16 random chars). Ids from the same millisecond
 * are not ordered; version order always comes from the manifest, never from sorting ids.
 */
export function ulid(now: number = Date.now(), random: (n: number) => Uint8Array = randomBytes): string {
  if (!Number.isSafeInteger(now) || now < 0 || now >= 2 ** 48) {
    throw new RangeError(`ulid: time must be an integer in [0, 2^48), got ${now}`);
  }
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = random(16);
  if (bytes.length < 16) throw new RangeError(`ulid: random(16) returned ${bytes.length} bytes`);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += ALPHABET[bytes[i]! % 32];
  return time + rand;
}
