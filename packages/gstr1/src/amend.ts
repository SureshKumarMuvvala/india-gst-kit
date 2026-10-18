// Source: Tables 9A / 9C — FORM GSTR-1 Table 9 ("Details of original document" + "Revised details of document"),
//         Instruction 13 (sources/gstr1/form-gstr1-excerpt-18052021.txt); Notification 26/2022-CT Ins. 9, 11
//         (sources/gstr1/notification-26-2022-ct-gstr1-excerpt.txt: 9A amends 4A, 4B, 5, 6A, 6B, 6C; 9C amends 9B);
//         shapes S5 `b2ba`, `b2cla`, `expa`, `cdnra`, `cdnura`; C `b2ba.csv`, `b2cla.csv` ("Original Place Of Supply"),
//         `cdnra.csv`. Owner decisions D-A2 (section follows the original, classified under its own period; a change
//         of kind, section, recipient or B2CL place of supply is refused) and D-A3 (window 07-2017 … period − 1; no
//         statutory time limit checked). Spec §17.3.
// Retrieved: 2026-10-18
// Status: UNVERIFIED — needs CA
import type { Gstin, GstDocument } from "@india-gst-kit/model";
import { classifyDocument, type OriginalRef, type Placement } from "./classify.js";
import { exportItemsOf, itemsOf } from "./items.js";
import type { AmendmentOriginal, Gstr1Return, Item } from "./return-schema.js";
import {
  issue,
  periodKey,
  ReturnPeriodSchema,
  type AmendmentSection,
  type Gstr1Issue,
  type ReturnPeriod,
} from "./types.js";

/** A 9A/9C amendment: the full revised document plus the original as it was reported earlier (spec §17.2). */
export interface DocumentAmendment {
  original: { document: GstDocument; period: ReturnPeriod };
  revised: GstDocument;
}

export const FIRST_PERIOD = "072017";

/** AMENDMENT_PERIOD: `072017 ≤ original < period` (the year is compared first). */
export function amendmentPeriodIssue(
  original: string,
  period: ReturnPeriod,
  path: (string | number)[],
  documentNumber?: string,
): Gstr1Issue | undefined {
  const where = { path, ...(documentNumber === undefined ? {} : { documentNumber }) };
  if (!ReturnPeriodSchema.safeParse(original).success) {
    return issue("SCHEMA", `original period "${original}" is not a return period (MMYYYY)`, where);
  }
  const k = periodKey(original);
  if (k < periodKey(FIRST_PERIOD) || k >= periodKey(period)) {
    return issue(
      "AMENDMENT_PERIOD",
      `original period ${original} is not between ${FIRST_PERIOD} and the period before ${period}`,
      where,
    );
  }
  return undefined;
}

const SECTION_OF: Record<Placement["section"], AmendmentSection | undefined> = {
  b2b: "b2ba",
  b2cl: "b2cla",
  exp: "expa",
  cdnr: "cdnra",
  cdnur: "cdnura",
  b2cs: undefined,
};

type Sections = {
  [K in "b2ba" | "b2cla" | "expa" | "cdnra" | "cdnura"]: NonNullable<Gstr1Return[K]>;
};

const isNote = (d: GstDocument) => d.kind === "CREDIT_NOTE" || d.kind === "DEBIT_NOTE";

function itemsFor(doc: GstDocument, p: Placement): Item[] {
  switch (p.section) {
    case "exp":
      return exportItemsOf(doc);
    case "b2b":
    case "cdnr":
      return itemsOf(doc, false);
    default:
      return itemsOf(doc, true);
  }
}

function snapshot(doc: GstDocument, period: ReturnPeriod, p: Placement): AmendmentOriginal {
  const o: AmendmentOriginal = {
    number: doc.number,
    date: doc.date,
    period,
    items: itemsFor(doc, p),
  };
  switch (p.section) {
    case "b2b":
    case "cdnr":
      o.pos = doc.placeOfSupply;
      o.reverseCharge = doc.reverseCharge;
      o.invoiceType = p.invoiceType;
      break;
    case "b2cl":
      o.pos = doc.placeOfSupply;
      break;
    case "cdnur":
      o.type = p.type;
      if (p.type === "B2CL") o.pos = doc.placeOfSupply;
      break;
    case "exp":
      o.exportType = p.exportType;
      break;
    case "b2cs":
      break;
  }
  if (isNote(doc)) o.noteType = doc.kind === "CREDIT_NOTE" ? "C" : "D";
  return o;
}

function group<V>(map: Map<string, V[]>, key: string, v: V): void {
  const g = map.get(key);
  if (g === undefined) map.set(key, [v]);
  else g.push(v);
}

/**
 * Places each amendment into `b2ba` / `b2cla` / `expa` / `cdnra` / `cdnura` (spec §17.3). The original is
 * classified under its own period; the revised document under the current period's checks with the original's
 * B2CL limit. Never throws; issues are collected.
 */
