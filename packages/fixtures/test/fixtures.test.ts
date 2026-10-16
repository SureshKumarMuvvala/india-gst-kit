import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GstDocumentSchema, isValidGstin } from "@india-gst-kit/model";
import {
  ALLOWED_FIXTURE_GSTINS,
  FIXTURE_NAMES,
  GSTR2B_INVOICE_FIXTURES,
  GSTR2B_NOTE_FIXTURES,
  fixtures,
  gstr2bFixture,
  gstr2bFixtureText,
} from "../src/index.js";

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

describe("gstr2b fixture", () => {
  it("is built from fixture documents the recipient actually received", () => {
    const names = [...GSTR2B_INVOICE_FIXTURES, ...GSTR2B_NOTE_FIXTURES];
    for (const n of names) {
      const d = fixtures[n];
      expect(d.recipient.gstin).toBe(gstr2bFixture.data.gstin);
      expect(d.supplier.gstin).toBe(gstr2bFixture.data.docdata.b2b[0]?.ctin);
    }
    expect(gstr2bFixture.data.docdata.b2b[0]?.inv).toHaveLength(GSTR2B_INVOICE_FIXTURES.length);
    expect(gstr2bFixture.data.docdata.cdnr[0]?.nt).toHaveLength(GSTR2B_NOTE_FIXTURES.length);
  });
  it("is JSON text of the same object", () => {
    expect(JSON.parse(gstr2bFixtureText)).toEqual(gstr2bFixture);
  });
  it("uses only registered fixture GSTINs", () => {
    for (const m of gstr2bFixtureText.match(/\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][A-Z0-9][0-9A-Z]/g) ??
      [])
      expect(ALLOWED_FIXTURE_GSTINS).toContain(m);
  });
});
