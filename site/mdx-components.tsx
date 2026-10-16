import type { MDXComponents } from "mdx/types";
import type { ComponentProps } from "react";
import { CopyButton } from "@/components/copy-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** Callout for MDX: <Note>…</Note>. */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <Alert className="not-prose my-6">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

const components: MDXComponents = {
  Note,
  table: (props: ComponentProps<"table">) => (
    <div className="not-prose my-6">
      <Table {...props} />
    </div>
  ),
  thead: (props: ComponentProps<"thead">) => <TableHeader {...props} />,
  tbody: (props: ComponentProps<"tbody">) => <TableBody {...props} />,
  tr: (props: ComponentProps<"tr">) => <TableRow {...props} />,
  th: (props: ComponentProps<"th">) => <TableHead {...props} />,
  td: (props: ComponentProps<"td">) => <TableCell className="whitespace-normal" {...props} />,
  figure: (props: ComponentProps<"figure">) =>
    "data-rehype-pretty-code-figure" in props ? (
      <figure {...props} data-copy-root="" className="relative">
        {props.children}
        <CopyButton className="absolute top-2 right-2" />
      </figure>
    ) : (
      <figure {...props} />
    ),
};

export function useMDXComponents(): MDXComponents {
  return components;
}
