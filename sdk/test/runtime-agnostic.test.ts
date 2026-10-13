import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );
}

const forbidden: [string, RegExp][] = [
  ['from "node:', /from\s+["']node:/],
  ["require(", /require\(/],
  ["Buffer", /\bBuffer\b/],
  ["process.", /\bprocess\./],
  ["__dirname", /\b__dirname\b/],
  ["setImmediate", /\bsetImmediate\b/],
];

describe("sdk/src is runtime-agnostic", () => {
  const files = tsFiles(SRC);

  it("finds source files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.slice(SRC.length + 1), f]))("%s uses no Node-only APIs", (_name, file) => {
    const text = readFileSync(file as string, "utf8");
    for (const [label, re] of forbidden) {
      expect(re.test(text), `${file} uses ${label}`).toBe(false);
    }
  });
});
