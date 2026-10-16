"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { docsNav } from "@/lib/docs-nav";

export function DocsPager() {
  const pathname = usePathname();
  const i = docsNav.findIndex((item) => item.href === pathname);
  if (i === -1) return null;
  const prev = docsNav[i - 1];
  const next = docsNav[i + 1];
  return (
    <div className="mt-12 flex justify-between border-t pt-6">
      {prev ? (
        <Link href={prev.href} className={buttonVariants({ variant: "ghost" })}>
          <ChevronLeft className="size-4" /> {prev.title}
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link href={next.href} className={buttonVariants({ variant: "ghost" })}>
          {next.title} <ChevronRight className="size-4" />
        </Link>
      )}
    </div>
  );
}
