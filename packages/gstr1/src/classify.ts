// Source: Classification rules from the GST Offline Tool 3.2.4 (sources/gstr1/offline-tool/code-excerpts.md §3, §4),
//         Excel template V2.2 help (sources/gstr1/excel-template-v2.2-help-excerpt.txt, rows 18, 48, 70, 89, 119, 143–144),
//         shapes and enums from S5 (sources/gstr1/gstr1-save-v5.0-schema.json). Owner decisions DEC-1…DEC-5 (spec §13).
//   - B2CL: unregistered, inter-state, invoice value strictly greater than ₹2,50,000 up to return period 07-2024 and
//     ₹1,00,000 from 08-2024; the return period decides, not the invoice date (DEC-3, top CA question CA-1).
//   - B2CS: unregistered intra-state of any value, or inter-state up to the limit; credit/debit notes whose original is
//     B2CS are netted into the B2CS row (DEC-2).
//   - Invoice types R / DE / SEWP / SEWOP (CBW never emitted); SEZ supplies and exports carry IGST.
//   - CDNUR types B2CL / EXPWP / EXPWOP; notes follow the original invoice's section.
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
import type { DocumentKind, Gstin, GstDocument } from "@india-gst-kit/model";
import { D } from "./decimal.js";
import { GSTR1_RATES } from "./rates.js";
import { POS_FOREIGN_PATTERN, POS_PATTERN, isS5Ctin } from "./recipient.js";
import { issue, periodKey, type Gstr1Issue, type ReturnPeriod } from "./types.js";
import type { InvoiceType } from "./return-schema.js";

const FIRST_DATE = "2017-07-01";
const RATE_SET: ReadonlySet<string> = new Set(GSTR1_RATES);

/** ₹2,50,000 before return period 08-2024, ₹1,00,000 from then on (the year is compared before the month). */
export function b2clThreshold(fp: ReturnPeriod): string {
  if (!/^(0[1-9]|1[012])(19|20)\d\d$/.test(fp)) {
    throw new RangeError(`b2clThreshold(): not a return period (MMYYYY): ${fp}`);
  }
  return periodKey(fp) < periodKey("082024") ? "250000.00" : "100000.00";
}

