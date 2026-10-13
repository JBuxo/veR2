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
  ["node builtin import", /(from|import\s*\()\s*["'](node:|fs|path|crypto|os|stream|http|https|url|util|child_process|zlib|net|tls|events|buffer)\b/],
  ["require(", /require\(/],
  ["Buffer", /\bBuffer\b/],
  ["process.", /\bprocess\./],
  ["globalThis.process", /\bglobalThis\.process\b/],
  ["__dirname", /\b__dirname\b/],
  ["setImmediate", /\bsetImmediate\b/],
];

// Comments may legitimately mention Node APIs; only scan code.
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

describe("sdk/src is runtime-agnostic", () => {
  const files = tsFiles(SRC);

  it("finds source files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.slice(SRC.length + 1), f]))("%s uses no Node-only APIs", (_name, file) => {
    const text = stripComments(readFileSync(file as string, "utf8"));
    for (const [label, re] of forbidden) {
      expect(re.test(text), `${file} uses ${label}`).toBe(false);
    }
  });
});
