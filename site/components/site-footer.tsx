import { site } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:justify-between">
        <p>{site.name} is open source under the Apache-2.0 license.</p>
        <div className="flex gap-4">
          <a href={site.github} className="hover:text-foreground">GitHub</a>
          <a href={site.npm.sdk} className="hover:text-foreground">@ver2/sdk</a>
          <a href={site.npm.cli} className="hover:text-foreground">@ver2/cli</a>
        </div>
      </div>
    </footer>
  );
}
