import type { GstDocument } from "@india-gst-kit/model";
import { D, type Dec } from "./decimal.js";
import { normaliseDocNumber, looseDocNumber } from "./normalise.js";
import type {
  AmountField,
  Difference,
  Pair,
  PossibleReason,
  ReconResult,
  RegisterRef,
} from "./result.js";
import { AMOUNT_FIELDS } from "./result.js";
import type { Gstr2b, Gstr2bRecord } from "./schema.js";
import { issue, type ReconIssue } from "./types.js";

export type ReconOptions = {
  /** Absolute, per field, inclusive; default `"0.00"` (exact). */
  amountTolerance?: string;
};

type DocType = Gstr2bRecord["documentType"];
const DOC_TYPE: Record<string, DocType | undefined> = {
  TAX_INVOICE: "INVOICE",
  CREDIT_NOTE: "CREDIT_NOTE",
  DEBIT_NOTE: "DEBIT_NOTE",
};

type Reg = {
  ref: RegisterRef;
  doc: GstDocument;
  type: DocType;
  number: string;
  key: string;
};
type Rec = { record: Gstr2bRecord; number: string; key: string; order: number };

const keyOf = (gstin: string, type: DocType, normNumber: string, date: string): string =>
  [gstin.toUpperCase(), type, normNumber, date].join("|");

function registerAmount(doc: GstDocument, f: AmountField): string {
  switch (f) {
    case "value":
      return doc.totals.grandTotal;
    case "taxableValue":
      return doc.totals.taxableValue;
    default:
      return doc.totals[f];
  }
}

/** Amounts beyond `tol`, then `pos`/`rev` (when 2B carries them). */
function compare(
  reg: Reg,
  rec: Gstr2bRecord,
  tol: Dec,
  only?: readonly AmountField[],
): Difference[] {
  const out: Difference[] = [];
  for (const f of only ?? AMOUNT_FIELDS) {
    const ours = registerAmount(reg.doc, f);
    const theirs = rec.amounts[f];
    const diff = new D(theirs).minus(ours);
    if (diff.abs().gt(tol)) {
      out.push({ field: f, register: ours, gstr2b: theirs, difference: diff.toFixed(2) });
    }
  }
  if (only !== undefined) return out;
  if (rec.placeOfSupply !== undefined && rec.placeOfSupply !== reg.doc.placeOfSupply) {
    out.push({
      field: "placeOfSupply",
      register: reg.doc.placeOfSupply,
      gstr2b: rec.placeOfSupply,
    });
  }
  const rev = reg.doc.reverseCharge ? "Y" : "N";
  if (rec.reverseCharge !== undefined && rec.reverseCharge !== rev) {
    out.push({ field: "reverseCharge", register: rev, gstr2b: rec.reverseCharge });
  }
  return out;
}

function isParsedFile(f: unknown): f is Gstr2b {
  return (
    typeof f === "object" &&
    f !== null &&
    "records" in f &&
    Array.isArray(f.records) &&
    "gstin" in f &&
    typeof f.gstin === "string"
  );
}

function toRef(index: number, doc: GstDocument): RegisterRef {
  return {
    index,
    supplierGstin: doc.supplier.gstin,
    kind: doc.kind,
    number: doc.number,
    date: doc.date,
  };
}

function emptyResult(tol: string, issues: ReconIssue[]): ReconResult {
  return {
    matched: [],
    matchedWithDifferences: [],
    possibleMatches: [],
    in2bOnly: [],
    inRegisterOnly: [],
    excluded: [],
    issues,
    options: { amountTolerance: tol },
  };
}

/**
 * Compares a purchase register (already validated `GstDocument`s, we are the recipient) with one or more
 * parsed GSTR-2B files and puts every document and every record in exactly one bucket (spec §6).
 * It reports what 2B says next to what the register says; it never decides ITC eligibility.
 * @throws TypeError if `register` is not an array or `gstr2b` is not a parsed file or an array of them.
 * @throws RangeError if `options.amountTolerance` is not a non-negative decimal string.
 */
