// Source: GSTN API "GSTR1 – Save GSTR1 data" v5.0 (FINAL, published 23-02-2026) — sources/gstr1/gstr1-save-v5.0-schema.json.
//         The in-scope sections of S5 are transcribed to Zod; S5 itself is the test oracle (Ajv). Track A2 sections
//         (spec §17.9): b2ba, b2cla, b2csa, cdnra, cdnura, nil, expa, at, txpd, ata, txpda, ecom, ecoma, supeco,
//         supecoa; S5 has no `etin`, so e-commerce marks give the info-level ECO_NOT_IN_API_SHAPE (D-A8, downgraded
//         from a warning by the owner's answer to Q-A15: Notification 26/2022-CT omitted Tables 4C/5B and the operator
//         totals belong in Table 14 — sources/gstr1/notification-26-2022-ct-gstr1-excerpt.txt; spec §17.22).
// Retrieved: 2026-10-16 (Track A2: 2026-10-18)
// Status: UNVERIFIED — needs CA
import { z } from "zod";
import {
  advancesApiNamed,
  docIssueApi,
  fpWire,
  gstinWire,
  makeA2Sections,
  makeEcomSections,
  makeSections,
  makeSupecoSections,
} from "./wire-schema.js";
import { mapDocIssue, mapSections } from "./wire-map.js";
import { mapA2Sections, mapAdvancesApi } from "./wire-map-a2.js";
import type { Gstr1Return } from "./return-schema.js";
import { issue, type Gstr1Issue } from "./types.js";

/** S5 keeps `etin` out (removed in v5.0) and allows ntty C, D and R. */
const sections = makeSections(z.never(), ["C", "D", "R"]);
const a2 = makeA2Sections(z.never(), ["C", "D", "R"]);
const ecom = makeEcomSections();
const supeco = makeSupecoSections("S5");

export const ApiSavePayloadSchema = z.strictObject({
  gstin: gstinWire(),
  fp: fpWire(),
  hash: z.string().optional(),
  version: z.string().optional(),
  b2b: sections.b2b,
  b2ba: a2.b2ba,
  b2cl: sections.b2cl,
  b2cla: a2.b2cla,
  b2cs: sections.b2cs,
  b2csa: a2.b2csa,
  cdnr: sections.cdnr,
  cdnra: a2.cdnra,
  cdnur: sections.cdnur,
  cdnura: a2.cdnura,
  nil: a2.nil,
  exp: sections.exp,
  expa: a2.expa,
  at: advancesApiNamed("at"),
  txpd: advancesApiNamed("txpd"),
  ata: advancesApiNamed("ata"),
  txpda: advancesApiNamed("txpda"),
  ecom: ecom.ecom,
  ecoma: ecom.ecoma,
  supeco: supeco.supeco,
  supecoa: supeco.supecoa,
  hsn: sections.hsn,
  doc_issue: docIssueApi().optional(),
});
export type ApiSavePayload = z.infer<typeof ApiSavePayloadSchema>;

/** S5 property order (spec §17.9). */
const API_ORDER = [
  "b2b",
  "b2ba",
  "b2cl",
  "b2cla",
  "b2cs",
  "b2csa",
  "cdnr",
  "cdnra",
  "cdnur",
  "cdnura",
  "nil",
  "exp",
  "expa",
  "at",
  "txpd",
  "ata",
  "txpda",
  "ecom",
  "ecoma",
  "supeco",
  "supecoa",
  "hsn",
] as const;

/** Pure mapping in S5 key order: gstin, fp, [hash, version], b2b, b2ba, …, hsn, doc_issue. */
export function mapApi(
  ret: Gstr1Return,
  header: { version?: string; hash?: string } = {},
): unknown {
  const s = { ...mapSections(ret), ...mapA2Sections(ret), ...mapAdvancesApi(ret) };
  const di = mapDocIssue(ret, (code) => String(code));
  const out: Record<string, unknown> = { gstin: ret.gstin, fp: ret.period };
  if (header.hash !== undefined) out["hash"] = header.hash;
  if (header.version !== undefined) out["version"] = header.version;
  for (const k of API_ORDER) if (s[k] !== undefined) out[k] = s[k];
  if (di.length > 0) out["doc_issue"] = { doc_det_new: di };
  return out;
}

/** ECO_NOT_IN_API_SHAPE: one info-level note per e-commerce-marked invoice (spec §17.7, §17.22). */
export function apiInfo(ret: Gstr1Return): Gstr1Issue[] {
  const out: Gstr1Issue[] = [];
  const warn = (number: string, path: (string | number)[]) => {
    out.push(
      issue(
        "ECO_NOT_IN_API_SHAPE",
        `${number}: the e-commerce operator GSTIN is not written to the v5.0 API payload (S5 has no etin). ` +
          "Notification 26/2022-CT omitted Tables 4C/5B; report supplies through an operator collecting TCS " +
          "operator-wise in Table 14 (supeco)",
        { documentNumber: number, path, severity: "info" },
      ),
    );
  };
  for (const [gi, g] of ret.b2b.entries()) {
    for (const [i, v] of g.invoices.entries()) {
      if (v.etin !== undefined) warn(v.number, ["b2b", gi, "invoices", i, "etin"]);
    }
  }
  for (const [gi, g] of ret.b2cl.entries()) {
    for (const [i, v] of g.invoices.entries()) {
      if (v.etin !== undefined) warn(v.number, ["b2cl", gi, "invoices", i, "etin"]);
    }
  }
  return out;
}
