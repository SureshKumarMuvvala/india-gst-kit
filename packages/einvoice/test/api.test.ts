import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALLOWED_FIXTURE_GSTINS } from "@india-gst-kit/fixtures";
import * as api from "../src/index.js";

describe("api surface", () => {
  it("has no default export", () => {
    expect("default" in api).toBe(false);
  });
  it("exports the documented names", () => {
    for (const name of [
      "toIrnRequest",
      "validateIrnRequest",
      "serializeIrnRequest",
      "parseIrnRequestJson",
      "rupeeTolerance",
      "withinTolerance",
      "decodeJwt",
      "decodeSignedInvoice",
      "decodeSignedQrCode",
      "IRN_SCHEMA_VERSION",
      "DEFAULT_EARLIEST_DOC_DATE",
      "IrnRequestSchema",
      "JwtHeaderSchema",
      "SignedInvoiceDataSchema",
      "SignedQrDataSchema",
    ] as const) {
      expect(api, name).toHaveProperty(name);
    }
  });
  it("never throws on bad data: results are returned", () => {
    for (const bad of [undefined, null, 1, "x", [], {}]) {
      expect(() => api.validateIrnRequest(bad)).not.toThrow();
    }
    expect(() => api.parseIrnRequestJson("")).not.toThrow();
  });
});

describe("data rules", () => {
  it("source and test files contain only registered synthetic GSTINs", () => {
    const shape = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][A-Z0-9][0-9A-Z]\b/g;
    for (const dirName of ["../src/", "./"]) {
      const dir = new URL(dirName, import.meta.url);
      for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
        const text = readFileSync(new URL(f, dir), "utf8");
        for (const m of text.match(shape) ?? [])
          expect(ALLOWED_FIXTURE_GSTINS, `${f}: ${m}`).toContain(m);
      }
    }
  });
});
