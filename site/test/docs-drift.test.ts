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
