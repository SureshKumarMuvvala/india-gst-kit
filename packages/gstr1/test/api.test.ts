import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";
import { ALLOWED_FIXTURE_GSTINS } from "@india-gst-kit/fixtures";
import { mkDoc, ret } from "./helpers.js";
import { goldenDocs } from "./scenarios.js";

describe("api surface", () => {
  it("exports the spec's functions, schemas and constants, and no default", () => {
    for (const name of [
      "buildGstr1",
      "toApiSavePayload",
      "toOfflineUploadJson",
      "classifyDocument",
      "b2clThreshold",
      "serializeGstr1",
      "parseApiSavePayloadJson",
      "parseOfflineUploadJson",
    ]) {
      expect(typeof (api as Record<string, unknown>)[name]).toBe("function");
    }
    for (const name of ["Gstr1ReturnSchema", "ApiSavePayloadSchema", "OfflineUploadJsonSchema"]) {
      expect((api as Record<string, unknown>)[name]).toBeDefined();
    }
    expect(api.GSTR1_RATES).toEqual([
      "0",
      "0.1",
      "0.25",
      "1",
      "1.5",
      "3",
      "5",
      "6",
      "7.5",
      "12",
      "18",
      "28",
      "40",
    ]);
    expect(api.DOC_ISSUE_TYPES.TAX_INVOICE).toMatchObject({
      code: 1,
      name: "Invoices for outward supply",
    });
    expect(api.DOC_ISSUE_TYPES.DEBIT_NOTE).toMatchObject({ code: 4, name: "Debit Note" });
    expect(api.DOC_ISSUE_TYPES.CREDIT_NOTE).toMatchObject({ code: 5, name: "Credit Note" });
    expect("default" in api).toBe(false);
  });
  it("no source file has a default export", () => {
    const dir = new URL("../src/", import.meta.url);
    for (const f of readdirSync(dir)) {
      expect(readFileSync(new URL(f, dir), "utf8")).not.toMatch(/export\s+default/);
    }
  });
  it("legal lists live in their own files with the Source / Retrieved / Status header", () => {
    for (const f of ["rates.ts", "doc-issue.ts"]) {
      const text = readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
      expect(text).toMatch(/^\/\/ Source: \S+/m);
      expect(text).toMatch(/^\/\/ Retrieved: \d{4}-\d{2}-\d{2}/m);
      expect(text).toMatch(/^\/\/ Status: UNVERIFIED — needs CA/m);
    }
  });
  it("docs/legal-facts.md has a row for every file the spec lists in §15", () => {
    const text = readFileSync(new URL("../../../docs/legal-facts.md", import.meta.url), "utf8");
    for (const f of [
      "packages/gstr1/src/api-payload.ts",
      "packages/gstr1/src/offline-upload.ts",
      "packages/gstr1/src/rates.ts",
      "packages/gstr1/src/classify.ts",
      "packages/gstr1/src/doc-issue.ts",
      "packages/gstr1/src/hsn.ts",
      "packages/gstr1/src/recipient.ts",
      "packages/gstr1/src/build.ts",
      "packages/gstr1/src/serialize.ts",
    ]) {
      expect(text).toContain(f);
    }
  });
  it("sources and tests contain only registered synthetic GSTINs", () => {
    const shape = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][A-Z0-9][0-9A-Z]\b/g;
    for (const d of ["../src/", "./"]) {
      const dir = new URL(d, import.meta.url);
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
        for (const m of readFileSync(new URL(f, dir), "utf8").match(shape) ?? []) {
          // the derived mutations in the tests are built at run time, never written down
          expect(ALLOWED_FIXTURE_GSTINS).toContain(m);
        }
      }
    }
  });
});

describe("Gstr1Return", () => {
  it("holds no schema-version-specific encoding", () => {
    const text = JSON.stringify(ret(goldenDocs()));
    for (const banned of [
      "doc_det",
      "doc_num",
      "inum",
      "idt",
      "itm_det",
      "hash",
      "version",
      "GST3.2.4",
    ]) {
      expect(text).not.toContain(banned);
    }
  });
  it("validates against Gstr1ReturnSchema, which is strict", () => {
    const r = ret(goldenDocs());
    expect(api.Gstr1ReturnSchema.safeParse(r).success).toBe(true);
    expect(api.Gstr1ReturnSchema.safeParse({ ...r, extra: 1 }).success).toBe(false);
  });
  it("keeps amounts as decimal strings", () => {
    const r = ret([mkDoc()]);
    expect(r.b2b[0]?.invoices[0]?.value).toBe("1180.00");
    expect(r.b2b[0]?.invoices[0]?.items[0]?.rate).toBe("18");
  });
});
