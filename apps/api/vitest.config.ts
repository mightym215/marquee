import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Test against the MCP server's source so tests don't need a build first.
    alias: {
      "@marquee/tmdb-mcp": fileURLToPath(new URL("../../packages/tmdb-mcp/src/index.ts", import.meta.url)),
    },
  },
});
