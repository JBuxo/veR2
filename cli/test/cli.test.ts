import { createVer2, type Ver2 } from "@ver2/sdk";
import { MemoryObjectStore } from "@ver2/sdk/memory";
import { describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import { EXIT, type Io } from "../src/types.js";

const ENV = { R2_ACCOUNT_ID: "acc", R2_BUCKET: "bucket", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret" };
const enc = (s: string) => new TextEncoder().encode(s);

function harness(env: Record<string, string | undefined> = ENV) {
  const store = new MemoryObjectStore();
  // A fake clock: writes stay inside their lease, and tests advance past it to let `reconcile` act.
  let clock = Date.parse("2026-01-01T00:00:00Z");
  const client: Ver2 = createVer2({ store, now: () => new Date(clock) });
  const out: string[] = [];
  const err: string[] = [];
  const files = new Map<string, Uint8Array>([
    ["a.txt", enc("one")],
    ["b.txt", enc("two")],
  ]);
  const io: Io = {
    stdout: (line) => void out.push(line),
    stderr: (line) => void err.push(line),
    env,
    readFile: async (path) => {
      const f = files.get(path);
      if (!f) throw new Error(`ENOENT: ${path}`);
      return f;
    },
    writeFile: async (path, body) => {
      files.set(path, new Uint8Array(await new Response(body).arrayBuffer()));
    },
    writeStdout: async (body) => {
      out.push(await new Response(body).text());
    },
    client: () => client,
  };
  const advance = (ms: number) => void (clock += ms);
  return { run: (...argv: string[]) => main(argv, io), out, err, files, store, advance };
}

describe("ver2 CLI", () => {
  it("prints help", async () => {
    const h = harness();
    expect(await h.run("--help")).toBe(EXIT.ok);
    expect(h.out.join("\n")).toContain("Usage: ver2");
  });

  it("rejects a missing or unknown command", async () => {
    const h = harness();
    expect(await h.run()).toBe(EXIT.usage);
    expect(await h.run("frobnicate")).toBe(EXIT.usage);
    expect(h.err.join("\n")).toContain('Unknown command "frobnicate"');
  });

  it("reports missing configuration", async () => {
    const h = harness({});
    expect(await h.run("ls")).toBe(EXIT.usage);
    expect(h.err.join("\n")).toContain("R2_BUCKET");
  });

  it("round-trips put, versions and restore", async () => {
    const h = harness();
    expect(await h.run("put", "doc.txt", "a.txt", "--json")).toBe(EXIT.ok);
    const v1 = JSON.parse(h.out.pop()!);
    expect(await h.run("put", "doc.txt", "b.txt")).toBe(EXIT.ok);
    expect(await h.run("restore", "doc.txt", v1.versionId)).toBe(EXIT.ok);
    expect(await h.run("versions", "doc.txt", "--json")).toBe(EXIT.ok);
    const { versions } = JSON.parse(h.out.pop()!);
    expect(versions).toHaveLength(3);
    expect(versions[0].restoredFrom).toBe(v1.versionId);
    expect(new TextDecoder().decode(h.store.objects.get("doc.txt")!.bytes)).toBe("one");
  });

  it("sets Content-Type from --content-type", async () => {
    const h = harness();
    expect(await h.run("put", "doc.txt", "a.txt", "--content-type", "text/plain")).toBe(EXIT.ok);
    expect(h.store.objects.get("doc.txt")?.headers.contentType).toBe("text/plain");
  });

  it("downloads to a file or stdout", async () => {
    const h = harness();
    expect(await h.run("put", "doc.txt", "a.txt")).toBe(EXIT.ok);
    expect(await h.run("download", "doc.txt", "-o", "out.txt")).toBe(EXIT.ok);
    expect(new TextDecoder().decode(h.files.get("out.txt"))).toBe("one");
    expect(await h.run("download", "doc.txt")).toBe(EXIT.ok);
    expect(h.out.at(-1)).toBe("one");
  });

  it("rm keeps history and lists keys", async () => {
    const h = harness();
    expect(await h.run("put", "doc.txt", "a.txt")).toBe(EXIT.ok);
    expect(await h.run("rm", "doc.txt")).toBe(EXIT.ok);
    expect(await h.run("download", "doc.txt")).toBe(EXIT.error);
    expect(await h.run("ls", "--json")).toBe(EXIT.ok);
    expect(JSON.parse(h.out.pop()!).keys).toEqual(["doc.txt"]);
  });

  it("maps invalid keys to a usage error", async () => {
    expect(await harness().run("put", "a/../b", "a.txt")).toBe(EXIT.usage);
  });

  it("emits machine-readable errors with --json", async () => {
    const h = harness();
    expect(await h.run("put", "doc.txt", "a.txt")).toBe(EXIT.ok);
    expect(await h.run("restore", "doc.txt", "nope", "--json")).toBe(EXIT.error);
    expect(JSON.parse(h.err.pop()!).error.code).toBe("VERSION_NOT_FOUND");
  });

  it("reconcile reports when nothing needs attention", async () => {
    const h = harness();
    expect(await h.run("reconcile")).toBe(EXIT.ok);
    expect(h.out.at(-1)).toBe("nothing to reconcile");
  });

  it("reconcile exits 4 on stuck operations and --accept-live resolves them", async () => {
    const h = harness();
    expect(await h.run("put", "doc.txt", "a.txt")).toBe(EXIT.ok);
    let manifestWrites = 0;
    h.store.fault = (op, key, phase) => {
      if (op === "put" && key === ".ver2/m/doc.txt" && phase === "before" && ++manifestWrites === 2) {
        h.store.fault = undefined;
        throw new Error("crash");
      }
    };
    expect(await h.run("put", "doc.txt", "b.txt")).toBe(EXIT.incomplete);
    h.store.putDirect("doc.txt", "someone else");
    h.advance(60_001);
    expect(await h.run("reconcile")).toBe(EXIT.incomplete);
    expect(h.out.at(-1)).toContain("stuck");
    expect(await h.run("reconcile", "doc.txt", "--accept-live")).toBe(EXIT.ok);
  });
});
