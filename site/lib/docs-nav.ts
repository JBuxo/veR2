export interface DocsNavItem {
  title: string;
  href: string;
}

/** Page order for the sidebar and the previous/next links. Every docs page must appear here exactly once. */
export const docsNav: DocsNavItem[] = [
  { title: "Introduction", href: "/docs/" },
  { title: "Installation", href: "/docs/installation/" },
  { title: "Quickstart: SDK", href: "/docs/quickstart-sdk/" },
  { title: "Quickstart: CLI", href: "/docs/quickstart-cli/" },
  { title: "CLI reference", href: "/docs/cli-reference/" },
  { title: "Errors", href: "/docs/errors/" },
];
