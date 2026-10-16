import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The veR2 mark: three stacked versions, the newest solid, with a history arrow cut into it.
 * Theme-aware through currentColor and the background token. Keep in sync with app/icon.svg
 * and public/logo.svg, which carry the same geometry with fixed colors for use outside the site.
 */
export function LogoMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={cn("size-6", className)} {...props}>
      <rect x="12.5" y="2.5" width="17" height="17" rx="4.5" strokeWidth="2" opacity=".4" className="fill-background stroke-current" />
      <rect x="7.5" y="7.5" width="17" height="17" rx="4.5" strokeWidth="2" opacity=".7" className="fill-background stroke-current" />
      <rect x="2.5" y="12.5" width="17" height="17" rx="4.5" className="fill-current" />
      <path d="M6.8 21A4.2 4.2 0 1 1 11 25.2" strokeWidth="1.8" strokeLinecap="round" className="stroke-background" />
      <path d="M5 19.4L6.8 21.4L8.6 19.4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="stroke-background" />
    </svg>
  );
}

/** Mark plus wordmark, for the header. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-lg tracking-tight">
        <span className="font-medium">ve</span>
        <span className="font-bold">R2</span>
      </span>
    </span>
  );
}
