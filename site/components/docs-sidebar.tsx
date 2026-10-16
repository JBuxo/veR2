"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { docsNav } from "@/lib/docs-nav";
import { cn } from "@/lib/utils";

function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 text-sm">
      {docsNav.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground",
            pathname === item.href && "bg-accent font-medium text-foreground",
          )}
        >
          {item.title}
        </Link>
      ))}
    </nav>
  );
}

export function DocsSidebar() {
  return (
    <>
      <aside className="sticky top-14 hidden h-[calc(100svh-3.5rem)] w-56 shrink-0 md:block">
        <ScrollArea className="h-full py-6 pr-4">
          <NavLinks />
        </ScrollArea>
      </aside>
      <div className="pt-4 md:hidden">
        <Sheet>
          <SheetTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Menu className="size-4" /> Docs menu
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-4">
            <SheetTitle className="mb-4">Docs</SheetTitle>
            <NavLinks />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
