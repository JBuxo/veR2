import { parseArgs } from "node:util";
import { COMMANDS } from "./commands.js";
import { loadConfig } from "./config.js";
import { output } from "./output.js";
import { EXIT, type Flags, type Io } from "./types.js";

export const USAGE = `Usage: ver2 <command> [options]

Commands:
  put <key> <file>            Upload <file> as a new version of <key>
  rm <key>                    Delete <key> (its history is kept)
  ls [prefix]                 List versioned keys
  versions <key>              Show the version history of <key>
  restore <key> <versionId>   Make <versionId> the current version again
  download <key> [versionId]  Write a version to stdout or --output (sha256 verified)
  reconcile [key]             Settle interrupted operations (all keys if omitted)

Options:
  --json                      Machine-readable output
  --content-type <type>       put: Content-Type of the new version
  -o, --output <file>         download: write to <file>
  --dry-run                   reconcile: report without changing anything
  --accept-live               reconcile: resolve stuck operations by keeping the live object
  -h, --help                  Show this help

Configuration (environment or .env.local):
  R2_ACCOUNT_ID or R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
  VER2_NAMESPACE (default .ver2)

Exit codes: 0 ok · 1 error · 2 usage/config · 3 conflict · 4 incomplete · 5 integrity`;

export async function main(argv: string[], io: Io): Promise<number> {
  let positionals: string[];
  let flags: Flags;
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: "boolean" },
        "content-type": { type: "string" },
        output: { type: "string", short: "o" },
        "dry-run": { type: "boolean" },
        "accept-live": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    positionals = parsed.positionals;
    flags = parsed.values;
  } catch (e) {
    io.stderr(`${(e as Error).message}\n\n${USAGE}`);
    return EXIT.usage;
  }

  if (flags.help) {
    io.stdout(USAGE);
    return EXIT.ok;
  }
  const [command, ...args] = positionals;
  if (!command) {
    io.stderr(USAGE);
    return EXIT.usage;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    io.stderr(`Unknown command "${command}".\n\n${USAGE}`);
    return EXIT.usage;
  }

  const out = output(io, flags.json ?? false);
  try {
    const client = io.client(loadConfig(io.env));
    return await handler({ args, flags, client, io, out });
  } catch (e) {
    return out.error(e);
  }
}
