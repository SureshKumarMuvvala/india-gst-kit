import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string) => fileURLToPath(new URL(`../${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@india-gst-kit/model": src("model"),
      "@india-gst-kit/gstr1": src("gstr1"),
      "@india-gst-kit/recon": src("recon"),
      "@india-gst-kit/fixtures": src("fixtures"),
    },
  },
  test: { include: ["test/**/*.test.ts"] },
});
