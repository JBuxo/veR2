import Link from "next/link";
import { GitHubIcon } from "@/components/github-icon";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { site } from "@/lib/site";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link href="/" aria-label={`${site.name} home`}>
          <Logo />
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/docs/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Docs
          </Link>
          <a href={site.npm.sdk} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            npm
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <a href={site.github} aria-label="GitHub" className={buttonVariants({ variant: "ghost", size: "icon" })}>
            <GitHubIcon className="size-4" />
          </a>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
