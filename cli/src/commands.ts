import type { RecoveryResult, Ver2, VersionRecord } from "@ver2/sdk";
import type { Output } from "./output.js";
import { EXIT, type Flags, type Io, UsageError } from "./types.js";

export interface CommandContext {
  args: string[];
  flags: Flags;
  client: Ver2;
  io: Io;
  out: Output;
}

export type Handler = (c: CommandContext) => Promise<number>;

function need(args: string[], count: number, usage: string): string[] {
  if (args.length < count) throw new UsageError(`usage: ver2 ${usage}`);
  return args;
}

const formatVersion = (v: VersionRecord) =>
  [
    v.versionId,
    v.createdAt,
    v.kind === "delete" ? "deleted" : `${v.size} B  sha256 ${v.sha256?.slice(0, 12)}`,
    v.source + (v.restoredFrom ? ` (from ${v.restoredFrom})` : ""),
  ].join("  ");

const formatRecovery = (r: RecoveryResult) => `${r.key}: ${r.outcome}${r.reason ? ` (${r.reason})` : ""}`;

export const COMMANDS: Record<string, Handler> = {
  async put({ args, flags, client, io, out }) {
    const [key, file] = need(args, 2, "put <key> <file>") as [string, string];
    const contentType = flags["content-type"];
    const r = await client.put(key, await io.readFile(file), contentType ? { headers: { contentType } } : {});
    out.result(r, `${r.key} → ${r.versionId} (${r.size} B, sha256 ${r.sha256.slice(0, 12)})`);
    return EXIT.ok;
  },

  async rm({ args, client, out }) {
    const [key] = need(args, 1, "rm <key>") as [string];
    const r = await client.delete(key);
    out.result(r, r.versionId ? `${r.key} deleted (marker ${r.versionId})` : `${r.key}: nothing to delete`);
    return EXIT.ok;
  },

  async ls({ args, client, out }) {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.list(args[0] ?? "", { cursor });
      keys.push(...page.keys);
      cursor = page.cursor;
    } while (cursor);
    out.result({ keys }, keys.join("\n"));
    return EXIT.ok;
  },

  async versions({ args, client, out }) {
    const [key] = need(args, 1, "versions <key>") as [string];
    const versions = await client.versions.list(key);
    out.result({ key, versions }, versions.length ? versions.map(formatVersion).join("\n") : `${key}: no history`);
    return EXIT.ok;
  },

  async restore({ args, client, out }) {
    const [key, versionId] = need(args, 2, "restore <key> <versionId>") as [string, string];
    const r = await client.versions.restore(key, versionId);
    out.result(r, `${r.key} restored from ${versionId} as ${r.versionId}`);
    return EXIT.ok;
  },

  async download({ args, flags, client, io, out }) {
    const [key, versionId] = need(args, 1, "download <key> [versionId]") as [string, string | undefined];
    const { record, body } = await client.versions.download(key, versionId);
    if (flags.output) {
      await io.writeFile(flags.output, body);
      out.result(
        { key, versionId: record.versionId, output: flags.output, sha256: record.sha256 },
        `${key}@${record.versionId} → ${flags.output} (sha256 verified)`,
      );
    } else {
      await io.writeStdout(body);
    }
    return EXIT.ok;
  },

  async reconcile({ args, flags, client, out }) {
    const options = { dryRun: flags["dry-run"] ?? false, acceptLive: flags["accept-live"] ?? false };
    const results: RecoveryResult[] = [];
    if (args[0]) {
      const r = await client.recover(args[0], options);
      if (r.outcome !== "none") results.push(r);
    } else {
      for await (const r of client.recoverAll(options)) results.push(r);
    }
    out.result({ results }, results.length ? results.map(formatRecovery).join("\n") : "nothing to reconcile");
    return results.some((r) => r.outcome === "stuck") ? EXIT.incomplete : EXIT.ok;
  },
};
