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
      "ewbRoute",
      "toEwbRequest",
      "toEwbByIrnRequest",
      "toIrnEwbDtls",
      "validateEwbRequest",
      "validateEwbByIrnRequest",
      "validateEwbDtls",
      "serializeEwbRequest",
      "parseEwbRequestJson",
      "serializeEwbByIrnRequest",
      "parseEwbByIrnRequestJson",
      "parseEwbResponseData",
      "parseEwbByIrnResponseData",
      "EWB_STATE_CODES",
      "EWB_MAX_ITEMS",
      "EWB_MAX_DISTANCE_KM",
      "EINVOICE_EWB_BLOCK_FROM",
      "EWB_MAX_DOC_AGE_DAYS",
      "EwbMovementSchema",
      "EwbTransportSchema",
      "EwbRequestSchema",
      "EwbByIrnRequestSchema",
    ] as const) {
      expect(api, name).toHaveProperty(name);
    }
  });
  it("the constants have the documented values", () => {
    expect(api.EWB_MAX_ITEMS).toBe(250);
    expect(api.EWB_MAX_DISTANCE_KM).toBe("4000");
    expect(api.EINVOICE_EWB_BLOCK_FROM).toBe("2020-10-01");
    expect(api.EWB_MAX_DOC_AGE_DAYS).toBe(180);
  });
  it("never throws on bad data: results are returned", () => {
    for (const bad of [undefined, null, 1, "x", [], {}]) {
      expect(() => api.validateEwbRequest(bad)).not.toThrow();
      expect(() => api.validateEwbByIrnRequest(bad)).not.toThrow();
      expect(() => api.validateEwbDtls(bad)).not.toThrow();
      expect(() => api.toEwbByIrnRequest("x", bad as never)).not.toThrow();
      expect(() => api.toIrnEwbDtls(bad as never)).not.toThrow();
    }
    for (const bad of ["", "{", "[]", "null", "1", '"x"']) {
      expect(() => api.parseEwbRequestJson(bad)).not.toThrow();
      expect(() => api.parseEwbByIrnRequestJson(bad)).not.toThrow();
      expect(() => api.parseEwbResponseData(bad)).not.toThrow();
      expect(() => api.parseEwbByIrnResponseData(bad)).not.toThrow();
    }
  });
});

describe("data rules", () => {
  it("source and test files contain only registered synthetic GSTINs", () => {
    const shape = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][A-Z0-9][0-9A-Z]\b/g;
    for (const dirName of ["../src/", "./"]) {
      const dir = new URL(dirName, import.meta.url);
      for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
        const text = readFileSync(new URL(f, dir), "utf8");
        for (const m of text.match(shape) ?? []) {
          expect(ALLOWED_FIXTURE_GSTINS, `${f}: ${m}`).toContain(m);
        }
      }
    }
  });
  it("never uses the official placeholder GSTIN as data (it fails the check digit)", () => {
    // Split so that this file does not contain the placeholder itself.
    const placeholder = ["29ABCDE", "8755F1Z2"].join("");
    for (const dirName of ["../src/", "./"]) {
      const dir = new URL(dirName, import.meta.url);
      for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
        const text = readFileSync(new URL(f, dir), "utf8");
        expect(text, f).not.toContain(placeholder);
      }
    }
  });
});