export function buildAmendments(args: {
  filer: Gstin;
  period: ReturnPeriod;
  documents: readonly GstDocument[];
  amendments: readonly DocumentAmendment[];
  findOriginal: (doc: GstDocument) => OriginalRef | undefined;
}): { sections: Sections; issues: Gstr1Issue[] } {
  const { filer, period, documents, amendments, findOriginal } = args;
  const issues: Gstr1Issue[] = [];
  const seenOriginal = new Set<string>();
  const seenRevised = { invoice: new Set<string>(), note: new Set<string>() };
  const b2ba = new Map<string, Sections["b2ba"][number]["invoices"]>();
  const b2cla = new Map<string, Sections["b2cla"][number]["invoices"]>();
  const expa = new Map<string, Sections["expa"][number]["invoices"]>();
  const cdnra = new Map<string, Sections["cdnra"][number]["notes"]>();
  const cdnura: Sections["cdnura"] = [];

  amendments.forEach((a, i) => {
    const path = ["amendments", i];
    const orig = a.original.document;
    const rev = a.revised;
    const at = (code: Parameters<typeof issue>[0], message: string, sub: string[] = []) =>
      issues.push(issue(code, message, { documentNumber: rev.number, path: [...path, ...sub] }));
    const before = issues.length;

    const pi = amendmentPeriodIssue(
      a.original.period,
      period,
      [...path, "original", "period"],
      rev.number,
    );
    if (pi !== undefined) issues.push(pi);
    if (rev.kind !== orig.kind) {
      at("AMENDMENT_KIND_MISMATCH", `revised ${rev.kind} amends a ${orig.kind}`, [
        "revised",
        "kind",
      ]);
    }
    if (
      documents.some(
        (d) => d.kind === orig.kind && d.number === orig.number && d.date === orig.date,
      )
    ) {
      at(
        "AMENDMENT_ORIGINAL_IN_PERIOD",
        `original ${orig.number} is also a document of this period; amend only earlier periods' documents`,
        ["original", "document"],
      );
    }
    const okey = `${orig.kind}|${orig.number}|${orig.date}`;
    if (seenOriginal.has(okey)) {
      at("DUPLICATE_AMENDMENT", `original ${orig.number} is amended more than once`, ["original"]);
    }
    seenOriginal.add(okey);
    const bucket = isNote(rev) ? seenRevised.note : seenRevised.invoice;
    if (bucket.has(rev.number)) {
      at("DUPLICATE_AMENDMENT", `revised number ${rev.number} is used by more than one amendment`, [
        "revised",
        "number",
      ]);
    }
    bucket.add(rev.number);
    if (issues.length > before) return;

    const co = classifyDocument(orig, {
      period: a.original.period,
      filer,
      original: findOriginal(orig),
    });
    if (!co.ok) {
      issues.push(
        ...co.issues.map((x) => ({ ...x, path: [...path, "original", ...(x.path ?? [])] })),
      );
      return;
    }
    const cr = classifyDocument(rev, {
      period,
      filer,
      original: findOriginal(rev),
      sectionPeriod: a.original.period,
    });
    if (!cr.ok) {
      issues.push(
        ...cr.issues.map((x) => ({ ...x, path: [...path, "revised", ...(x.path ?? [])] })),
      );
      return;
    }
    const target = SECTION_OF[co.section];
    if (target === undefined) {
      at(
        "AMENDMENT_USE_TABLE_10",
        `original ${orig.number} was a B2CS supply; amend its Table 7 row through Table 10 (b2csAmendments)`,
        ["original"],
      );
      return;
    }
    if (
      cr.section !== co.section ||
      (cr.section === "cdnur" && co.section === "cdnur" && cr.type !== co.type)
    ) {
      at(
        "AMENDMENT_SECTION_CHANGE",
        `the revised document would be ${cr.section}, the original was ${co.section}`,
        ["revised"],
      );
      return;
    }
    if (
      (cr.section === "b2b" || cr.section === "cdnr") &&
      (co.section === "b2b" || co.section === "cdnr")
    ) {
      if (cr.ctin !== co.ctin) {
        at(
          "AMENDMENT_RECIPIENT_CHANGE",
          `recipient ${cr.ctin} differs from the original's ${co.ctin}`,
          ["revised", "recipient", "gstin"],
        );
        return;
      }
    }
    if (cr.section === "b2cl" && rev.placeOfSupply !== orig.placeOfSupply) {
      at(
        "AMENDMENT_POS_CHANGE",
        `a B2CL amendment keeps the original place of supply ${orig.placeOfSupply}`,
        ["revised", "placeOfSupply"],
      );
      return;
    }

    const original = snapshot(orig, a.original.period, co);
    const head = { number: rev.number, date: rev.date, value: rev.totals.grandTotal, original };
    const noteType = rev.kind === "CREDIT_NOTE" ? "C" : "D";
    switch (cr.section) {
      case "b2b":
        group(b2ba, cr.ctin, {
          ...head,
          pos: rev.placeOfSupply,
          reverseCharge: rev.reverseCharge,
          invoiceType: cr.invoiceType,
          items: itemsOf(rev, false),
        });
        break;
      case "b2cl":
        group(b2cla, orig.placeOfSupply, { ...head, items: itemsOf(rev, true) });
        break;
      case "exp":
        group(expa, cr.exportType, { ...head, items: exportItemsOf(rev) });
        break;
      case "cdnr":
        group(cdnra, cr.ctin, {
          ...head,
          noteType,
          pos: rev.placeOfSupply,
          reverseCharge: rev.reverseCharge,
          invoiceType: cr.invoiceType,
          items: itemsOf(rev, false),
        });
        break;
      case "cdnur":
        cdnura.push({
          ...head,
          noteType,
          type: cr.type,
          ...(cr.type === "B2CL" ? { pos: rev.placeOfSupply } : {}),
          items: itemsOf(rev, true),
        });
        break;
      case "b2cs":
        break;
    }
  });

  return {
    sections: {
      b2ba: [...b2ba].map(([ctin, invoices]) => ({ ctin, invoices })),
      b2cla: [...b2cla].map(([pos, invoices]) => ({ pos, invoices })),
      expa: [...expa].map(([exportType, invoices]) => ({
        exportType: exportType as "WPAY" | "WOPAY",
        invoices,
      })),
      cdnra: [...cdnra].map(([ctin, notes]) => ({ ctin, notes })),
      cdnura,
    },
    issues,
  };
}
