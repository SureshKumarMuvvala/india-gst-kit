// Source: https://einv-apisandbox.nic.in/version1.03/generate-irn.html — schema and Validations (source C):
//         sources/einvoice/generate-irn-json-schema.json, sources/einvoice/generate-irn-validations.txt
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
//
// GstDocument (@india-gst-kit/model) → IRN request, docs/specs/einvoice.md §3. Covers:
//   - SupTyp / Typ codes and the model → IRN mapping;
//   - exclusions M1 bill of supply, M2 B2C, M3 SEZ-unit supplier, M5 composition supplier (see below);
//   - M4 seller PIN required; M6 export to a GSTIN holder (decision D-Q2).
import type { GstDocument } from "@india-gst-kit/model";
import { D } from "./decimal.js";
import { IRN_SCHEMA_VERSION } from "./rules.js";
import type { IrnItem, IrnRequest } from "./schema.js";
import { issue, type IrnIssue } from "./types.js";
import { validateIrnRequest } from "./validate.js";

export type MapResult = { ok: true; value: IrnRequest } | { ok: false; issues: IrnIssue[] };

export interface MapOptions {
  /** Defaults to "1.1". Anything else fails rule V1. */
  version?: string;
}

const SUP_TYP = {
  DOMESTIC: "B2B",
  SEZ_WITH_PAYMENT: "SEZWP",
  SEZ_WITHOUT_PAYMENT: "SEZWOP",
  EXPORT_WITH_PAYMENT: "EXPWP",
  EXPORT_WITHOUT_PAYMENT: "EXPWOP",
  DEEMED_EXPORT: "DEXP",
} as const;

const DOC_TYP = { TAX_INVOICE: "INV", CREDIT_NOTE: "CRN", DEBIT_NOTE: "DBN" } as const;

const isExport = (doc: GstDocument): boolean =>
  doc.supplyCategory === "EXPORT_WITH_PAYMENT" || doc.supplyCategory === "EXPORT_WITHOUT_PAYMENT";

/** `2026-04-20` → `20/04/2026`. */
export function toIrnDate(iso: string): string {
  const [y = "", m = "", d = ""] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const opt = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };

function preconditions(doc: GstDocument): IrnIssue[] {
  const out: IrnIssue[] = [];
  const no = (path: (string | number)[], rule: string, message: string) =>
    out.push(issue(path, "NOT_EINVOICEABLE", rule, message));
  if (doc.kind === "BILL_OF_SUPPLY")
    no(
      ["kind"],
      "M1",
      "A bill of supply cannot be reported as an e-invoice (document types are INV, CRN, DBN)",
    );
  if (doc.recipient.gstin === undefined && !isExport(doc)) {
    no(
      ["recipient", "gstin"],
      "M2",
      "B2C invoices (recipient without GSTIN) should not request an IRN",
    );
  }
  if (doc.supplier.registrationType === "SEZ_UNIT") {
    no(["supplier", "registrationType"], "M3", "An SEZ unit supplier cannot generate an e-invoice");
  }
  if (doc.supplier.address.pincode === undefined)
    no(["supplier", "address", "pincode"], "M4", "The supplier PIN code is required");
  if (doc.supplier.registrationType === "COMPOSITION") {
    no(
      ["supplier", "registrationType"],
      "M5",
      "A composition supplier issues no tax invoice; a composition credit/debit note has no basis in the e-invoice rules (flagged for CA)",
    );
  }
  if (doc.recipient.gstin !== undefined && isExport(doc)) {
    no(
      ["recipient", "gstin"],
      "M6",
      "A direct export to a recipient with a GSTIN is rejected (decision D-Q2: the buyer of an export is URP)",
    );
  }
  return out;
}

