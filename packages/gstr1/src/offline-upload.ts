// Source: Output of the official GST Offline Tool 3.2.4 — sources/gstr1/offline-tool/code-excerpts.md §2 (header
//         "GST3.2.4" / "hash", key order), §3 (v4.1 shapes: doc_issue.doc_det with integer doc_num; etin on b2b/b2cl) —
//         validated against S4, GSTN API "GSTR1 – Save GSTR1 data" v4.1 (sources/gstr1/gstr1-save-v4.1-schema.json).
//         Track A2 sections follow S4 only (the tool's code for them is not excerpted, FA-3; spec §17.9 O8–O14); the
//         key order of the new sections is inferred (O9). No source says the portal's offline upload accepts this
//         shape (spec Q-2): acceptance is unverified.
// Retrieved: 2026-10-16 (Track A2: 2026-10-18)
// Status: UNVERIFIED — needs CA
import { z } from "zod";
import { ETIN_PATTERN } from "./recipient.js";
import {
  advancesOffline,
  docIssueOffline,
  fpWire,
  gstinWire,
  makeA2Sections,
  makeEcomSections,
  makeSections,
  makeSupecoSections,
} from "./wire-schema.js";
import { mapDocIssue, mapSections } from "./wire-map.js";
import { mapA2Sections, mapAdvancesOffline, supecoOfflineIssues } from "./wire-map-a2.js";
import type { Gstr1Return } from "./return-schema.js";
import type { Gstr1Issue } from "./types.js";

export const OFFLINE_VERSION = "GST3.2.4";
export const OFFLINE_HASH = "hash";

/** S4 allows `etin` (TCS operator GSTIN or empty) and ntty C, D only. */
const etinS4 = z.union([z.string().regex(ETIN_PATTERN), z.literal("")]);
const sections = makeSections(etinS4, ["C", "D"]);
const a2 = makeA2Sections(etinS4, ["C", "D"]);
const ecom = makeEcomSections();
const supeco = makeSupecoSections("S4");

export const OfflineUploadJsonSchema = z.strictObject({
  gstin: gstinWire(),
  fp: fpWire(),
  version: z.literal(OFFLINE_VERSION),
  hash: z.literal(OFFLINE_HASH),
  b2b: sections.b2b,
  b2ba: a2.b2ba,
  b2cl: sections.b2cl,
  b2cla: a2.b2cla,
  b2cs: sections.b2cs,
  b2csa: a2.b2csa,
  exp: sections.exp,
  expa: a2.expa,
  cdnr: sections.cdnr,
  cdnra: a2.cdnra,
  cdnur: sections.cdnur,
  cdnura: a2.cdnura,
  nil: a2.nil,
  at: advancesOffline("at"),
  ata: advancesOffline("ata"),
  txpd: advancesOffline("txpd"),
  txpda: advancesOffline("txpda"),
  supeco: supeco.supeco,
  supecoa: supeco.supecoa,
  ecom: ecom.ecom,
  ecoma: ecom.ecoma,
  doc_issue: docIssueOffline().optional(),
  hsn: sections.hsn,
});
export type OfflineUploadJson = z.infer<typeof OfflineUploadJsonSchema>;

/**
 * The tool's key order for the v0.1 sections (T §2); each amendment key right after its base key (T §2 shows
 * `b2b, b2ba, b2cl`); the remaining Track A2 keys before `doc_issue`, in S4 order — inferred (O9).
 */
const OFFLINE_ORDER = [
  "b2b",
  "b2ba",
  "b2cl",
  "b2cla",
  "b2cs",
  "b2csa",
  "exp",
  "expa",
  "cdnr",
  "cdnra",
  "cdnur",
  "cdnura",
  "nil",
  "at",
  "ata",
  "txpd",
  "txpda",
  "supeco",
  "supecoa",
  "ecom",
  "ecoma",
] as const;

/** Pure mapping, the tool's key order; NOT_IN_OFFLINE_SHAPE issues for what S4 cannot express (O11, O13). */
export function mapOffline(ret: Gstr1Return): { value: unknown; issues: Gstr1Issue[] } {
  const adv = mapAdvancesOffline(ret);
  const s = { ...mapSections(ret, true), ...mapA2Sections(ret), ...adv.value };
  const di = mapDocIssue(ret, (code) => code);
  const out: Record<string, unknown> = {
    gstin: ret.gstin,
    fp: ret.period,
    version: OFFLINE_VERSION,
    hash: OFFLINE_HASH,
  };
  for (const k of OFFLINE_ORDER) if (s[k] !== undefined) out[k] = s[k];
  if (di.length > 0) out["doc_issue"] = { doc_det: di };
  if (s["hsn"] !== undefined) out["hsn"] = s["hsn"];
  return { value: out, issues: [...adv.issues, ...supecoOfflineIssues(ret)] };
}
