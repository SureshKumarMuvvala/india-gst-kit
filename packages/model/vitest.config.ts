import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@india-gst-kit/fixtures": fileURLToPath(
        new URL("../fixtures/src/index.ts", import.meta.url),
      ),
    },
  },
  test: { include: ["test/**/*.test.ts"] },
});