function mapItem(line: GstDocument["lines"][number]): IrnItem {
  const quantity = line.quantity;
  return {
    SlNo: String(line.lineNo),
    PrdDesc: line.description,
    IsServc: line.isService ? "Y" : "N",
    HsnCd: line.hsnSac,
    ...opt("Qty", quantity),
    ...opt("Unit", quantity === undefined ? undefined : line.unit),
    // The schema requires UnitPrice; a line without a quantity uses TotAmt (decision D-Q1).
    UnitPrice: quantity === undefined ? line.grossAmount : (line.unitPrice ?? line.grossAmount),
    TotAmt: line.grossAmount,
    Discount: line.discount,
    AssAmt: line.taxableValue,
    GstRt: line.gstRate,
    IgstAmt: line.igst,
    CgstAmt: line.cgst,
    SgstAmt: line.sgst, // SGST or UTGST (model §6.5)
    CesRt: line.cessRate ?? "0",
    // The model's cess = ad valorem + non-advol (model §8.4).
    CesAmt: new D(line.cess).minus(line.cessNonAdvol).toFixed(2),
    CesNonAdvlAmt: line.cessNonAdvol,
    StateCesRt: "0",
    StateCesAmt: "0.00",
    StateCesNonAdvlAmt: "0.00",
    OthChrg: "0.00",
    TotItemVal: line.lineTotal,
  };
}

function build(doc: GstDocument, version: string): IrnRequest {
  const exp = isExport(doc);
  const s = doc.supplier;
  const r = doc.recipient;
  const prec =
    doc.originalDocument === undefined
      ? undefined
      : [{ InvNo: doc.originalDocument.number, InvDt: toIrnDate(doc.originalDocument.date) }];
  const ref = { ...opt("InvRm", doc.notes), ...opt("PrecDocDtls", prec) };
  return {
    Version: version,
    TranDtls: {
      TaxSch: "GST",
      SupTyp: SUP_TYP[doc.supplyCategory],
      RegRev: doc.reverseCharge ? "Y" : "N",
      IgstOnIntra: "N", // the model has no IGST-on-intra concept (deferred)
    },
    DocDtls: {
      Typ: DOC_TYP[doc.kind as keyof typeof DOC_TYP],
      No: doc.number,
      Dt: toIrnDate(doc.date),
    },
    SellerDtls: {
      Gstin: s.gstin,
      LglNm: s.legalName,
      ...opt("TrdNm", s.tradeName),
      Addr1: s.address.line1,
      ...opt("Addr2", s.address.line2),
      Loc: s.address.city,
      Pin: s.address.pincode ?? "",
      Stcd: s.address.stateCode,
    },
    BuyerDtls: {
      Gstin: exp ? "URP" : (r.gstin ?? ""),
      LglNm: r.legalName,
      ...opt("TrdNm", r.tradeName),
      Pos: exp ? "96" : doc.placeOfSupply,
      Addr1: r.address.line1,
      ...opt("Addr2", r.address.line2),
      Loc: r.address.city,
      ...opt("Pin", exp ? "999999" : r.address.pincode),
      Stcd: exp ? "96" : r.address.stateCode,
    },
    ItemList: doc.lines.map(mapItem),
    ValDtls: {
      AssVal: doc.totals.taxableValue,
      CgstVal: doc.totals.cgst,
      SgstVal: doc.totals.sgst,
      IgstVal: doc.totals.igst,
      CesVal: doc.totals.cess,
      StCesVal: "0.00",
      // Invoice-level discount: the model has none (it is apportioned into the lines). Never map
      // totals.lineDiscount here — the line discount would be subtracted twice.
      Discount: "0.00",
      OthChrg: doc.totals.otherCharges,
      RndOffAmt: doc.totals.roundOff,
      TotInvVal: doc.totals.grandTotal,
    },
    ...(Object.keys(ref).length > 0 ? { RefDtls: ref } : {}),
  };
}

/**
 * Maps a parsed GstDocument to an IRN request. Never throws on data problems; the output is run through
 * {@link validateIrnRequest}, so `ok: true` means the payload passed validation.
 */
export function toIrnRequest(doc: GstDocument, options: MapOptions = {}): MapResult {
  const pre = preconditions(doc);
  if (pre.length > 0) return { ok: false, issues: pre };
  const result = validateIrnRequest(build(doc, options.version ?? IRN_SCHEMA_VERSION));
  if (!result.ok || result.value === undefined) return { ok: false, issues: result.issues };
  return { ok: true, value: result.value };
}
