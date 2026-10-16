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
  { title: "How it works", href: "/docs/how-it-works/" },
  { title: "Configuration", href: "/docs/configuration/" },
  { title: "CLI reference", href: "/docs/cli-reference/" },
  { title: "Errors", href: "/docs/errors/" },
  { title: "Guarantees and limitations", href: "/docs/guarantees/" },
  { title: "Contributing", href: "/docs/contributing/" },
];
