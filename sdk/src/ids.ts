const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** Time-sortable unique id (ULID layout: 10 chars of milliseconds, 16 random chars). */
export function ulid(now: number = Date.now(), random: (n: number) => Uint8Array = randomBytes): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = random(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += ALPHABET[(bytes[i] ?? 0) % 32];
  return time + rand;
}
