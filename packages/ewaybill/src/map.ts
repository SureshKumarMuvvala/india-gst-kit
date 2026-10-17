// Source: https://einv-apisandbox.nic.in/Mapping_of_ewaybill_schema.html (source J) — the portal's own
//         IRN → e-way bill field mapping; sources/ewaybill/einvoice-to-ewaybill-mapping.csv.
//         https://docs.ewaybillgst.gov.in/apidocs/version1.03/generate-eway-bill.html (H) and
//         https://einv-apisandbox.nic.in/version1.03/ewaybill-generation-irn.html (I): sources/ewaybill/
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
//
// GstDocument (@india-gst-kit/model) + movement → Generate-EWB request, EWB-by-IRN request and the `EwbDtls`
// block of an IRN request; docs/specs/ewaybill.md §5 and §6. Mapping decisions D-M1 (rates), D-M2 (cess),
// D-M3 (exports need the port as ship-to), D-Q2 (leading-zero HSN), D-Q3 (never truncate), D-Q4 (state split).
import { decideTaxSplit, shipmentPattern, type GstDocument } from "@india-gst-kit/model";
import { MODE_CODE, VEHICLE_TYPE_CODE } from "./codes.js";
import { D } from "./decimal.js";
import { toEwbIssues } from "./json.js";
import { EwbMovementSchema, type EwbMovement, type EwbMovementInput } from "./movement.js";
import { ewbRoute } from "./route.js";
import type { EwbByIrnRequest, EwbDtls, EwbItem, EwbRequest } from "./schema.js";
import { ewbStateInt } from "./states.js";
import { issue, type EwbIssue } from "./types.js";
import { validateEwbByIrnRequest, validateEwbDtls, validateEwbRequest } from "./validate.js";

export type MapResult<T = EwbRequest> =
  { ok: true; value: T; issues: EwbIssue[] } | { ok: false; issues: EwbIssue[] };

export interface MapOptions {
  /** Whether the supplier is enabled for e-invoicing (portal data). Unknown ⇒ a warning. */
  supplierEInvoiceEnabled?: boolean;
}

const opt = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined || value === "" ? {} : { [key]: value }) as { [P in K]?: V };

