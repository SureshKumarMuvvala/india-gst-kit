import { beforeEach, vi } from "vitest";

// No network in tests (spec §12): any use of the real fetch fails the test. Every test injects a mock.
beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("network access in a test: inject a mock fetch");
  });
});
