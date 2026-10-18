// Source: Document date range 01-07-2017 … end of the return period (T §4 `validateDate`,
//         sources/gstr1/offline-tool/code-excerpts.md); rejections of bills of supply and of composition, SEZ-unit and
//         SEZ-developer suppliers are the owner's decision DEC-4 (spec §13); amounts are the documents' own line
//         amounts summed per rate, never recomputed (DEC-5).
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
import {
  isTemporaryId,
  type DocumentKind,
  type Gstin,
  type GstDocument,
} from "@india-gst-kit/model";
import {
  classifyDocument,
  type Classification,
  type OriginalRef,
  type Placement,
} from "./classify.js";
import { D, fmt2, type Dec } from "./decimal.js";
import { exportItemsOf, itemsOf } from "./items.js";
import {
  DocIssueTypeSchema,
  docIssueIssues,
  toEntries,
  type DocIssueSeries,
  type DocIssueType,
} from "./doc-issue.js";
import { hsnRows, type Placed } from "./hsn.js";
import { buildAmendments, type DocumentAmendment } from "./amend.js";
import {
  buildAdvances,
  buildB2csa,
  buildEcom,
  buildNil,
  buildSupeco,
  parseEcoMarks,
} from "./tables.js";
import type {
  AdvancesInput,
  B2csAmendmentInput,
  EcoMarkInput,
  EcomInput,
  NilRowInput,
  SupecoInput,
} from "./inputs.js";
import { periodEnd } from "./classify.js";
import { isS5Gstin } from "./recipient.js";
import { Gstr1ReturnSchema, type Gstr1Return, type Item } from "./return-schema.js";
import {
  issue,
  periodKey,
  ReturnPeriodSchema,
  type Gstr1Issue,
  type ReturnPeriod,
  type Section,
} from "./types.js";

export interface Gstr1Input {
  /** The filer = `supplier.gstin` of every document. */
  gstin: Gstin;
  /** "MMYYYY"; supported from 052025. */
  period: ReturnPeriod;
  /** Already passed `parseGstDocument`. */
  documents: readonly GstDocument[];
  options?: {
    /** Where each original invoice was reported, for notes whose original is not in `documents` (§3.3). */
    originalInvoices?: readonly { document: GstDocument; period: ReturnPeriod }[];
    /** HSN minimum 6 digits instead of 4 (§5.2); default false. */
    aatoAbove5Cr?: boolean;
    /** Overrides the derivation of doc_issue (§5.3). */
    docIssue?: readonly DocIssueSeries[];
  };
  // ---- Track A2 (spec §17.2): caller-supplied tables; the package never decides them (D-A1). ----
  /** Tables 9A / 9C: full revised documents with the original as reported earlier (§17.3). */
  amendments?: readonly DocumentAmendment[];
  /** Table 10: revised Table 7 rows with the rows as first reported (§17.4). */
  b2csAmendments?: readonly B2csAmendmentInput[];
  /** Table 8: nil rated, exempted and non-GST amounts (§17.5). */
  nil?: readonly NilRowInput[];
  /** Table 11: advances received / adjusted and their amendments (§17.6). */
  advances?: AdvancesInput;
  /** Documents made through an e-commerce operator attracting TCS (§17.7, §17.21). */
  ecoMarks?: readonly EcoMarkInput[];
  /** Table 14 / 14A rows, reported by the supplier (§17.8). */
  supeco?: SupecoInput;
  /** Table 15 / 15A rows, reported by the operator (§17.8). */
  ecom?: EcomInput;
}

export type Gstr1Result =
  | {
      ok: true;
      value: Gstr1Return;
      classification: readonly { kind: DocumentKind; number: string; section: Section }[];
    }
  | { ok: false; issues: readonly Gstr1Issue[] };

function group<T, V>(map: Map<string, { key: T; list: V[] }>, id: string, key: T, v: V): void {
  const g = map.get(id);
  if (g === undefined) map.set(id, { key, list: [v] });
  else g.list.push(v);
}

interface B2csAcc {
  supplyType: "INTRA" | "INTER";
  pos: string;
  rate: string;
  taxableValue: Dec;
  igst: Dec;
  cgst: Dec;
  sgst: Dec;
  cess: Dec;
}