/** `2026-04-20` → `20/04/2026`. */
export function toEwbDate(iso: string): string {
  const [y = "", m = "", d = ""] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const isExport = (doc: GstDocument): boolean =>
  doc.supplyCategory === "EXPORT_WITH_PAYMENT" || doc.supplyCategory === "EXPORT_WITHOUT_PAYMENT";
const isSez = (doc: GstDocument): boolean =>
  doc.supplyCategory === "SEZ_WITH_PAYMENT" || doc.supplyCategory === "SEZ_WITHOUT_PAYMENT";

function parseMovement(
  movement: unknown,
): { ok: true; value: EwbMovement } | { ok: false; issues: EwbIssue[] } {
  const r = EwbMovementSchema.safeParse(movement);
  if (r.success) return { ok: true, value: r.data };
  return {
    ok: false,
    issues: toEwbIssues(r.error.issues, movement, { prefix: ["movement"], rule: "S-MOVEMENT" }).map(
      (i) => ({ ...i, code: "BAD_MOVEMENT" as const }),
    ),
  };
}

function finish<T>(result: { ok: boolean; value?: T; issues: EwbIssue[] }): MapResult<T> {
  if (!result.ok || result.value === undefined) return { ok: false, issues: result.issues };
  return { ok: true, value: result.value, issues: result.issues };
}

// ---- Generate ------------------------------------------------------------------------------------
/** H "Bill To – Ship To" / "Bill From – Dispatch From" (validations lines 49–50); J lines 5, 11–24; K1. */
const TRANSACTION_TYPE = {
  REGULAR: "1",
  BILL_TO_SHIP_TO: "2",
  BILL_FROM_DISPATCH_FROM: "3",
  COMBINATION: "4",
} as const;

function preconditions(doc: GstDocument, mv: EwbMovement, ewbSplit: "INTRA" | "INTER"): EwbIssue[] {
  const out: EwbIssue[] = [];
  // Decision D-S11: on this route the addresses come from the document; never pick one silently.
  for (const key of ["dispatchFrom", "shipTo"] as const) {
    if (mv[key] !== undefined) {
      out.push(
        issue(
          ["movement", key],
          "ADDRESS_IN_MOVEMENT",
          "M-ADDRESS",
          `${key} belongs on the document for the Generate route; the movement's ${key} is only for EWB by IRN`,
        ),
      );
    }
  }
  if (out.length > 0) return out;
  // A document dispatchFrom / shipTo always has a PIN (model ShipAddressSchema).
  if (doc.dispatchFrom === undefined && doc.supplier.address.pincode === undefined) {
    out.push(
      issue(
        ["supplier", "address", "pincode"],
        "MISSING_PIN",
        "M-PIN",
        "the dispatch-from PIN code is required (fromPincode)",
      ),
    );
  }
  const exportWithoutPort = isExport(doc) && doc.shipTo === undefined;
  if (exportWithoutPort) {
    out.push(
      issue(
        ["shipTo"],
        "EXPORT_NEEDS_PORT_SHIP_TO",
        "M-EXPORT-SHIPTO",
        "an export needs shipTo = the address of the port in India (decision D-M3)",
      ),
    );
  } else if (doc.shipTo === undefined && doc.recipient.address.pincode === undefined) {
    out.push(
      issue(
        ["recipient", "address", "pincode"],
        "MISSING_PIN",
        "M-PIN",
        "the ship-to PIN code is required (toPincode)",
      ),
    );
  }
  const modelSplit = decideTaxSplit(doc.supplier.stateCode, doc.placeOfSupply, doc.supplyCategory);
  if (modelSplit !== ewbSplit) {
    out.push(
      issue(
        ["recipient", "stateCode"],
        "STATE_SPLIT_MISMATCH",
        "M-SPLIT",
        `the e-way bill state codes imply an ${ewbSplit.toLowerCase()}-state supply but the document's place of supply makes it ${modelSplit.toLowerCase()}-state (decision D-Q4; needs CA)`,
      ),
    );
  }
  doc.lines.forEach((l, i) => {
    if (l.hsnSac.startsWith("0")) {
      out.push(
        issue(
          ["lines", i, "hsnSac"],
          "HSN_LEADING_ZERO",
          "M-HSN",
          `HSN ${l.hsnSac} has a leading zero, which the JSON number hsnCode cannot carry (decision D-Q2)`,
        ),
      );
    }
  });
  return out;
}

function mapItem(
  line: GstDocument["lines"][number],
  bill: boolean,
  split: "INTRA" | "INTER",
): EwbItem {
  const half = new D(line.gstRate).div(2).toFixed();
  const [cgstRate, sgstRate, igstRate] = bill
    ? ["0", "0", "0"]
    : split === "INTRA"
      ? [half, half, "0"]
      : ["0", "0", line.gstRate];
  return {
    productDesc: line.description,
    hsnCode: line.hsnSac,
    ...opt("quantity", line.quantity),
    ...opt("qtyUnit", line.quantity === undefined ? undefined : line.unit),
    taxableAmount: line.taxableValue,
    sgstRate,
    cgstRate,
    igstRate,
    cessRate: line.cessRate ?? "0",
    cessNonadvol: "0",
  };
}

function buildRequest(doc: GstDocument, mv: EwbMovement, split: "INTRA" | "INTER"): EwbRequest {
  const s = doc.supplier;
  const r = doc.recipient;
  const t = mv.transport;
  // Addresses, PINs and actual state codes from the ship/dispatch party; GSTINs, names and the bill-from /
  // bill-to state codes stay the bill parties' (H validations lines 49–50).
  const from = doc.dispatchFrom?.address ?? s.address;
  const to = doc.shipTo?.address ?? r.address;
  const transactionType = TRANSACTION_TYPE[shipmentPattern(doc)];
  return {
    supplyType: "O",
    subSupplyType: isExport(doc) ? "3" : "1",
    docType: doc.kind === "BILL_OF_SUPPLY" ? "BIL" : "INV",
    docNo: doc.number,
    docDate: toEwbDate(doc.date),
    fromGstin: s.gstin,
    fromTrdName: s.tradeName ?? s.legalName,
    fromAddr1: from.line1,
    ...opt("fromAddr2", from.line2),
    fromPlace: from.city,
    actFromStateCode: ewbStateInt(from.stateCode),
    fromPincode: from.pincode ?? "",
    fromStateCode: ewbStateInt(s.stateCode),
    toGstin: r.gstin ?? "URP",
    toTrdName: r.tradeName ?? r.legalName,
    toAddr1: to.line1,
    ...opt("toAddr2", to.line2),
    toPlace: to.city,
    toPincode: to.pincode ?? "",
    actToStateCode: ewbStateInt(to.stateCode),
    toStateCode: isSez(doc) || isExport(doc) ? "99" : ewbStateInt(r.stateCode),
    transactionType,
    totalValue: doc.totals.taxableValue,
    cgstValue: doc.totals.cgst,
    sgstValue: doc.totals.sgst,
    igstValue: doc.totals.igst,
    cessValue: doc.totals.cess,
    cessNonAdvolValue: "0.00",
    otherValue: new D(doc.totals.otherCharges).plus(doc.totals.roundOff).toFixed(2),
    totInvValue: doc.totals.grandTotal,
    ...(t.mode === undefined ? {} : { transMode: MODE_CODE[t.mode] }),
    transDistance: t.distanceKm,
    ...opt("transporterName", t.transporterName),
    ...opt("transporterId", t.transporterId),
    ...opt("transDocNo", t.transportDocNo),
    ...(t.transportDocDate === undefined ? {} : { transDocDate: toEwbDate(t.transportDocDate) }),
    ...opt("vehicleNo", t.vehicleNo),
    ...(t.vehicleType === undefined ? {} : { vehicleType: VEHICLE_TYPE_CODE[t.vehicleType] }),
    itemList: doc.lines.map((l) => mapItem(l, doc.kind === "BILL_OF_SUPPLY", split)),
  };
}

/**
 * Maps a parsed GstDocument plus movement details to a Generate-EWB request. Never throws on data problems and
 * never truncates; the output is run through {@link validateEwbRequest}, so `ok: true` means the payload passed
 * validation (warnings are returned in `issues`).
 */
export function toEwbRequest(
  doc: GstDocument,
  movement: EwbMovementInput,
  options: MapOptions = {},
): MapResult {
  const mv = parseMovement(movement);
  if (!mv.ok) return { ok: false, issues: mv.issues };
  const routing = ewbRoute(doc, options);
  if (routing.route === "NONE") return { ok: false, issues: routing.reasons };
  if (routing.route === "IRN") {
    return {
      ok: false,
      issues: [
        issue(
          [],
          "USE_IRN_ROUTE",
          "M-IRN",
          "the supplier is enabled for e-invoicing: generate this e-way bill with the IRN (EwbDtls or EWB by IRN)",
        ),
      ],
    };
  }
  const toState = isSez(doc) || isExport(doc) ? "99" : doc.recipient.stateCode;
  const split = doc.supplier.stateCode === toState ? "INTRA" : "INTER";
  const pre = preconditions(doc, mv.value, split);
  if (pre.length > 0) return { ok: false, issues: pre };
  const result = finish(
    validateEwbRequest(buildRequest(doc, mv.value, split), {
      ...(options.supplierEInvoiceEnabled === undefined
        ? {}
        : { supplierEInvoiceEnabled: options.supplierEInvoiceEnabled }),
    }),
  );
  // Decision D-S12 (D-Q7 still deferred): the ship-to GSTIN has no field on this route; say so.
  if (result.ok && doc.shipTo?.gstin !== undefined) {
    result.issues.push(
      issue(
        ["shipTo", "gstin"],
        "SHIP_TO_GSTIN_NOT_SENT",
        "M-SHIPTO-GSTIN",
        "the ship-to GSTIN is not sent: the Generate E-way Bill schema has no ship-to GSTIN field (on hold since 30/07/2026)",
        "warning",
      ),
    );
  }
  return result;
}

// ---- by IRN / EwbDtls ----------------------------------------------------------------------------
function transportFields(t: EwbMovement["transport"]) {
  return {
    ...opt("TransId", t.transporterId),
    ...opt("TransName", t.transporterName),
    ...(t.mode === undefined ? {} : { TransMode: MODE_CODE[t.mode] }),
    Distance: t.distanceKm,
    ...opt("TransDocNo", t.transportDocNo),
    ...(t.transportDocDate === undefined ? {} : { TransDocDt: toEwbDate(t.transportDocDate) }),
    ...opt("VehNo", t.vehicleNo),
    ...(t.vehicleType === undefined ? {} : { VehType: VEHICLE_TYPE_CODE[t.vehicleType] }),
  };
}

/** Builds the EWB-by-IRN request (source I) from an IRN and movement details. */
export function toEwbByIrnRequest(
  irn: string,
  movement: EwbMovementInput,
): MapResult<EwbByIrnRequest> {
  const mv = parseMovement(movement);
  if (!mv.ok) return { ok: false, issues: mv.issues };
  const { transport: t, dispatchFrom, shipTo } = mv.value;
  const addr = (a: NonNullable<typeof shipTo>["address"]) => ({
    Addr1: a.line1,
    ...opt("Addr2", a.line2),
    Loc: a.city,
    ...opt("Pin", a.pincode),
    Stcd: a.stateCode,
  });
  const built = {
    Irn: irn,
    ...transportFields(t),
    ...(shipTo === undefined ? {} : { ExpShipDtls: addr(shipTo.address) }),
    ...(dispatchFrom === undefined
      ? {}
      : { DispDtls: { Nm: dispatchFrom.legalName, ...addr(dispatchFrom.address) } }),
  };
  return finish(validateEwbByIrnRequest(built));
}

/**
 * Builds the `EwbDtls` block of an IRN request (source C), so an e-way bill is generated together with the IRN.
 * Dispatch and ship-to belong in the IRN's own `DispDtls`/`ShipDtls`, which `einvoice` maps from the document
 * (Track E); the caller attaches the block and runs `validateIrnRequest` on the result (V29/V30 warnings).
 */
export function toIrnEwbDtls(movement: EwbMovementInput): MapResult<EwbDtls> {
  const mv = parseMovement(movement);
  if (!mv.ok) return { ok: false, issues: mv.issues };
  return finish(validateEwbDtls(transportFields(mv.value.transport)));
}
