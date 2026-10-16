import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { docsNav } from "../lib/docs-nav";

const root = fileURLToPath(new URL("..", import.meta.url));
const docsDir = join(root, "app", "docs");

/** "/docs/installation/" for app/docs/installation/page.mdx; "/docs/" for app/docs/page.mdx. */
function pageHrefs(): string[] {
  return readdirSync(docsDir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith("page.mdx"))
    .map((f) => {
      const dir = relative(docsDir, join(docsDir, f, "..")).split(sep).filter(Boolean).join("/");
      return dir ? `/docs/${dir}/` : "/docs/";
    })
    .sort();
}

export const readDoc = (slug: string) => readFileSync(join(docsDir, slug, "page.mdx"), "utf8");
export const readRepo = (path: string) => readFileSync(join(root, "..", path), "utf8");

describe("docs navigation", () => {
  it("lists every docs page exactly once", () => {
    const hrefs = docsNav.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect([...hrefs].sort()).toEqual(pageHrefs());
  });

  it("uses trailing-slash hrefs that match the static export", () => {
    for (const item of docsNav) expect(item.href).toMatch(/^\/docs\/([a-z0-9-]+\/)?$/);
  });

  it("can read repo sources for drift checks", () => {
    expect(existsSync(join(root, "..", "sdk", "src", "errors.ts"))).toBe(true);
  });
});

describe("docs match the code", () => {
  it("CLI reference documents every command and exit code", () => {
    const src = readRepo("cli/src/commands.ts");
    const commands = [...src.matchAll(/^ {2}async (\w+)\(/gm)].map((m) => m[1]);
    expect(commands.length).toBeGreaterThan(5);
    const exitSrc = readRepo("cli/src/types.ts").match(/export const EXIT = \{([^}]+)\}/)?.[1] ?? "";
    const codes = [...exitSrc.matchAll(/(\w+): (\d+)/g)].map((m) => m[2]);
    expect(codes).toEqual(["0", "1", "2", "3", "4", "5"]);
    const page = readDoc("cli-reference");
    for (const c of commands) expect(page, `command ${c}`).toContain(`ver2 ${c}`);
    for (const code of codes) expect(page, `exit code ${code}`).toMatch(new RegExp(`\|\s*\`?${code}\`?\s*\|`));
  });

  it("errors page documents every error code", () => {
    const union = readRepo("sdk/src/errors.ts").match(/export type Ver2ErrorCode =([^;]+);/)?.[1] ?? "";
    const codes = [...union.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(5);
    const page = readDoc("errors");
    for (const code of codes) expect(page, `error ${code}`).toContain(`\`${code}\``);
  });
});

describe("diagrams", () => {
  it("draws the bucket layout as an SVG, not ASCII art", () => {
    const sources = [readFileSync(join(root, "app", "page.tsx"), "utf8"), readDoc("how-it-works")];
    for (const src of sources) {
      expect(src).not.toContain("├──");
      expect(src).toContain("<ArchitectureDiagram");
    }
  });
});
