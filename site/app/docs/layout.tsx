import type { ReactNode } from "react";
import { DocsPager } from "@/components/docs-pager";
import { DocsSidebar } from "@/components/docs-sidebar";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 md:flex-row">
      <DocsSidebar />
      <article className="prose prose-neutral dark:prose-invert min-w-0 max-w-3xl flex-1 py-8 prose-pre:bg-muted prose-pre:text-foreground">
        {children}
        <DocsPager />
      </article>
    </div>
  );
}
