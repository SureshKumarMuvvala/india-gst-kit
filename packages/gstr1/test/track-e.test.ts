import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  arrayElement,
  isNumberLeaf,
  objectShape,
  parseGstDocument,
  type GstDocument,
} from "@india-gst-kit/model";
import { ApiSavePayloadSchema, toApiSavePayload, toOfflineUploadJson } from "../src/index.js";
import { build, mkDoc, ret } from "./helpers.js";
import type { z } from "zod";

// Track E (gstr1 spec §16).

function child(schema: z.ZodType | undefined, key: string): z.ZodType | undefined {
  if (schema === undefined) return undefined;
  const el = arrayElement(schema);
  const obj = objectShape(el ?? schema);
  return obj?.[key];
}

describe("lossless JSON from the model (§16.1)", () => {
  it("the model's isNumberLeaf sees gstr1's number leaves (one shared registry)", () => {
    let s: z.ZodType | undefined = ApiSavePayloadSchema;
    for (const k of ["b2b", "inv", "itms", "itm_det", "txval"]) s = child(s, k);
    expect(s).toBeDefined();
    if (s !== undefined) expect(isNumberLeaf(s)).toBe(true);
  });

  it("no package source other than model/src/lossless.ts has a JSON.parse reviver or a JsonNumber class", () => {
    const root = new URL("../../", import.meta.url);
    const offenders: string[] = [];
    for (const pkg of readdirSync(root)) {
      const src = new URL(`${pkg}/src/`, root);
      let files: string[];
      try {
        files = readdirSync(src, { recursive: true }).map(String);
      } catch {
        continue;
      }
      for (const f of files.filter((x) => x.endsWith(".ts"))) {
        const rel = `${pkg}/src/${f}`;
        if (rel === "model/src/lossless.ts") continue;
        const text = readFileSync(new URL(f, src), "utf8");
        if (/JSON\.parse\(\s*[^,()]+,/.test(text) || /class\s+JsonNumber\b/.test(text)) {
          offenders.push(rel);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("ship-to / dispatch-from are ignored by GSTR-1 (§16.2)", () => {
  it("the return, API payload and offline JSON are identical with and without them", () => {
    const plain = mkDoc();
    const r = parseGstDocument({
      ...plain,
      shipTo: {
        legalName: "Chennai Delivery Site",
        address: { line1: "12 Harbour Road", city: "Chennai", pincode: "600002", stateCode: "33" },
      },
      dispatchFrom: {
        legalName: "Depot",
        address: { line1: "11 Depot Lane", city: "Hosur", pincode: "635109", stateCode: "33" },
      },
    });
    expect(r.success).toBe(true);
    const shipped = r.data as GstDocument;
    expect(shipped.placeOfSupply).not.toBe("33");
    expect(build([shipped])).toEqual(build([plain]));
    const a = ret([plain]);
    const b = ret([shipped]);
    expect(b).toEqual(a);
    expect(toApiSavePayload(b)).toEqual(toApiSavePayload(a));
    expect(toOfflineUploadJson(b)).toEqual(toOfflineUploadJson(a));
  });
});
