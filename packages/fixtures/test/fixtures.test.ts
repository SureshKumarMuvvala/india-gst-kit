import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GstDocumentSchema, isValidGstin } from "@india-gst-kit/model";
import { ALLOWED_FIXTURE_GSTINS, FIXTURE_NAMES, fixtures } from "../src/index.js";

describe("fixtures", () => {
  it.each(FIXTURE_NAMES)("%s parses", (name) => {
    const r = GstDocumentSchema.safeParse(fixtures[name]);
    expect(r.success ? [] : r.error.issues).toEqual([]);
  });
  it("registered GSTINs are all valid under mod-36", () => {
    for (const g of ALLOWED_FIXTURE_GSTINS) expect(isValidGstin(g)).toBe(true);
  });
  it("source files contain only registered synthetic GSTINs (no 15-char GSTIN-shaped strings otherwise)", () => {
    const shape = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][A-Z0-9][0-9A-Z]\b/g;
    const dir = new URL("../src/", import.meta.url);
    for (const f of readdirSync(dir)) {
      const text = readFileSync(new URL(f, dir), "utf8");
      for (const m of text.match(shape) ?? []) expect(ALLOWED_FIXTURE_GSTINS).toContain(m);
    }
  });
  it("the scan itself would catch a stray GSTIN", () => {
    const shape = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][A-Z0-9][0-9A-Z]\b/g;
    expect("x 37BZNPM9430M1KL y".match(shape)).toEqual(["37BZNPM9430M1KL"]);
  });
});
