// Source: GSTN API "GSTR1 – Save GSTR1 data" v5.0 (FINAL, published 23-02-2026) — sources/gstr1/gstr1-save-v5.0-schema.json.
//         The in-scope sections of S5 are transcribed to Zod; S5 itself is the test oracle (Ajv).
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
import { z } from "zod";
import { docIssueApi, fpWire, gstinWire, makeSections } from "./wire-schema.js";
import { mapDocIssue, mapSections } from "./wire-map.js";
import type { Gstr1Return } from "./return-schema.js";

/** S5 keeps `etin` out (removed in v5.0) and allows ntty C, D and R. */
const sections = makeSections(z.never(), ["C", "D", "R"]);

export const ApiSavePayloadSchema = z.strictObject({
  gstin: gstinWire(),
  fp: fpWire(),
  hash: z.string().optional(),
  version: z.string().optional(),
  b2b: sections.b2b,
  b2cl: sections.b2cl,
  b2cs: sections.b2cs,
  cdnr: sections.cdnr,
  cdnur: sections.cdnur,
  exp: sections.exp,
  hsn: sections.hsn,
  doc_issue: docIssueApi().optional(),
});
export type ApiSavePayload = z.infer<typeof ApiSavePayloadSchema>;

/** Pure mapping, S5 key order: gstin, fp, [hash, version], b2b, b2cl, b2cs, cdnr, cdnur, exp, hsn, doc_issue. */
export function mapApi(
  ret: Gstr1Return,
  header: { version?: string; hash?: string } = {},
): unknown {
  const s = mapSections(ret);
  const di = mapDocIssue(ret, (code) => String(code));
  return {
    gstin: ret.gstin,
    fp: ret.period,
    ...(header.hash === undefined ? {} : { hash: header.hash }),
    ...(header.version === undefined ? {} : { version: header.version }),
    ...(s["b2b"] === undefined ? {} : { b2b: s["b2b"] }),
    ...(s["b2cl"] === undefined ? {} : { b2cl: s["b2cl"] }),
    ...(s["b2cs"] === undefined ? {} : { b2cs: s["b2cs"] }),
    ...(s["cdnr"] === undefined ? {} : { cdnr: s["cdnr"] }),
    ...(s["cdnur"] === undefined ? {} : { cdnur: s["cdnur"] }),
    ...(s["exp"] === undefined ? {} : { exp: s["exp"] }),
    ...(s["hsn"] === undefined ? {} : { hsn: s["hsn"] }),
    ...(di.length === 0 ? {} : { doc_issue: { doc_det_new: di } }),
  };
}
