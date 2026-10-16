# veR2 website: design

**Date:** 2026-10-16 · **Status:** approved in conversation, pending written review

## Goal

A public marketing and documentation site for veR2: a landing page that explains what veR2 is and why, plus docs covering installation, usage, concepts, guarantees and contributing. It is not a management UI. A version-browser dashboard is out of scope and would get its own spec.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Scope | Landing page + docs only | Marketing site; no credentials, no server |
| Location | `site/` workspace in this repo, package `@ver2/site` (`private: true`) | Docs change in the same PR as the code they describe |
| Framework | Next.js 16 App Router, React 19, TypeScript strict | User choice |
| UI | shadcn/ui default components and theme (neutral), Tailwind v4 | User choice: hand-rolled with shadcn defaults, no docs framework |
| Output | `output: "export"` with `trailingSlash: true`: static HTML in `site/out/` | Hosts anywhere (Cloudflare Pages, Vercel, GitHub Pages); nothing to secure |
| Content | MDX via `@next/mdx`, one `app/docs/<slug>/page.mdx` per page | No content-loading layer to maintain |
| Highlighting | Shiki through `rehype-pretty-code`, at build time | Zero client JS for code blocks |
| Headings | `rehype-slug` + `rehype-autolink-headings` | Linkable sections |
| Theme | Light/dark via `next-themes` | shadcn default pattern |
| Search | None in v1 | ~10 pages and a sidebar don't need it |

Name on the site is **veR2** (matching README and package names).

## Structure

```
site/
  package.json            @ver2/site, private
  next.config.mjs         output: "export", MDX + rehype plugins
  mdx-components.tsx      maps MDX elements to shadcn-styled components
  components.json         shadcn config
  app/
    layout.tsx            fonts, ThemeProvider, SiteHeader, SiteFooter
    page.tsx              landing page
    docs/
      layout.tsx          DocsSidebar + content column + prev/next
      page.mdx            Introduction (/docs)
      installation/page.mdx
      quickstart-sdk/page.mdx
      quickstart-cli/page.mdx
      how-it-works/page.mdx
      configuration/page.mdx
      cli-reference/page.mdx
      errors/page.mdx
      guarantees/page.mdx
      contributing/page.mdx
  components/
    site-header.tsx       logo, Docs, GitHub, npm, theme toggle; mobile Sheet nav
    site-footer.tsx       license, GitHub, npm links
    docs-sidebar.tsx      ScrollArea on desktop, Sheet on mobile, active link
    docs-pager.tsx        prev/next from docs-nav
    theme-toggle.tsx
    copy-button.tsx       client component for code blocks and install commands
    ui/                   shadcn-generated components (button, card, sheet, scroll-area, separator, alert, table, badge, tabs)
  lib/
    docs-nav.ts           single ordered list: { title, href }[]; drives sidebar and pager
    site.ts               constants: GitHub URL, npm URLs, package names
  test/
    docs-drift.test.ts
```

Each component has one job. `docs-nav.ts` is the single source of page order.

## Landing page (`/`)

1. **Hero:** "Object versioning for Cloudflare R2", one-line subtitle, `npm i @ver2/sdk` with copy button, buttons: *Get started* (`/docs/installation`), *GitHub*. A pre-alpha `Badge`.
2. **How it works:** the README diagram (live key, `.ver2/o/…`, `.ver2/m/…`, readers unchanged) as a styled code block, with three short bullets.
3. **Features:** three `Card`s: reads don't change; every write keeps an immutable version; crash-safe journaled writes with evidence-based recovery.
4. **Guarantees and limitations:** the README table (✅/⚠️) in a shadcn `Table`, linking to `/docs/guarantees`.
5. **Code sample:** `Tabs` with SDK and CLI snippets.
6. **Footer CTA:** Docs, GitHub, npm.

## Docs pages

Content is adapted from `README.md`, `CONTRIBUTING.md`, the architecture spec, `docs/research/r2-behavior.md` and the source. Every code sample must match the real API.

1. **Introduction:** what veR2 is, status (pre-alpha, 0.x), when to use it.
2. **Installation:** `npm i @ver2/sdk` (plus `@aws-sdk/client-s3`, an optional peer), `npm i -g @ver2/cli`, Node ≥ 22, from source via `git clone`.
3. **Quickstart: SDK:** create an R2 API token, `createVer2` + `S3ObjectStore`, put/list/restore/delete/download.
4. **Quickstart: CLI:** env vars or `.env.local`, the command walkthrough.
5. **How it works:** live keys, the reserved namespace, version objects, manifests, journaled writes (claim → storage → commit), guarded promote, direct-write detection, recovery outcomes.
6. **Configuration:** `Ver2Options` (`store`, `meta`, `namespace`, `leaseMs`, `now`, `newId`), `S3ObjectStore` options, CLI env vars.
7. **CLI reference:** every command, flag and exit code.
8. **Errors:** every `Ver2ErrorCode`, its meaning and the action to take; `StorageError.retryable`.
9. **Guarantees and limitations:** the README table expanded with the spec's known-limitations list.
10. **Contributing:** setup, R2 test bucket, architecture invariants (summary + link to AGENTS.md), TDD, PR rules, releasing.

## Keeping docs honest

`site/test/docs-drift.test.ts` (Vitest) reads the MDX source and fails when the docs drift from the code:

- `cli-reference/page.mdx` mentions every key of `COMMANDS` (imported from `cli/src/commands.ts`) and every numeric exit code in `EXIT` (0–5).
- `errors/page.mdx` mentions every `Ver2ErrorCode`. Since the type is erased at runtime, the test reads the union from `sdk/src/errors.ts` source.
- Every `href` in `docs-nav.ts` has a matching `page.mdx`, and every docs page appears in `docs-nav.ts`.

## Repo integration

- Root `workspaces`: `["sdk", "cli", "site"]`. Root `test`, `typecheck` and `build` cover the site.
- Root `release` script stays limited to `@ver2/sdk` and `@ver2/cli`; the site is never published to npm.
- `site/out/` and `site/.next/` are git-ignored.
- The site must not import from `sdk/src` at runtime (only the drift test reads source files).

## Verification

- `npm test -w @ver2/site`: drift tests pass.
- `npm run typecheck -w @ver2/site`: exit 0.
- `npm run build -w @ver2/site`: produces `site/out/index.html` and `site/out/docs/<slug>/index.html` for every nav entry.
- Manual check of the built site in light and dark, desktop and phone width.

## Out of scope

Search, versioned docs, i18n, blog, analytics, OG image generation, the version-browser dashboard, deployment configuration (hosting is the user's choice; the output is static).