function emptyReturn(gstin: string, period: string): Gstr1Return {
  return {
    gstin,
    period,
    b2b: [],
    b2cl: [],
    b2cs: [],
    cdnr: [],
    cdnur: [],
    exp: [],
    hsn: { b2b: [], b2c: [] },
    docIssue: [],
  };
}

const MAX_VALUE = new D("9999999999999.99");
const MAX_ITEM = new D("99999999999.99");
const MAX_RATE = new D("999.99");

/** AMOUNT_OUT_OF_RANGE: every emitted amount against S5's ranges (§4.1). */
function rangeIssues(ret: Gstr1Return): Gstr1Issue[] {
  const out: Gstr1Issue[] = [];
  const bad = (what: string, value: string, path: (string | number)[], documentNumber?: string) => {
    out.push(
      issue("AMOUNT_OUT_OF_RANGE", `${what} ${value} is outside the portal's range`, {
        path,
        ...(documentNumber === undefined ? {} : { documentNumber }),
      }),
    );
  };
  const check = (
    what: string,
    value: string | undefined,
    path: (string | number)[],
    o: { min?: Dec; max: Dec },
    documentNumber?: string,
  ) => {
    if (value === undefined) return;
    const d = new D(value);
    if (d.gt(o.max) || (o.min !== undefined && d.lt(o.min))) bad(what, value, path, documentNumber);
  };
  const nonNeg = { min: new D(0), max: MAX_ITEM };
  const items = (list: readonly Item[], path: (string | number)[], n: string) => {
    list.forEach((it, i) => {
      check("rate", it.rate, [...path, i, "rate"], { min: new D(0), max: MAX_RATE }, n);
      for (const k of ["taxableValue", "igst", "cgst", "sgst", "cess"] as const) {
        check(k, it[k], [...path, i, k], nonNeg, n);
      }
    });
  };
  const doc = (
    d: { number: string; value: string; items: readonly Item[] },
    path: (string | number)[],
  ) => {
    check("value", d.value, [...path, "value"], { min: new D(0), max: MAX_VALUE }, d.number);
    items(d.items, [...path, "items"], d.number);
  };
  for (const [gi, g] of ret.b2b.entries()) {
    for (const [i, v] of g.invoices.entries()) doc(v, ["b2b", gi, "invoices", i]);
  }
  for (const [gi, g] of ret.b2cl.entries()) {
    for (const [i, v] of g.invoices.entries()) doc(v, ["b2cl", gi, "invoices", i]);
  }
  for (const [gi, g] of ret.cdnr.entries()) {
    for (const [i, v] of g.notes.entries()) doc(v, ["cdnr", gi, "notes", i]);
  }
  for (const [i, v] of ret.cdnur.entries()) doc(v, ["cdnur", i]);
  for (const [gi, g] of (ret.b2ba ?? []).entries()) {
    for (const [i, v] of g.invoices.entries()) doc(v, ["b2ba", gi, "invoices", i]);
  }
  for (const [gi, g] of (ret.b2cla ?? []).entries()) {
    for (const [i, v] of g.invoices.entries()) doc(v, ["b2cla", gi, "invoices", i]);
  }
  for (const [gi, g] of (ret.cdnra ?? []).entries()) {
    for (const [i, v] of g.notes.entries()) doc(v, ["cdnra", gi, "notes", i]);
  }
  for (const [i, v] of (ret.cdnura ?? []).entries()) doc(v, ["cdnura", i]);
  for (const [gi, g] of (ret.expa ?? []).entries()) {
    for (const [i, v] of g.invoices.entries()) doc(v, ["expa", gi, "invoices", i]);
  }
  for (const [gi, g] of ret.exp.entries()) {
    for (const [i, v] of g.invoices.entries()) {
      const path = ["exp", gi, "invoices", i];
      check("value", v.value, [...path, "value"], { min: new D(0), max: MAX_VALUE }, v.number);
      items(
        v.items.map((x) => ({ ...x })),
        [...path, "items"],
        v.number,
      );
    }
  }
  ret.b2cs.forEach((r, i) => {
    for (const k of ["taxableValue", "igst", "cgst", "sgst", "cess"] as const) {
      check(k, r[k], ["b2cs", i, k], { max: MAX_ITEM });
    }
    check("rate", r.rate, ["b2cs", i, "rate"], { min: new D(0), max: MAX_RATE });
  });
  for (const name of ["b2b", "b2c"] as const) {
    ret.hsn[name].forEach((r, i) => {
      const range = { min: MAX_VALUE.neg(), max: MAX_VALUE };
      for (const k of ["taxableValue", "igst", "cgst", "sgst", "cess"] as const) {
        check(k, r[k], ["hsn", name, i, k], range);
      }
      check("quantity", r.quantity, ["hsn", name, i, "quantity"], {
        min: new D("-1e15"),
        max: new D("1e15"),
      });
    });
  }
  return out;
}