/** Last calendar day of a return period as an ISO date. */
export function periodEnd(fp: ReturnPeriod): string {
  const month = Number(fp.slice(0, 2));
  const year = Number(fp.slice(2));
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${fp.slice(2)}-${fp.slice(0, 2)}-${String(day).padStart(2, "0")}`;
}

export interface OriginalRef {
  document: GstDocument;
  period: ReturnPeriod;
}

export interface ClassifyContext {
  period: ReturnPeriod;
  /** The filer: `supplier.gstin` of every document. */
  filer: Gstin;
  /** For notes: the original invoice and the period it was reported in (§3.3). */
  original?: OriginalRef | undefined;
  /**
   * For a revised (amended) invoice: the period whose B2CL limit decides its section — the original's period
   * (spec §17.3, DEC-3). Defaults to `period`.
   */
  sectionPeriod?: ReturnPeriod | undefined;
}

export type Placement =
  | { section: "b2b"; invoiceType: InvoiceType; ctin: string }
  | { section: "cdnr"; invoiceType: InvoiceType; ctin: string }
  | { section: "b2cl" }
  | { section: "b2cs"; supplyType: "INTRA" | "INTER" }
  | { section: "cdnur"; type: "B2CL" | "EXPWP" | "EXPWOP" }
  | { section: "exp"; exportType: "WPAY" | "WOPAY" };

export type Classification =
  | ({ ok: true; kind: DocumentKind; number: string } & Placement)
  | { ok: false; issues: Gstr1Issue[] };

const INVOICE_TYPES: Record<string, InvoiceType | undefined> = {
  DOMESTIC: "R",
  DEEMED_EXPORT: "DE",
  SEZ_WITH_PAYMENT: "SEWP",
  SEZ_WITHOUT_PAYMENT: "SEWOP",
};

const isExport = (doc: GstDocument) =>
  doc.supplyCategory === "EXPORT_WITH_PAYMENT" || doc.supplyCategory === "EXPORT_WITHOUT_PAYMENT";

const isNote = (doc: GstDocument) => doc.kind === "CREDIT_NOTE" || doc.kind === "DEBIT_NOTE";

/** What an unregistered DOMESTIC invoice is in `period`: B2CL or B2CS (I3/I4). */
function b2cSection(doc: GstDocument, period: ReturnPeriod): "b2cl" | "b2cs" {
  const interState = doc.placeOfSupply !== doc.supplier.stateCode;
  return interState && new D(doc.totals.grandTotal).gt(b2clThreshold(period)) ? "b2cl" : "b2cs";
}

/** Pure: the per-document rules of §3. The caller does the cross-document checks (supplier GSTIN format, duplicates). */
export function classifyDocument(doc: GstDocument, ctx: ClassifyContext): Classification {
  const issues: Gstr1Issue[] = [];
  const at = (code: Parameters<typeof issue>[0], message: string, path?: (string | number)[]) => {
    issues.push(
      issue(code, message, { documentNumber: doc.number, ...(path === undefined ? {} : { path }) }),
    );
  };

  if (doc.supplier.gstin !== ctx.filer) {
    at("SUPPLIER_MISMATCH", `supplier GSTIN ${doc.supplier.gstin} is not the filer's`, [
      "supplier",
      "gstin",
    ]);
  }
  const reg = doc.supplier.registrationType;
  if (reg === "COMPOSITION" || reg === "SEZ_UNIT" || reg === "SEZ_DEVELOPER") {
    at("UNSUPPORTED_SUPPLIER", `${reg} suppliers are not supported in GSTR-1 v0.1`, [
      "supplier",
      "registrationType",
    ]);
  }
  if (doc.kind === "BILL_OF_SUPPLY") {
    at(
      "UNSUPPORTED_DOCUMENT",
      "bills of supply belong in nil-rated supplies (Table 8), which is deferred",
      ["kind"],
    );
  }
  if (doc.date < FIRST_DATE || doc.date > periodEnd(ctx.period)) {
    at(
      "DATE_OUT_OF_RANGE",
      `date ${doc.date} is outside ${FIRST_DATE} … ${periodEnd(ctx.period)}`,
      ["date"],
    );
  }
  doc.lines.forEach((line, i) => {
    if (!RATE_SET.has(new D(line.gstRate).toFixed())) {
      at("RATE_NOT_ACCEPTED", `rate ${line.gstRate} is not in the GSTR-1 rate list`, [
        "lines",
        i,
        "gstRate",
      ]);
    }
  });
  if (doc.kind === "BILL_OF_SUPPLY") return { ok: false, issues };

  const gstin = doc.recipient.gstin;
  const pos = doc.placeOfSupply;
  const checkPos = (pattern: RegExp, path: (string | number)[] = ["placeOfSupply"]) => {
    if (!pattern.test(pos))
      at("POS_NOT_ACCEPTED", `place of supply ${pos} is not accepted in this section`, path);
  };
  const noRchrg = (section: string) => {
    if (doc.reverseCharge) {
      at("REVERSE_CHARGE_B2C", `reverse charge is not available in ${section}`, ["reverseCharge"]);
    }
  };
  const ctin = (): string => {
    if (gstin !== undefined && !isS5Ctin(gstin)) {
      at("RECIPIENT_GSTIN_FORMAT", `recipient GSTIN ${gstin} does not match the portal's pattern`, [
        "recipient",
        "gstin",
      ]);
    }
    return gstin ?? "";
  };

  let placement: Placement | undefined;
  const base = { kind: doc.kind, number: doc.number };

  if (!isNote(doc)) {
    if (isExport(doc)) {
      // I1
      noRchrg("exports");
      placement = {
        section: "exp",
        exportType: doc.supplyCategory === "EXPORT_WITH_PAYMENT" ? "WPAY" : "WOPAY",
      };
    } else if (gstin !== undefined) {
      // I2
      checkPos(POS_FOREIGN_PATTERN);
      placement = {
        section: "b2b",
        invoiceType: INVOICE_TYPES[doc.supplyCategory] ?? "R",
        ctin: ctin(),
      };
    } else if (doc.supplyCategory !== "DOMESTIC") {
      // I5
      at("CATEGORY_NEEDS_GSTIN", `${doc.supplyCategory} supplies need a recipient GSTIN`, [
        "recipient",
        "gstin",
      ]);
    } else if (pos === "96") {
      // I6
      at(
        "POS_96_NOT_EXPORT",
        "place of supply 96 on a domestic supply to an unregistered person has no section",
        ["placeOfSupply"],
      );
    } else {
      // I3 / I4
      noRchrg("B2CL and B2CS");
      checkPos(POS_PATTERN);
      const section = b2cSection(doc, ctx.sectionPeriod ?? ctx.period);
      placement =
        section === "b2cl"
          ? { section: "b2cl" }
          : { section: "b2cs", supplyType: pos === doc.supplier.stateCode ? "INTRA" : "INTER" };
    }
  } else {
    const orig = ctx.original;
    if (orig !== undefined && !isExport(doc) && orig.document.placeOfSupply !== pos) {
      at(
        "NOTE_POS_MISMATCH",
        `place of supply ${pos} differs from the original's ${orig.document.placeOfSupply}`,
        ["placeOfSupply"],
      );
    }
    if (isExport(doc)) {
      // N1
      noRchrg("export notes");
      placement = {
        section: "cdnur",
        type: doc.supplyCategory === "EXPORT_WITH_PAYMENT" ? "EXPWP" : "EXPWOP",
      };
    } else if (gstin !== undefined) {
      // N2
      checkPos(POS_FOREIGN_PATTERN);
      placement = {
        section: "cdnr",
        invoiceType: INVOICE_TYPES[doc.supplyCategory] ?? "R",
        ctin: ctin(),
      };
    } else if (doc.supplyCategory !== "DOMESTIC") {
      at("CATEGORY_NEEDS_GSTIN", `${doc.supplyCategory} supplies need a recipient GSTIN`, [
        "recipient",
        "gstin",
      ]);
    } else if (orig === undefined) {
      // N5
      at(
        "ORIGINAL_NOT_FOUND",
        `original invoice ${doc.originalDocument?.number ?? "?"} not found; cannot decide between CDNUR and B2CS`,
        ["originalDocument"],
      );
    } else if (
      orig.document.kind !== "TAX_INVOICE" ||
      orig.document.recipient.gstin !== undefined ||
      orig.document.supplyCategory !== "DOMESTIC"
    ) {
      at(
        "ORIGINAL_NOT_FOUND",
        `original ${orig.document.number} is not an unregistered domestic invoice; cannot decide between CDNUR and B2CS`,
        ["originalDocument"],
      );
    } else {
      noRchrg("CDNUR and B2CS");
      if (pos === "96") {
        at(
          "POS_96_NOT_EXPORT",
          "place of supply 96 on a domestic supply to an unregistered person has no section",
          ["placeOfSupply"],
        );
      } else {
        checkPos(POS_PATTERN);
        placement =
          b2cSection(orig.document, orig.period) === "b2cl"
            ? { section: "cdnur", type: "B2CL" } // N3
            : { section: "b2cs", supplyType: pos === doc.supplier.stateCode ? "INTRA" : "INTER" }; // N4
      }
    }
  }

  if (issues.length > 0 || placement === undefined) return { ok: false, issues };
  return { ok: true, ...base, ...placement };
}
