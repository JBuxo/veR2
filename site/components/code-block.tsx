import { codeToHtml } from "shiki";
import { CopyButton } from "@/components/copy-button";

/** Server component: highlights at build time, ships no highlighter JS. */
export async function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const html = await codeToHtml(code.trim(), {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
  return (
    <div data-copy-root="" className="relative rounded-lg border bg-muted text-sm [&_pre]:p-4">
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <CopyButton className="absolute top-2 right-2" />
    </div>
  );
}
