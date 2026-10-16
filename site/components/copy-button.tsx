"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Copies `text`, or the text content of the nearest <pre> when `text` is omitted. */
export function CopyButton({ text, className }: { text?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Copy"
      className={className}
      onClick={async (e) => {
        const value = text ?? e.currentTarget.closest("[data-copy-root]")?.querySelector("pre")?.innerText ?? "";
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </Button>
  );
}
