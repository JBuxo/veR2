import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const sdk = (path: string) => fileURLToPath(new URL(`../sdk/src/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@ver2\/sdk\/memory$/, replacement: sdk("storage/memory.ts") },
      { find: /^@ver2\/sdk\/s3$/, replacement: sdk("storage/s3.ts") },
      { find: /^@ver2\/sdk$/, replacement: sdk("index.ts") },
    ],
  },
  test: { include: ["test/**/*.test.ts"] },
});
