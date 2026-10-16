export const site = {
  name: "veR2",
  tagline: "Object versioning for Cloudflare R2",
  description:
    "Add version history to an existing R2 bucket without changing how anything reads from it. Every put, delete and restore keeps an immutable version.",
  github: "https://github.com/JBuxo/ver2",
  npm: {
    sdk: "https://www.npmjs.com/package/@ver2/sdk",
    cli: "https://www.npmjs.com/package/@ver2/cli",
  },
} as const;