/** Classifies and aggregates `input.documents` once into the internal {@link Gstr1Return}. Never throws on data problems. */
export function buildGstr1(input: Gstr1Input): Gstr1Result {
  const issues: Gstr1Issue[] = [];
  const { gstin, period, documents } = input;
  const options = input.options ?? {};

  const periodCheck = ReturnPeriodSchema.safeParse(period);
  if (!periodCheck.success) {
    issues.push(
      issue("SCHEMA", `period "${period}" is not a return period (MMYYYY)`, { path: ["period"] }),
    );
    return { ok: false, issues };
  }
  if (periodKey(period) < periodKey("052025")) {
    issues.push(
      issue(
        "PERIOD_NOT_SUPPORTED",
        `return period ${period} is before 052025 (the HSN split starts then)`,
        {
          path: ["period"],
        },
      ),
    );
  }
  if (!isS5Gstin(gstin)) {
    issues.push(
      issue(
        "SUPPLIER_GSTIN_FORMAT",
        isTemporaryId(gstin)
          ? `filer GSTIN ${gstin} looks like a temporary ID, not a GSTIN (model spec §6.4)`
          : `filer GSTIN ${gstin} does not match the portal's pattern`,
        { path: ["gstin"] },
      ),
    );
  }

  // Duplicates: no two invoices, and no two notes, with the same number (H r378, r401).
  const seen = { invoice: new Set<string>(), note: new Set<string>() };
  for (const d of documents) {
    const bucket = d.kind === "CREDIT_NOTE" || d.kind === "DEBIT_NOTE" ? seen.note : seen.invoice;
    if (bucket.has(d.number)) {
      issues.push(
        issue("DUPLICATE_DOCUMENT", `document number ${d.number} is used more than once`, {
          documentNumber: d.number,
        }),
      );
    }
    bucket.add(d.number);
  }

  const findOriginal = (doc: GstDocument): OriginalRef | undefined => {
    const ref = doc.originalDocument;
    if (ref === undefined) return undefined;
    const same = (o: GstDocument) =>
      o.kind === "TAX_INVOICE" && o.number === ref.number && o.date === ref.date;
    const inReturn = documents.find(same);
    if (inReturn !== undefined) return { document: inReturn, period };
    return options.originalInvoices?.find((o) => same(o.document));
  };

  const placed: Placed[] = [];
  const classification: { kind: DocumentKind; number: string; section: Section }[] = [];
  for (const doc of documents) {
    const c: Classification = classifyDocument(doc, {
      period,
      filer: gstin,
      original: findOriginal(doc),
    });
    if (!c.ok) {
      issues.push(...c.issues);
      continue;
    }
    const placement: Placement = c;
    placed.push({ doc, placement });
    classification.push({ kind: doc.kind, number: doc.number, section: c.section });
  }

  const ret = emptyReturn(gstin, period);

  // ---- e-commerce marks (§17.7): only b2b R non-RCM and b2cl invoices ----
  const etinOf = new Map<string, string>();
  if (input.ecoMarks !== undefined) {
    const m = parseEcoMarks(input.ecoMarks);
    issues.push(...m.issues);
    for (const mark of m.marks) {
      const doc = documents.find((d) => d.kind === mark.kind && d.number === mark.number);
      if (doc === undefined) {
        issues.push(
          issue("ECO_UNKNOWN_DOCUMENT", `no ${mark.kind} ${mark.number} among the documents`, {
            path: mark.path,
            documentNumber: mark.number,
          }),
        );
        continue;
      }
      const p = placed.find((x) => x.doc === doc)?.placement;
      if (p === undefined) continue; // the document's own issues are already reported
      const ok =
        (p.section === "b2b" && p.invoiceType === "R" && !doc.reverseCharge) ||
        p.section === "b2cl";
      if (!ok) {
        issues.push(
          issue(
            "ECO_NOT_APPLICABLE",
            `${mark.number} (${p.section}) cannot be marked: only regular B2B invoices without reverse charge and B2CL invoices`,
            { path: mark.path, documentNumber: mark.number },
          ),
        );
        continue;
      }
      etinOf.set(`${doc.kind}|${doc.number}`, mark.etin);
    }
  }
  const etin = (doc: GstDocument) => {
    const e = etinOf.get(`${doc.kind}|${doc.number}`);
    return e === undefined ? {} : { etin: e };
  };

  // ---- sections ----
  const b2b = new Map<string, { key: string; list: Gr1B2bInvoice[] }>();
  const b2cl = new Map<string, { key: string; list: Gr1B2clInvoice[] }>();
  const cdnr = new Map<string, { key: string; list: Gr1CdnrNote[] }>();
  const exp = new Map<string, { key: "WPAY" | "WOPAY"; list: Gr1ExpInvoice[] }>();
  const b2cs = new Map<string, B2csAcc>();
  for (const { doc, placement } of placed) {
    const head = { number: doc.number, date: doc.date, value: doc.totals.grandTotal };
    const noteType = doc.kind === "CREDIT_NOTE" ? "C" : "D";
    switch (placement.section) {
      case "b2b":
        group(b2b, placement.ctin, placement.ctin, {
          ...head,
          pos: doc.placeOfSupply,
          reverseCharge: doc.reverseCharge,
          invoiceType: placement.invoiceType,
          ...etin(doc),
          items: itemsOf(doc, false),
        });
        break;
      case "b2cl":
        group(b2cl, doc.placeOfSupply, doc.placeOfSupply, {
          ...head,
          ...etin(doc),
          items: itemsOf(doc, true),
        });
        break;
      case "cdnr":
        group(cdnr, placement.ctin, placement.ctin, {
          ...head,
          noteType,
          pos: doc.placeOfSupply,
          reverseCharge: doc.reverseCharge,
          invoiceType: placement.invoiceType,
          items: itemsOf(doc, false),
        });
        break;
      case "cdnur":
        ret.cdnur.push({
          ...head,
          noteType,
          type: placement.type,
          ...(placement.type === "B2CL" ? { pos: doc.placeOfSupply } : {}),
          items: itemsOf(doc, true),
        });
        break;
      case "exp":
        group(exp, placement.exportType, placement.exportType, {
          ...head,
          items: exportItemsOf(doc),
        });
        break;
      case "b2cs": {
        const sign = doc.kind === "CREDIT_NOTE" ? -1 : 1;
        for (const it of itemsOf(doc, placement.supplyType === "INTER")) {
          const key = `${placement.supplyType}|${doc.placeOfSupply}|${it.rate}|OE`;
          const zero = new D(0);
          const acc: B2csAcc = b2cs.get(key) ?? {
            supplyType: placement.supplyType,
            pos: doc.placeOfSupply,
            rate: it.rate,
            taxableValue: zero,
            igst: zero,
            cgst: zero,
            sgst: zero,
            cess: zero,
          };
          const add = (a: Dec, v: string | undefined) =>
            v === undefined ? a : a.plus(new D(v).mul(sign));
          acc.taxableValue = add(acc.taxableValue, it.taxableValue);
          acc.igst = add(acc.igst, it.igst);
          acc.cgst = add(acc.cgst, it.cgst);
          acc.sgst = add(acc.sgst, it.sgst);
          acc.cess = add(acc.cess, it.cess);
          b2cs.set(key, acc);
        }
        break;
      }
    }
  }
  ret.b2b = [...b2b.values()].map((g) => ({ ctin: g.key, invoices: g.list }));
  ret.b2cl = [...b2cl.values()].map((g) => ({ pos: g.key, invoices: g.list }));
  ret.cdnr = [...cdnr.values()].map((g) => ({ ctin: g.key, notes: g.list }));
  ret.exp = [...exp.values()].map((g) => ({ exportType: g.key, invoices: g.list }));
  ret.b2cs = [...b2cs.values()]
    .sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : new D(a.rate).comparedTo(b.rate)))
    .map((a) => ({
      supplyType: a.supplyType,
      pos: a.pos,
      rate: a.rate,
      taxableValue: fmt2(a.taxableValue),
      ...(a.supplyType === "INTER"
        ? { igst: fmt2(a.igst) }
        : { cgst: fmt2(a.cgst), sgst: fmt2(a.sgst) }),
      cess: fmt2(a.cess),
    }));

  // ---- Track A2 tables (§17.3–§17.8); keys are set only when there is data, so v0.1 output is unchanged ----
  const supplierState = gstin.slice(0, 2);
  if (input.amendments !== undefined && input.amendments.length > 0) {
    const a = buildAmendments({
      filer: gstin,
      period,
      documents,
      amendments: input.amendments,
      findOriginal,
    });
    issues.push(...a.issues);
    for (const k of ["b2ba", "b2cla", "expa", "cdnra", "cdnura"] as const) {
      if (a.sections[k].length > 0) Object.assign(ret, { [k]: a.sections[k] });
    }
  }
  if (input.b2csAmendments !== undefined) {
    const t = buildB2csa(input.b2csAmendments, { period, supplierState });
    issues.push(...t.issues);
    if (t.rows.length > 0) ret.b2csa = t.rows;
  }
  if (input.nil !== undefined) {
    const t = buildNil(input.nil);
    issues.push(...t.issues);
    if (t.rows.length > 0) ret.nil = t.rows;
  }
  if (input.advances !== undefined) {
    const t = buildAdvances(input.advances, { period, supplierState });
    issues.push(...t.issues);
    const a = t.advances;
    if (
      a !== undefined &&
      a.received.length +
        a.adjusted.length +
        a.receivedAmendments.length +
        a.adjustedAmendments.length >
        0
    ) {
      ret.advances = a;
    }
  }
  if (input.supeco !== undefined) {
    const t = buildSupeco(input.supeco, { period });
    issues.push(...t.issues);
    const v = t.supeco;
    if (v !== undefined && Object.values(v).some((l) => l.length > 0)) ret.supeco = v;
  }
  if (input.ecom !== undefined) {
    const t = buildEcom(input.ecom, { period, periodEnd: periodEnd(period) });
    issues.push(...t.issues);
    const v = t.ecom;
    if (v !== undefined && Object.values(v).some((l) => l.length > 0)) ret.ecom = v;
  }

  // ---- hsn ----
  const hsn = hsnRows(placed, options.aatoAbove5Cr === true);
  ret.hsn = { b2b: hsn.b2b, b2c: hsn.b2c };
  issues.push(...hsn.issues);

  // ---- doc_issue ----
  if (options.docIssue !== undefined) {
    issues.push(...docIssueIssues(options.docIssue));
    ret.docIssue = toEntries(options.docIssue);
  } else {
    const prefix = `${period.slice(2)}-${period.slice(0, 2)}-`;
    const types: Record<string, DocIssueType | undefined> = {
      TAX_INVOICE: "TAX_INVOICE",
      DEBIT_NOTE: "DEBIT_NOTE",
      CREDIT_NOTE: "CREDIT_NOTE",
    };
    const series: DocIssueSeries[] = [];
    for (const type of DocIssueTypeSchema.options) {
      const mine = placed
        .map((p) => p.doc)
        .filter((d) => types[d.kind] === type && d.date.startsWith(prefix))
        .map((d, i) => ({ d, i }))
        .sort((a, b) => (a.d.date < b.d.date ? -1 : a.d.date > b.d.date ? 1 : a.i - b.i));
      const first = mine[0];
      const last = mine[mine.length - 1];
      if (first === undefined || last === undefined) continue;
      series.push({
        type,
        from: first.d.number,
        to: last.d.number,
        total: mine.length,
        cancelled: 0,
        netIssued: mine.length,
      });
    }
    ret.docIssue = toEntries(series);
  }

  issues.push(...rangeIssues(ret));

  if (issues.length > 0) return { ok: false, issues };
  const parsed = Gstr1ReturnSchema.safeParse(ret);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) =>
        issue("SCHEMA", `internal structure invalid: ${i.message}`, {
          path: i.path.map((p) => (typeof p === "number" ? p : String(p))),
        }),
      ),
    };
  }
  return { ok: true, value: parsed.data, classification };
}

type Gr1B2bInvoice = Gstr1Return["b2b"][number]["invoices"][number];
type Gr1B2clInvoice = Gstr1Return["b2cl"][number]["invoices"][number];
type Gr1CdnrNote = Gstr1Return["cdnr"][number]["notes"][number];
type Gr1ExpInvoice = Gstr1Return["exp"][number]["invoices"][number];
