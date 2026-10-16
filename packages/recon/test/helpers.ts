import { fixtures, GSTINS, type FixtureName } from "@india-gst-kit/fixtures";
import { parseGstDocument, type GstDocument } from "@india-gst-kit/model";
import { expect } from "vitest";
import {
  Gstr2bRecordSchema,
  parseGstr2bJson,
  type Gstr2b,
  type Gstr2bRecord,
  type ReconIssue,
} from "../src/index.js";

export { GSTINS, fixtures };
export type Obj = Record<string, unknown>;

export function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("expected a value");
  return v;
}

/** A copy of `o` without the given keys. */
export function omit(o: Obj, ...keys: string[]): Obj {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
}

/** The document-level amount fields of a wire invoice. */
export const AMOUNT_KEYS = ["txval", "igst", "cgst", "sgst", "cess"];

// ---------- wire (JSON) builders ----------

export const supplierBlock = (over: Obj = {}): Obj => ({
  ctin: GSTINS.supplierKa,
  trdnm: "Alpha Test Traders Private Limited",
  supfildt: "11-05-2026",
  supprd: "042026",
  ...over,
});

export const wireInvoice = (over: Obj = {}): Obj => ({
  inum: "INV/001",
  typ: "R",
  dt: "20-04-2026",
  val: 1180,
  pos: "29",
  rev: "N",
  itcavl: "Y",
  txval: 1000,
  igst: 0,
  cgst: 90,
  sgst: 90,
  cess: 0,
  ...over,
});

export const wireNote = (over: Obj = {}): Obj => ({
  ntnum: "CN/001",
  typ: "C",
  suptyp: "R",
  dt: "20-04-2026",
  val: 1180,
  itcavl: "Y",
  txval: 1000,
  igst: 0,
  cgst: 90,
  sgst: 90,
  cess: 0,
  ...over,
});

export const wireItem = (over: Obj = {}): Obj => ({
  num: 1,
  rt: 18,
  txval: 1000,
  igst: 0,
  cgst: 90,
  sgst: 90,
  cess: 0,
  ...over,
});

/** A whole response; `docdata` and `data` fields can be extended. */
export const wireFile = (docdata: Obj, data: Obj = {}, root: Obj = {}): Obj => ({
  chksum: "SYNTHETICCHECKSUM1",
  data: {
    gstin: GSTINS.recipientKa,
    rtnprd: "042026",
    version: "4.5",
    gendt: "14-05-2026",
    docdata,
    ...data,
  },
  ...root,
});

/** JSON text where `{ __raw: "1e3" }` values are written as the bare literal `1e3`. */
export function jsonText(value: unknown): string {
  return JSON.stringify(value).replace(/\{"__raw":"([^"]+)"\}/g, "$1");
}
export const raw = (literal: string): Obj => ({ __raw: literal });

export const parse = (value: unknown) => parseGstr2bJson(jsonText(value));

export function parseOk(value: unknown): Gstr2b {
  const r = parse(value);
  expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  if (!r.ok || r.value === undefined) throw new Error("expected ok");
  return r.value;
}

export const codes = (issues: readonly ReconIssue[]): string[] => issues.map((i) => i.code);
export const errorsOf = (issues: readonly ReconIssue[]): ReconIssue[] =>
  issues.filter((i) => i.severity === "error");

// ---------- record / register builders (reconcile tests) ----------

export function record(
  over: Partial<Gstr2bRecord> = {},
  without: ("placeOfSupply" | "reverseCharge")[] = [],
): Gstr2bRecord {
  const base: Gstr2bRecord = {
    origin: "docdata",
    section: "b2b",
    returnPeriod: "042026",
    recipientGstin: GSTINS.recipientKa,
    supplier: { gstin: GSTINS.supplierKa, filingDate: "2026-05-11", filingPeriod: "042026" },
    documentType: "INVOICE",
    number: "INV/2026-27/0001",
    date: "2026-04-20",
    supplyType: "R",
    placeOfSupply: "29",
    reverseCharge: "N",
    amounts: {
      value: "1770.00",
      taxableValue: "1500.00",
      igst: "0.00",
      cgst: "135.00",
      sgst: "135.00",
      cess: "0.00",
    },
    amountsSource: "document",
    items: [],
    itc: { itcavl: "Y" },
    path: ["data", "docdata", "b2b", 0, "inv", 0],
  };
  const r: Partial<Gstr2bRecord> = { ...base, ...over };
  for (const k of without) Reflect.deleteProperty(r, k);
  return Gstr2bRecordSchema.parse(r);
}

/** Records get distinct paths (by index) unless they set their own. */
export function file(records: Gstr2bRecord[], over: Partial<Gstr2b> = {}): Gstr2b {
  return {
    gstin: GSTINS.recipientKa,
    returnPeriod: "042026",
    version: "4.5",
    generatedOn: "2026-05-14",
    records: records.map((r, i) => ({
      ...r,
      path:
        r.path[r.path.length - 1] === 0 && records.length > 1
          ? [...r.path.slice(0, -1), i]
          : r.path,
    })),
    ...over,
  };
}

export function regDoc(name: FixtureName, patch: Obj = {}): GstDocument {
  const r = parseGstDocument({ ...structuredClone(fixtures[name]), ...patch });
  if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  return r.data;
}

/** The fixture tax invoice with a different supplier-side identity. */
export const invoiceDoc = (patch: Obj = {}): GstDocument => regDoc("intraInvoice", patch);
