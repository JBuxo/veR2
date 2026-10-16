import type { Ver2 } from "@ver2/sdk";
import type { Ver2Config } from "./config.js";

export const EXIT = { ok: 0, error: 1, usage: 2, conflict: 3, incomplete: 4, integrity: 5 } as const;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** Everything the CLI touches in the outside world, so tests can replace it. */
export interface Io {
  stdout(line: string): void;
  stderr(line: string): void;
  env: Record<string, string | undefined>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, body: ReadableStream<Uint8Array>): Promise<void>;
  writeStdout(body: ReadableStream<Uint8Array>): Promise<void>;
  client(config: Ver2Config): Ver2;
}

export interface Flags {
  json?: boolean;
  "content-type"?: string;
  output?: string;
  "dry-run"?: boolean;
  "accept-live"?: boolean;
  help?: boolean;
}
