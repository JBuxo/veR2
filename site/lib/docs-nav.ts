export interface DocsNavItem {
  title: string;
  href: string;
}

/** Page order for the sidebar and the previous/next links. Every docs page must appear here exactly once. */
export const docsNav: DocsNavItem[] = [{ title: "Introduction", href: "/docs/" }];
