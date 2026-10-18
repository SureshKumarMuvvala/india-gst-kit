import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string) => fileURLToPath(new URL(`../${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@india-gst-kit/model": src("model"),
      "@india-gst-kit/einvoice": src("einvoice"),
      "@india-gst-kit/errors": src("errors"),
      "@india-gst-kit/ewaybill": src("ewaybill"),
      "@india-gst-kit/fixtures": src("fixtures"),
    },
  },
  test: { include: ["test/**/*.test.ts"], setupFiles: ["test/setup.ts"] },
});
