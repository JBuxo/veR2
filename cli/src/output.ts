import {
  ConcurrencyConflictError,
  ConfigurationError,
  IntegrityCheckFailedError,
  InvalidKeyError,
  OperationIncompleteError,
  Ver2Error,
} from "@ver2/sdk";
import { EXIT, type Io, UsageError } from "./types.js";

export interface Output {
  result(data: unknown, human: string): void;
  /** Print an error and return the exit code for it. */
  error(e: unknown): number;
}

export function exitCodeFor(e: unknown): number {
  if (e instanceof UsageError || e instanceof ConfigurationError || e instanceof InvalidKeyError) return EXIT.usage;
  if (e instanceof ConcurrencyConflictError) return EXIT.conflict;
  if (e instanceof OperationIncompleteError) return EXIT.incomplete;
  if (e instanceof IntegrityCheckFailedError) return EXIT.integrity;
  return EXIT.error;
}

export function output(io: Io, json: boolean): Output {
  return {
    result(data, human) {
      io.stdout(json ? JSON.stringify(data, null, 2) : human);
    },
    error(e) {
      const message = e instanceof Error ? e.message : String(e);
      if (json) {
        const code = e instanceof Ver2Error ? e.code : e instanceof UsageError ? "USAGE" : "ERROR";
        const details = e instanceof Ver2Error ? e.details : undefined;
        io.stderr(JSON.stringify({ error: { code, message, details } }));
      } else {
        io.stderr(`ver2: ${message}`);
      }
      return exitCodeFor(e);
    },
  };
}
