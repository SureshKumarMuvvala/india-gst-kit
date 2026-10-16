import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { GSTINS, parties } from "@india-gst-kit/fixtures";
import {
  computeLineTax,
  decideTaxSplit,
  gstinCheckDigit,
  parseGstDocument,
  type GstDocument,
} from "@india-gst-kit/model";
import {
  buildGstr1,
  serializeGstr1,
  toApiSavePayload,
  toOfflineUploadJson,
  type Gstr1Input,
  type Gstr1Issue,
  type Gstr1Return,
} from "../src/index.js";

export { GSTINS, parties };

export const FILER = GSTINS.supplierKa;
/** A period in which the ₹1 lakh B2CL limit applies. */
export const PERIOD = "102026";

type Obj = Record<string, unknown>;

export interface LineSpec {
  taxable: string;
  rate?: string;
  hsn?: string;
  qty?: string;
  unit?: string;
  service?: boolean;
  unitPrice?: string;
}

export interface DocSpec {
  kind?: "TAX_INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE" | "BILL_OF_SUPPLY";
  number?: string;
  date?: string;
  supplier?: Obj;
  recipient?: Obj;
  pos?: string;
  category?: string;
  reverseCharge?: boolean;
  original?: { number: string; date: string };
  lines?: LineSpec[];
  roundOff?: string;
  otherCharges?: string;
}

/** Builds and parses a synthetic document; tax amounts come from the model's own helper. */
export function mkDoc(spec: DocSpec = {}): GstDocument {
  const supplier = spec.supplier ?? parties.supplier;
  const recipient = spec.recipient ?? parties.recipientKa;
  const pos = spec.pos ?? String(recipient["stateCode"]);
  const category = spec.category ?? "DOMESTIC";
  const kind = spec.kind ?? "TAX_INVOICE";
  const zero =
    kind === "BILL_OF_SUPPLY" ||
    supplier["registrationType"] === "COMPOSITION" ||
    category === "SEZ_WITHOUT_PAYMENT" ||
    category === "EXPORT_WITHOUT_PAYMENT";
  const split = decideTaxSplit(
    String(supplier["stateCode"]),
    pos,
    category as Parameters<typeof decideTaxSplit>[2],
  );
  const lines = (spec.lines ?? [{ taxable: "1000.00" }]).map((l, i) => {
    const rate = l.rate ?? "18";
    const tax = zero
      ? { cgst: "0.00", sgst: "0.00", igst: "0.00" }
      : computeLineTax(l.taxable, rate, split);
    const total = (
      Number(l.taxable) +
      Number(tax.cgst) +
      Number(tax.sgst) +
      Number(tax.igst)
    ).toFixed(2);
    const base: Obj = {
      lineNo: i + 1,
      description: "Test item",
      hsnSac: l.hsn ?? (l.service === true ? "998313" : "8471"),
      isService: l.service === true,
      grossAmount: l.taxable,
      discount: "0.00",
      taxableValue: l.taxable,
      gstRate: rate,
      ...tax,
      cess: "0.00",
      lineTotal: total,
    };
    if (l.service !== true) {
      const qty = l.qty ?? "1";
      base["quantity"] = qty;
      base["unit"] = l.unit ?? "NOS";
      base["unitPrice"] = l.unitPrice ?? (Number(l.taxable) / Number(qty)).toFixed(3);
    }
    return base;
  });
  const sum = (f: string) => lines.reduce((a, l) => a + Number(l[f]), 0).toFixed(2);
  const roundOff = spec.roundOff ?? "0.00";
  const otherCharges = spec.otherCharges ?? "0.00";
  const grand = (Number(sum("lineTotal")) + Number(roundOff) + Number(otherCharges)).toFixed(2);
  const raw: Obj = {
    schemaVersion: "1",
    kind,
    number: spec.number ?? "INV/1",
    date: spec.date ?? "2026-10-05",
    supplier,
    recipient,
    placeOfSupply: pos,
    supplyCategory: category,
    reverseCharge: spec.reverseCharge ?? false,
    lines,
    totals: {
      taxableValue: sum("taxableValue"),
      cgst: sum("cgst"),
      sgst: sum("sgst"),
      igst: sum("igst"),
      cess: sum("cess"),
      lineDiscount: "0.00",
      otherCharges,
      roundOff,
      grandTotal: grand,
    },
  };
  if (spec.original !== undefined) raw["originalDocument"] = spec.original;
  const r = parseGstDocument(raw);
  if (!r.success) throw new Error(`document does not parse: ${JSON.stringify(r.error.issues)}`);
  return r.data;
}