export function reconcile(
  register: GstDocument[],
  gstr2b: Gstr2b | Gstr2b[],
  options: ReconOptions = {},
): ReconResult {
  if (!Array.isArray(register)) throw new TypeError("reconcile(): register must be an array");
  const given: readonly unknown[] = Array.isArray(gstr2b) ? gstr2b : [gstr2b];
  if (!given.every(isParsedFile)) {
    throw new TypeError("reconcile(): gstr2b must be a parsed Gstr2b or an array of them");
  }
  const files: readonly Gstr2b[] = given;
  const toleranceText = options.amountTolerance ?? "0.00";
  if (!/^\d+(\.\d+)?$/.test(toleranceText)) {
    throw new RangeError("reconcile(): amountTolerance must be a non-negative decimal string");
  }
  const tol = new D(toleranceText);

  const ours = files[0]?.gstin.toUpperCase();
  if (files.some((f) => f.gstin.toUpperCase() !== ours)) {
    return emptyResult(toleranceText, [
      issue(
        [],
        "RECIPIENT_MISMATCH",
        "the 2B files carry different recipient GSTINs; nothing was reconciled",
      ),
    ]);
  }

  const result = emptyResult(toleranceText, []);
  const issues = result.issues;

  // ----- register side: filter, then key -----
  const regs: Reg[] = [];
  register.forEach((doc, index) => {
    const ref = toRef(index, doc);
    if (ours !== undefined && doc.recipient.gstin?.toUpperCase() !== ours) {
      result.excluded.push({ register: ref, reason: "NOT_OUR_PURCHASE" });
      return;
    }
    const type = DOC_TYPE[doc.kind];
    if (type === undefined) {
      result.excluded.push({ register: ref, reason: "KIND_NOT_IN_2B_SECTIONS" });
      return;
    }
    const number = normaliseDocNumber(doc.number);
    regs.push({ ref, doc, type, number, key: keyOf(doc.supplier.gstin, type, number, doc.date) });
  });

  // ----- 2B side: concatenate in file order -----
  const recs: Rec[] = [];
  for (const f of files) {
    for (const record of f.records) {
      const number = normaliseDocNumber(record.number);
      recs.push({
        record,
        number,
        key: keyOf(record.supplier.gstin, record.documentType, number, record.date),
        order: recs.length,
      });
    }
  }

  // ----- pass 1: exact key, one-to-one in order -----
  const byKey = new Map<string, Rec[]>();
  for (const r of recs) {
    const list = byKey.get(r.key);
    if (list === undefined) byKey.set(r.key, [r]);
    else list.push(r);
  }
  const taken = new Set<number>();
  const pairedReg = new Set<number>();
  const seenReg = new Map<string, number>();
  const used = new Map<string, number>();
  for (const reg of regs) {
    if (seenReg.has(reg.key)) {
      issues.push(
        issue(
          ["register", reg.ref.index],
          "DUPLICATE_IN_REGISTER",
          `a document with the same key is already in the register (index ${seenReg.get(reg.key)})`,
          "warning",
        ),
      );
    } else {
      seenReg.set(reg.key, reg.ref.index);
    }
    const n = used.get(reg.key) ?? 0;
    const rec = byKey.get(reg.key)?.[n];
    if (rec === undefined) continue;
    used.set(reg.key, n + 1);
    taken.add(rec.order);
    pairedReg.add(reg.ref.index);
    const differences = compare(reg, rec.record, tol);
    const pair: Pair = { register: reg.ref, gstr2b: rec.record, differences };
    (differences.length === 0 ? result.matched : result.matchedWithDifferences).push(pair);
  }
  for (const list of byKey.values()) {
    list.slice(1).forEach((r) => {
      issues.push(
        issue(
          r.record.path,
          "DUPLICATE_IN_2B",
          "a record with the same key is already in 2B",
          "warning",
        ),
      );
    });
  }

  // ----- pass 2: possible matches among the leftovers -----
  const leftRegs = regs.filter((r) => !pairedReg.has(r.ref.index));
  const leftRecs = recs.filter((r) => !taken.has(r.order));
  const recsBySupplier = new Map<string, Rec[]>();
  for (const r of leftRecs) {
    const k = r.record.supplier.gstin.toUpperCase();
    const list = recsBySupplier.get(k);
    if (list === undefined) recsBySupplier.set(k, [r]);
    else list.push(r);
  }

  const reasonsFor = (reg: Reg, rec: Rec): PossibleReason[] => {
    const r = rec.record;
    const out: PossibleReason[] = [];
    const sameType = r.documentType === reg.type;
    const sameNumber = rec.number === reg.number;
    const sameDate = r.date === reg.doc.date;
    if (
      r.original !== undefined &&
      normaliseDocNumber(r.original.number) === reg.number &&
      r.original.date === reg.doc.date
    ) {
      out.push("AMENDED_FROM");
    }
    if (sameType && sameNumber && !sameDate) out.push("DATE_DIFFERS");
    if (!sameType && sameNumber && sameDate) out.push("TYPE_DIFFERS");
    if (
      sameType &&
      !sameNumber &&
      r.date.slice(0, 7) === reg.doc.date.slice(0, 7) &&
      compare(reg, r, tol, ["value", "taxableValue"]).length === 0
    ) {
      out.push("NUMBER_DIFFERS");
    }
    if (sameType && !sameNumber && looseDocNumber(reg.doc.number) === looseDocNumber(r.number)) {
      out.push("NUMBER_LOOSE");
    }
    return out;
  };

  const candRegs = new Map<number, { rec: Rec; reasons: PossibleReason[] }[]>();
  const candRecs = new Map<number, Reg[]>();
  for (const reg of leftRegs) {
    for (const rec of recsBySupplier.get(reg.doc.supplier.gstin.toUpperCase()) ?? []) {
      const reasons = reasonsFor(reg, rec);
      if (reasons.length === 0) continue;
      const a = candRegs.get(reg.ref.index);
      if (a === undefined) candRegs.set(reg.ref.index, [{ rec, reasons }]);
      else a.push({ rec, reasons });
      const b = candRecs.get(rec.order);
      if (b === undefined) candRecs.set(rec.order, [reg]);
      else b.push(reg);
    }
  }

  const possibleRegs = new Set<number>();
  const possibleRecs = new Set<number>();
  for (const reg of leftRegs) {
    const mine = candRegs.get(reg.ref.index);
    const only = mine?.length === 1 ? mine[0] : undefined;
    if (only === undefined) continue;
    const { rec, reasons } = only;
    if (candRecs.get(rec.order)?.length !== 1) continue;
    possibleRegs.add(reg.ref.index);
    possibleRecs.add(rec.order);
    const differences = compare(reg, rec.record, tol);
    if (rec.number !== reg.number) {
      differences.push({ field: "number", register: reg.doc.number, gstr2b: rec.record.number });
    }
    if (rec.record.date !== reg.doc.date) {
      differences.push({ field: "date", register: reg.doc.date, gstr2b: rec.record.date });
    }
    if (rec.record.documentType !== reg.type) {
      differences.push({
        field: "documentType",
        register: reg.type,
        gstr2b: rec.record.documentType,
      });
    }
    result.possibleMatches.push({ register: reg.ref, gstr2b: rec.record, differences, reasons });
  }

  // ----- the rest -----
  for (const reg of leftRegs) {
    if (possibleRegs.has(reg.ref.index)) continue;
    result.inRegisterOnly.push({
      register: reg.ref,
      candidates: (candRegs.get(reg.ref.index) ?? []).map(({ rec }) => ({
        returnPeriod: rec.record.returnPeriod,
        path: rec.record.path,
      })),
    });
  }
  for (const rec of leftRecs) {
    if (possibleRecs.has(rec.order)) continue;
    result.in2bOnly.push({
      record: rec.record,
      candidates: (candRecs.get(rec.order) ?? []).map((r) => r.ref),
    });
  }
  return result;
}
