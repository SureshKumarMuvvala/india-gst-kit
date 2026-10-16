// Source: Output of the official GST Offline Tool 3.2.4 — sources/gstr1/offline-tool/code-excerpts.md §2 (header
//         "GST3.2.4" / "hash", key order), §3 (v4.1 shapes: doc_issue.doc_det with integer doc_num) — validated against
//         S4, GSTN API "GSTR1 – Save GSTR1 data" v4.1 (sources/gstr1/gstr1-save-v4.1-schema.json).
//         No source says the portal's offline upload accepts this shape (spec Q-2): acceptance is unverified.
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
import { z } from "zod";
import { ETIN_PATTERN } from "./recipient.js";
import { docIssueOffline, fpWire, gstinWire, makeSections } from "./wire-schema.js";
import { mapDocIssue, mapSections } from "./wire-map.js";
import type { Gstr1Return } from "./return-schema.js";

export const OFFLINE_VERSION = "GST3.2.4";
export const OFFLINE_HASH = "hash";

/** S4 allows `etin` (TCS operator GSTIN or empty) and ntty C, D only. */
const sections = makeSections(z.union([z.string().regex(ETIN_PATTERN), z.literal("")]), ["C", "D"]);

export const OfflineUploadJsonSchema = z.strictObject({
  gstin: gstinWire(),
  fp: fpWire(),
  version: z.literal(OFFLINE_VERSION),
  hash: z.literal(OFFLINE_HASH),
  b2b: sections.b2b,
  b2cl: sections.b2cl,
  b2cs: sections.b2cs,
  exp: sections.exp,
  cdnr: sections.cdnr,
  cdnur: sections.cdnur,
  doc_issue: docIssueOffline().optional(),
  hsn: sections.hsn,
});
export type OfflineUploadJson = z.infer<typeof OfflineUploadJsonSchema>;

/** Pure mapping, the tool's key order: gstin, fp, version, hash, b2b, b2cl, b2cs, exp, cdnr, cdnur, doc_issue, hsn. */
export function mapOffline(ret: Gstr1Return): unknown {
  const s = mapSections(ret);
  const di = mapDocIssue(ret, (code) => code);
  return {
    gstin: ret.gstin,
    fp: ret.period,
    version: OFFLINE_VERSION,
    hash: OFFLINE_HASH,
    ...(s["b2b"] === undefined ? {} : { b2b: s["b2b"] }),
    ...(s["b2cl"] === undefined ? {} : { b2cl: s["b2cl"] }),
    ...(s["b2cs"] === undefined ? {} : { b2cs: s["b2cs"] }),
    ...(s["exp"] === undefined ? {} : { exp: s["exp"] }),
    ...(s["cdnr"] === undefined ? {} : { cdnr: s["cdnr"] }),
    ...(s["cdnur"] === undefined ? {} : { cdnur: s["cdnur"] }),
    ...(di.length === 0 ? {} : { doc_issue: { doc_det: di } }),
    ...(s["hsn"] === undefined ? {} : { hsn: s["hsn"] }),
  };
}