export function build(documents: readonly GstDocument[], extra: Partial<Gstr1Input> = {}) {
  return buildGstr1({ gstin: FILER, period: PERIOD, documents, ...extra });
}

export function issuesOf(
  documents: readonly GstDocument[],
  extra: Partial<Gstr1Input> = {},
): readonly Gstr1Issue[] {
  const r = build(documents, extra);
  return r.ok ? [] : r.issues;
}

export function codes(documents: readonly GstDocument[], extra: Partial<Gstr1Input> = {}) {
  return issuesOf(documents, extra).map((i) => i.code);
}

export function ret(
  documents: readonly GstDocument[],
  extra: Partial<Gstr1Input> = {},
): Gstr1Return {
  const r = build(documents, extra);
  if (!r.ok) throw new Error(`build failed: ${JSON.stringify(r.issues)}`);
  return r.value;
}

export type Json = unknown;

export type Path = readonly (string | number)[];

/** Reads the value at `path` of parsed JSON (`undefined` when any step is missing). */
export function at(root: unknown, ...path: Path): unknown {
  let cur = root;
  for (const p of path) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string | number, unknown>)[p];
  }
  return cur;
}

/** The array at `path`; fails the test if it is not one. */
export function list(root: unknown, ...path: Path): unknown[] {
  const v = at(root, ...path);
  if (!Array.isArray(v)) throw new Error(`not an array at ${path.join(".")}: ${JSON.stringify(v)}`);
  return v as unknown[];
}

/** The object at `path`; fails the test if it is not one. */
export function rec(root: unknown, ...path: Path): Record<string, unknown> {
  const v = at(root, ...path);
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new Error(`not an object at ${path.join(".")}: ${JSON.stringify(v)}`);
  }
  return v as Record<string, unknown>;
}

/** Sets (or, with `undefined`, deletes) the value at `path`, in place. */
export function put(root: unknown, path: Path, value: unknown): void {
  const parent = rec(root, ...path.slice(0, -1));
  const last = path[path.length - 1];
  if (last === undefined) throw new Error("empty path");
  if (value === undefined) Reflect.deleteProperty(parent, last);
  else parent[last] = value;
}

/** Output (a) as a plain JS object (numbers are doubles here; use serializeGstr1 for exact text). */
export function api(
  documents: readonly GstDocument[],
  extra: Partial<Gstr1Input> = {},
): Record<string, unknown> {
  const r = toApiSavePayload(ret(documents, extra));
  if (!r.ok) throw new Error(`render failed: ${JSON.stringify(r.issues)}`);
  return JSON.parse(serializeGstr1(r.value)) as Record<string, unknown>;
}

export function offline(
  documents: readonly GstDocument[],
  extra: Partial<Gstr1Input> = {},
): Record<string, unknown> {
  const r = toOfflineUploadJson(ret(documents, extra));
  if (!r.ok) throw new Error(`render failed: ${JSON.stringify(r.issues)}`);
  return JSON.parse(serializeGstr1(r.value)) as Record<string, unknown>;
}

/** An unregistered customer in another state (inter-state B2C). */
export const unregMh: Obj = {
  ...parties.unregistered,
  stateCode: "27",
  address: { ...parties.unregistered.address, stateCode: "27" },
};

/** A derived GSTIN with a valid mod-36 digit: first 14 characters given. */
export function withCheck(first14: string): string {
  return first14 + gstinCheckDigit(first14);
}

/** A party with the given GSTIN (state taken from the GSTIN). */
export function partyWith(gstin: string, base: Obj = parties.recipientKa): Obj {
  const sc = gstin.slice(0, 2);
  return {
    ...base,
    gstin,
    stateCode: sc,
    address: { ...(base["address"] as Obj), stateCode: sc },
  };
}

// ---- JSON Schema (Ajv) ----

function loadSchema(name: string): object {
  const url = new URL(`../../../sources/gstr1/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as object;
}

function ajv(schema: object) {
  // strict: false because of the publisher's quirks (README of sources/gstr1);
  // multipleOfPrecision tolerates binary doubles such as 0.07 / 0.01.
  return new Ajv({ strict: false, allErrors: false, multipleOfPrecision: 2 }).compile(schema);
}

export const validateS5 = ajv(loadSchema("gstr1-save-v5.0-schema.json"));
export const validateS4 = ajv(loadSchema("gstr1-save-v4.1-schema.json"));

export function sizeOf(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** The first element; fails the test when there is none (instead of a non-null assertion). */
export function first<T>(xs: readonly T[] | undefined): T {
  const x = xs?.[0];
  if (x === undefined) throw new Error("expected at least one element");
  return x;
}
