// Source: https://docs.ewaybillgst.gov.in/apidocs/version1.03/generate-eway-bill.html (H, validations),
//         https://einv-apisandbox.nic.in/version1.03/ewaybill-generation-irn.html (I, validations),
//         https://einv-apisandbox.nic.in/version1.03/generate-irn.html (C, validations on EwbDtls),
//         https://docs.ewaybillgst.gov.in/apidocs/release-notes.html (L) — files in sources/ewaybill/
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
//
// Offline-checkable validations of the three e-way bill payloads, docs/specs/ewaybill.md §8. Rule ids are
// stable; each is listed in docs/legal-facts.md.
//   V-T1  Part-A only                       V-G1  master codes                V-G10 total-value sum (+₹2.00)
//   V-T2  Road                              V-G2  sub-type 8 ⇔ description    V-G11 items, HSN
//   V-T3  Rail / Air                        V-G3  K3 sub-type × doc type      V-G12 unit, quantity
//   V-T4  Ship (differs per route, D1)      V-G4  document number             V-G13 decimal places (schema)
//   V-T5  Rail document prefix P/F/L        V-G5  document date, 180 days     V-G14 GSTR-1 fields present
//   V-T6  vehicle-number shapes (warning)   V-G6  GSTIN + check digit         V-G15 address characters (warning)
//   V-T7  transport doc date ≥ doc date     V-G7  state codes (K2)            V-G16 transaction type
//   V-T8  distance                          V-G8  PIN vs state                V-G17 e-invoice route blocked
//   V-T9  transporter ID pattern (schema)   V-G9  intra/inter tax split       V-B1…V-B5 by-IRN rules
import {
  PIN_RANGES,
  isGstinStructurallyValid,
  isTemporaryId,
  isUqcCode,
  isValidGstin,
  normaliseStateCode,
  type IsoDate,
} from "@india-gst-kit/model";
import { isEwbDocType, isEwbSubSupplyType, isEwbTransactionType } from "./codes.js";
import { D, type Dec } from "./decimal.js";
import { findDocTypeRow, partyRelation } from "./doc-type-mapping.js";
import type { EwbByIrnRequest, EwbItem, EwbRequest } from "./schema.js";
import { ewbStateFromInt } from "./states.js";
import { rule, type EwbIssue } from "./types.js";
import { matchesVehicleShape } from "./vehicle-formats.js";

export const EWB_MAX_ITEMS = 250;
export const EWB_MAX_DISTANCE_KM = "4000";
/** Same-PIN movements: at most 100 km (300 for sub-type 10, Line Sales: H). */
export const EWB_SAME_PIN_MAX_KM = 100;
export const EWB_LINE_SALES_MAX_KM = 300;
/** H, validations: Generate is blocked for e-invoice-enabled suppliers from 01/10/2020. */
export const EINVOICE_EWB_BLOCK_FROM: IsoDate = "2020-10-01";
/** H, validations and L (effective 01/01/2025): "within 180 days of Document Date". */
export const EWB_MAX_DOC_AGE_DAYS = 180;
/** H: "grace value of Rs. 2.00". */
export const EWB_TOTAL_GRACE = "2.00";

export interface GenerateOptions {
  /** The "current date" for V-G5; the checks that need it are skipped if absent. */
  asOf?: IsoDate;
  /** Whether the supplier is enabled for e-invoicing (portal data; V-G17). */
  supplierEInvoiceEnabled?: boolean;
  /** Default "enforce" (as einvoice D8). */
  gstinCheckDigit?: "enforce" | "off";
  /** Notification 20/2025 relaxation: skips V-G10 (its HSN list is not in `sources/`). */
  rspHsnRelaxation?: boolean;
}

// ---- dates ---------------------------------------------------------------------------------------
const DAY_MS = 86_400_000;

/** `DD/MM/YYYY` → UTC milliseconds, or `undefined` if not a real calendar date. */
export function dmyToMs(s: string): number | undefined {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m === null) return undefined;
  const [, d = "", mo = "", y = ""] = m;
  const t = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  const back = new Date(t);
  return back.getUTCFullYear() === Number(y) &&
    back.getUTCMonth() === Number(mo) - 1 &&
    back.getUTCDate() === Number(d)
    ? t
    : undefined;
}

const isoToMs = (iso: string): number => {
  const [y = 0, m = 0, d = 0] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

// ---- PIN vs state --------------------------------------------------------------------------------
/** Warning when the first 3 PIN digits are outside every range listed for `stateCode` (2-digit). */
function pinStateWarning(
  pin: string,
  stateCode: string | undefined,
  path: (string | number)[],
  ruleId: string,
): EwbIssue | undefined {
  if (stateCode === undefined || !/^\d{6}$/.test(pin)) return undefined;
  const ranges = PIN_RANGES.filter((r) => r.stateCode === stateCode);
  if (ranges.length === 0) return undefined;
  const prefix = Number(pin.slice(0, 3));
  if (ranges.some((r) => prefix >= r.from && prefix <= r.to)) return undefined;
  return rule(
    path,
    ruleId,
    `PIN ${pin} does not fall in the PIN ranges listed for state ${stateCode} (the portal's PIN master is not available offline)`,
    "warning",
  );
}

// ---- transport rules (V-T1…V-T9), shared by H, I and C ------------------------------------------
export interface TransportView {
  route: "H" | "I" | "C";
  mode: string | undefined;
  id: string | undefined;
  vehicleNo: string | undefined;
  vehicleType: string | undefined;
  docNo: string | undefined;
  docDate: string | undefined;
  distance: string | undefined;
  /** Field names, for issue paths. */
  keys: {
    mode: string;
    id: string;
    vehicleNo: string;
    vehicleType: string;
    docNo: string;
    docDate: string;
    distance: string;
  };
  /** The document date as `DD/MM/YYYY`-comparable milliseconds, when known (V-T7). */
  documentDateMs?: number | undefined;
  fromPin?: string | undefined;
  toPin?: string | undefined;
  subSupplyType?: string | undefined;
}

const present = (s: string | undefined): s is string => s !== undefined;

export function transportRules(t: TransportView): EwbIssue[] {
  const out: EwbIssue[] = [];
  const k = t.keys;
  const err = (key: string, id: string, message: string) => out.push(rule([key], id, message));
  const hasVehicle = present(t.vehicleNo);

  // V-T1: no mode ⇒ Part-A only.
  if (t.mode === undefined) {
    if (!present(t.id))
      err(k.id, "V-T1", "Part-A only: the transporter ID is required when no mode is given");
    if (present(t.vehicleNo))
      err(
        k.vehicleNo,
        "V-T1",
        "Part-A only: the vehicle number must be absent when no mode is given",
      );
    if (present(t.vehicleType))
      err(
        k.vehicleType,
        "V-T1",
        "Part-A only: the vehicle type must be absent when no mode is given",
      );
    if (present(t.docNo))
      err(
        k.docNo,
        "V-T1",
        "Part-A only: the transport document number must be absent when no mode is given",
      );
    if (present(t.docDate))
      err(
        k.docDate,
        "V-T1",
        "Part-A only: the transport document date must be absent when no mode is given",
      );
  }

  // The vehicle type is R or O wherever it appears (K1).
  if (present(t.vehicleType) && t.vehicleType !== "R" && t.vehicleType !== "O") {
    err(
      k.vehicleType,
      "V-T2",
      "the vehicle type must be R (regular) or O (over-dimensional cargo)",
    );
  }

  if (t.mode === "1") {
    // V-T2: Road.
    if (!hasVehicle) err(k.vehicleNo, "V-T2", "mode Road: the vehicle number is required");
    if (!present(t.vehicleType))
      err(k.vehicleType, "V-T2", "mode Road: the vehicle type is required");
  } else if (t.mode === "2" || t.mode === "3") {
    // V-T3: Rail / Air (the stricter I/C rule applies to every route).
    if (!present(t.docNo))
      err(k.docNo, "V-T3", "mode Rail/Air: the transport document number is required");
    if (!present(t.docDate))
      err(k.docDate, "V-T3", "mode Rail/Air: the transport document date is required");
    if (hasVehicle) err(k.vehicleNo, "V-T3", "mode Rail/Air: the vehicle number must be absent");
    if (present(t.vehicleType))
      err(k.vehicleType, "V-T3", "mode Rail/Air: the vehicle type must be absent");
  } else if (t.mode === "4") {
    // V-T4: Ship — the three sources disagree (spec §13 D1), each route applies its own.
    if (t.route === "H") {
      if (!present(t.docNo))
        err(k.docNo, "V-T4", "mode Ship (Generate API): the transport document number is required");
      if (t.vehicleType === "O" && !hasVehicle) {
        err(
          k.vehicleNo,
          "V-T4",
          "mode Ship (Generate API): the vehicle number is required when the vehicle type is O",
        );
      }
    } else if (t.route === "I") {
      if (!present(t.docNo))
        err(k.docNo, "V-T4", "mode Ship (EWB by IRN): the transport document number is required");
      if (!present(t.docDate))
        err(k.docDate, "V-T4", "mode Ship (EWB by IRN): the transport document date is required");
      if (hasVehicle)
        err(k.vehicleNo, "V-T4", "mode Ship (EWB by IRN): the vehicle number must be absent");
      if (present(t.vehicleType))
        err(k.vehicleType, "V-T4", "mode Ship (EWB by IRN): the vehicle type must be absent");
    } else {
      const docPair = present(t.docNo) && present(t.docDate);
      if (!hasVehicle && !docPair) {
        err(
          k.vehicleNo,
          "V-T4",
          "mode Ship (EwbDtls): a vehicle number, or a transport document number and date, is required",
        );
      }
      if (hasVehicle && t.vehicleType !== "O") {
        err(k.vehicleType, "V-T4", "mode Ship (EwbDtls): the vehicle type must be O (ODC)");
      }
      if (!hasVehicle && present(t.vehicleType) && t.vehicleType !== "O") {
        err(k.vehicleType, "V-T4", "mode Ship (EwbDtls): the vehicle type must be O (ODC)");
      }
    }
  }

  // V-T5: Rail documents start with P, F or L — error on H, warning on I and C (which do not state it).
  if (t.mode === "2" && present(t.docNo) && !/^[PFL]/.test(t.docNo)) {
    out.push(
      rule(
        [k.docNo],
        "V-T5",
        "mode Rail: the transport document number starts with P (Parcel), F (FOIS) or L (Leased wagon)",
        t.route === "H" ? "error" : "warning",
      ),
    );
  }

  // V-T6: vehicle-number shapes (warning: the shapes are illustrative, the real check is Vahan).
  if (present(t.vehicleNo) && !matchesVehicleShape(t.vehicleNo)) {
    out.push(
      rule(
        [k.vehicleNo],
        "V-T6",
        "the vehicle number does not match any of the shapes in the master codes (the portal checks Vahan)",
        "warning",
      ),
    );
  }

  // V-T7: the transport document date is a real DD/MM/YYYY date and not before the document date.
  if (present(t.docDate)) {
    const ms = dmyToMs(t.docDate);
    if (ms === undefined) {
      err(k.docDate, "V-T7", "the transport document date must be a real DD/MM/YYYY date");
    } else if (t.documentDateMs !== undefined && ms < t.documentDateMs) {
      err(k.docDate, "V-T7", "the transport document date must not be before the document date");
    }
  }

  // V-T8: distance.
  if (present(t.distance)) {
    if (!/^(0|[1-9]\d*)$/.test(t.distance)) {
      err(k.distance, "V-T8", "the distance must be a whole number of kilometres");
    } else {
      const km = Number(t.distance);
      if (km > Number(EWB_MAX_DISTANCE_KM)) {
        err(k.distance, "V-T8", `the distance cannot be greater than ${EWB_MAX_DISTANCE_KM} km`);
      } else if (t.fromPin !== undefined && t.fromPin === t.toPin) {
        const max = t.subSupplyType === "10" ? EWB_LINE_SALES_MAX_KM : EWB_SAME_PIN_MAX_KM;
        if (km < 1 || km > max) {
          err(
            k.distance,
            "V-T8",
            `from and to PIN are the same: the distance must be 1 to ${max} km`,
          );
        }
      }
    }
  }
  return out;
}

// ---- Generate rules (V-G) ------------------------------------------------------------------------
const ADDRESS_CHARS = /^[A-Za-z0-9 #\-/]*$/;
const PLACE_CHARS = /^[A-Za-z ]*$/;

const num = (s: string | undefined): Dec => new D(s ?? "0");

function generateCodes(req: EwbRequest, out: EwbIssue[]): void {
  const err = (path: (string | number)[], id: string, m: string) => out.push(rule(path, id, m));
  const subOk = isEwbSubSupplyType(req.subSupplyType);
  if (!subOk) err(["subSupplyType"], "V-G1", "subSupplyType must be a code from 1 to 12");
  // V-G2
  const desc = req.subSupplyDesc;
  if (req.subSupplyType === "8" && desc === undefined) {
    err(["subSupplyDesc"], "V-G2", 'subSupplyType 8 ("Others") requires subSupplyDesc');
  }
  if (req.subSupplyType !== "8" && desc !== undefined) {
    err(["subSupplyDesc"], "V-G2", "subSupplyDesc is only for subSupplyType 8");
  }
  // V-G3
  if (subOk && isEwbDocType(req.docType)) {
    const row = findDocTypeRow(req.supplyType, req.subSupplyType, req.docType);
    if (row === undefined) {
      err(
        ["docType"],
        "V-G3",
        `docType ${req.docType} is not allowed for supplyType ${req.supplyType} / subSupplyType ${req.subSupplyType}`,
      );
    } else {
      const relation = partyRelation(row);
      if (relation === "same" && req.toGstin !== req.fromGstin) {
        err(
          ["toGstin"],
          "V-G3",
          "for this supply and document type fromGstin and toGstin are the same party",
        );
      }
      if (relation === "differ" && req.toGstin === req.fromGstin) {
        err(
          ["toGstin"],
          "V-G3",
          "for this supply and document type fromGstin and toGstin must be different parties",
        );
      }
    }
  }
}

function documentRules(req: EwbRequest, o: GenerateOptions, out: EwbIssue[]): number | undefined {
  const err = (path: (string | number)[], id: string, m: string) => out.push(rule(path, id, m));
  if (!/^[A-Za-z0-9/-]{1,16}$/.test(req.docNo)) {
    err(["docNo"], "V-G4", "docNo is 1 to 16 characters of letters, digits, / and -");
  }
  const docMs = dmyToMs(req.docDate);
  if (docMs === undefined) {
    err(["docDate"], "V-G5", "docDate must be a real DD/MM/YYYY date");
    return undefined;
  }
  if (o.asOf !== undefined) {
    const now = isoToMs(o.asOf);
    if (docMs > now) err(["docDate"], "V-G5", "docDate must not be after the current date");
    else if ((now - docMs) / DAY_MS > EWB_MAX_DOC_AGE_DAYS) {
      err(
        ["docDate"],
        "V-G5",
        `an e-way bill cannot be generated more than ${EWB_MAX_DOC_AGE_DAYS} days after the document date`,
      );
    }
  }
  return docMs;
}

function partyRules(req: EwbRequest, o: GenerateOptions, out: EwbIssue[]): void {
  const err = (path: (string | number)[], id: string, m: string) => out.push(rule(path, id, m));
  // V-G6
  for (const key of ["fromGstin", "toGstin"] as const) {
    const g = req[key];
    if (g === "URP") continue;
    if (isTemporaryId(g))
      err([key], "V-G6", `${key} looks like a temporary ID, not a GSTIN (model spec §6.4)`);
    else if (!isGstinStructurallyValid(g))
      err([key], "V-G6", `${key} is not a structurally valid GSTIN (pattern or state code)`);
    else if ((o.gstinCheckDigit ?? "enforce") === "enforce" && !isValidGstin(g)) {
      err([key], "V-G6", `${key} fails the GSTIN check digit`);
    }
  }
  // V-G7
  const codes: [keyof EwbRequest, string][] = [
    ["fromStateCode", req.fromStateCode],
    ["actFromStateCode", req.actFromStateCode],
    ["toStateCode", req.toStateCode],
    ["actToStateCode", req.actToStateCode],
  ];
  for (const [key, value] of codes) {
    if (ewbStateFromInt(value) === undefined) {
      err([key], "V-G7", `${key} ${value} is not in the e-way bill state list`);
    }
  }
  const prefixCheck = (gstin: string, key: "fromStateCode" | "toStateCode") => {
    if (gstin === "URP") return;
    const state = ewbStateFromInt(req[key]);
    if (state !== undefined && state !== gstin.slice(0, 2) && state !== "99") {
      err([key], "V-G7", `${key} must equal the GSTIN's state (${gstin.slice(0, 2)}) or 99 (SEZ)`);
    }
  };
  prefixCheck(req.fromGstin, "fromStateCode");
  prefixCheck(req.toGstin, "toStateCode");
  // V-G8
  for (const [key, act] of [
    ["fromPincode", req.actFromStateCode],
    ["toPincode", req.actToStateCode],
  ] as const) {
    const pin = req[key];
    if (!/^[1-9]\d{5}$/.test(pin)) {
      err([key], "V-G8", `${key} must be a 6-digit PIN code`);
      continue;
    }
    const w = pinStateWarning(pin, ewbStateFromInt(act), [key], "V-G8");
    if (w !== undefined) out.push(w);
  }
  // V-G15 (warnings)
  const warn = (path: (string | number)[], m: string) =>
    out.push(rule(path, "V-G15", m, "warning"));
  for (const key of ["fromAddr1", "fromAddr2", "toAddr1", "toAddr2"] as const) {
    const v = req[key];
    if (v !== undefined && !ADDRESS_CHARS.test(v))
      warn([key], `${key} may contain only letters, digits, spaces and # - /`);
  }
  for (const key of ["fromPlace", "toPlace"] as const) {
    const v = req[key];
    if (v !== undefined && !PLACE_CHARS.test(v))
      warn([key], `${key} may contain only letters and spaces`);
  }
}

function taxRules(req: EwbRequest, o: GenerateOptions, out: EwbIssue[]): void {
  const err = (path: (string | number)[], id: string, m: string) => out.push(rule(path, id, m));
  // V-G9
  const from = ewbStateFromInt(req.fromStateCode);
  const to = ewbStateFromInt(req.toStateCode);
  if (from !== undefined && to !== undefined) {
    const intra = from === to;
    if (intra) {
      if (!num(req.igstValue).isZero())
        err(["igstValue"], "V-G9", "intra-state: igstValue must be 0");
      req.itemList.forEach((it, i) => {
        if (!num(it.igstRate).isZero())
          err(["itemList", i, "igstRate"], "V-G9", "intra-state: igstRate must be 0");
      });
    } else {
      for (const key of ["cgstValue", "sgstValue"] as const) {
        if (!num(req[key]).isZero()) err([key], "V-G9", `inter-state: ${key} must be 0`);
      }
      req.itemList.forEach((it, i) => {
        for (const key of ["cgstRate", "sgstRate"] as const) {
          if (!num(it[key]).isZero())
            err(["itemList", i, key], "V-G9", `inter-state: ${key} must be 0`);
        }
      });
    }
  }
  // V-G10
  if (o.rspHsnRelaxation !== true) {
    const sum = [
      req.totalValue,
      req.cgstValue,
      req.sgstValue,
      req.igstValue,
      req.cessValue,
      req.cessNonAdvolValue,
      req.otherValue,
    ].reduce((a, v) => a.plus(num(v)), new D(0));
    if (sum.gt(num(req.totInvValue).plus(EWB_TOTAL_GRACE))) {
      err(
        ["totInvValue"],
        "V-G10",
        `the values add up to ${sum.toFixed(2)}, more than totInvValue + ${EWB_TOTAL_GRACE}`,
      );
    }
  }
  // V-G14
  const required: (keyof EwbRequest)[] = [
    "totalValue",
    "cgstValue",
    "sgstValue",
    "igstValue",
    "cessValue",
    "otherValue",
  ];
  for (const key of required) {
    if (req[key] === undefined) err([key], "V-G14", `${key} is mandatory (GSTR-1 fields)`);
  }
  req.itemList.forEach((it, i) => {
    for (const key of ["cgstRate", "sgstRate", "igstRate", "cessRate", "cessNonadvol"] as const) {
      if (it[key] === undefined)
        err(["itemList", i, key], "V-G14", `${key} is mandatory (GSTR-1 fields)`);
    }
  });
}

function itemRules(req: EwbRequest, out: EwbIssue[]): void {
  const err = (path: (string | number)[], id: string, m: string) => out.push(rule(path, id, m));
  const n = req.itemList.length;
  if (n < 1 || n > EWB_MAX_ITEMS)
    err(["itemList"], "V-G11", `itemList must have 1 to ${EWB_MAX_ITEMS} items, found ${n}`);
  req.itemList.forEach((it: EwbItem, i) => {
    if (!/^[1-9]\d{0,7}$/.test(it.hsnCode)) {
      err(
        ["itemList", i, "hsnCode"],
        "V-G11",
        "hsnCode must be a whole number of at most 8 digits",
      );
    }
    if (it.qtyUnit !== undefined && !isUqcCode(it.qtyUnit)) {
      err(["itemList", i, "qtyUnit"], "V-G12", `qtyUnit ${it.qtyUnit} is not in the unit master`);
    }
    if (it.quantity !== undefined) {
      const q = it.quantity;
      if ((q.split(".")[1]?.length ?? 0) > 2 || new D(q).gte(1_000_000)) {
        out.push(
          rule(
            ["itemList", i, "quantity"],
            "V-G12",
            "quantity is Decimal(8,2) in the data structure: at most 2 decimal places and below 1000000",
            "warning",
          ),
        );
      }
    }
  });
  if (n > 0 && req.itemList.every((it) => it.hsnCode.startsWith("99"))) {
    err(["itemList"], "V-G11", "at least one item must have a goods HSN (not starting with 99)");
  }
}

function routeRules(
  req: EwbRequest,
  o: GenerateOptions,
  docMs: number | undefined,
  out: EwbIssue[],
): void {
  // V-G16
  if (!isEwbTransactionType(req.transactionType)) {
    out.push(rule(["transactionType"], "V-G16", "transactionType must be 1, 2, 3 or 4"));
  }
  // V-G17
  const blockFrom = isoToMs(EINVOICE_EWB_BLOCK_FROM);
  const viaIrn =
    req.docType === "INV" &&
    docMs !== undefined &&
    docMs >= blockFrom &&
    ((req.toGstin !== "URP" && req.subSupplyType === "1") || req.subSupplyType === "3");
  if (viaIrn) {
    if (o.supplierEInvoiceEnabled === true) {
      out.push(issueUseIrn());
    } else if (o.supplierEInvoiceEnabled === undefined) {
      out.push({
        path: [],
        code: "EINVOICE_STATUS_UNKNOWN",
        rule: "V-G17",
        message:
          "if the supplier is enabled for e-invoicing this e-way bill must be generated with the IRN (the status is portal data)",
        severity: "warning",
      });
    }
  }
}

const issueUseIrn = (): EwbIssue => ({
  path: [],
  code: "USE_IRN_ROUTE",
  rule: "V-G17",
  message:
    "the supplier is enabled for e-invoicing: generate this e-way bill with the IRN (EwbDtls or EWB by IRN), not with the Generate API",
  severity: "error",
});

export function generateRules(req: EwbRequest, o: GenerateOptions = {}): EwbIssue[] {
  const out: EwbIssue[] = [];
  generateCodes(req, out);
  const docMs = documentRules(req, o, out);
  partyRules(req, o, out);
  taxRules(req, o, out);
  itemRules(req, out);
  routeRules(req, o, docMs, out);
  out.push(
    ...transportRules({
      route: "H",
      mode: req.transMode,
      id: req.transporterId,
      vehicleNo: req.vehicleNo,
      vehicleType: req.vehicleType,
      docNo: req.transDocNo,
      docDate: req.transDocDate,
      distance: req.transDistance,
      keys: {
        mode: "transMode",
        id: "transporterId",
        vehicleNo: "vehicleNo",
        vehicleType: "vehicleType",
        docNo: "transDocNo",
        docDate: "transDocDate",
        distance: "transDistance",
      },
      documentDateMs: docMs,
      fromPin: req.fromPincode,
      toPin: req.toPincode,
      subSupplyType: req.subSupplyType,
    }),
  );
  return out;
}

// ---- by-IRN rules (V-B) and EwbDtls ------------------------------------------------------------
export interface ByIrnOptions {
  /** The document date (ISO), for V-T7. */
  docDate?: IsoDate;
}

export function byIrnRules(req: EwbByIrnRequest, o: ByIrnOptions = {}): EwbIssue[] {
  const out: EwbIssue[] = [];
  // V-B1
  if (req.Irn !== undefined && !/^[0-9a-f]{64}$/.test(req.Irn)) {
    out.push(rule(["Irn"], "V-B1", "an IRN is 64 lowercase hexadecimal characters", "warning"));
  }
  // V-B4 / V-B5
  for (const block of ["DispDtls", "ExpShipDtls"] as const) {
    const d = req[block];
    if (d === undefined) continue;
    const state = normaliseStateCode(d.Stcd);
    if (state === undefined) {
      out.push(
        rule([block, "Stcd"], "V-B4", `Stcd ${d.Stcd} is not in the e-invoice state master`),
      );
    } else {
      const w = pinStateWarning(d.Pin, state, [block, "Pin"], "V-B5");
      if (w !== undefined) out.push(w);
    }
  }
  out.push(
    ...transportRules({
      route: "I",
      mode: req.TransMode,
      id: req.TransId,
      vehicleNo: req.VehNo,
      vehicleType: req.VehType,
      docNo: req.TransDocNo,
      docDate: req.TransDocDt,
      distance: req.Distance,
      keys: {
        mode: "TransMode",
        id: "TransId",
        vehicleNo: "VehNo",
        vehicleType: "VehType",
        docNo: "TransDocNo",
        docDate: "TransDocDt",
        distance: "Distance",
      },
      documentDateMs: o.docDate === undefined ? undefined : isoToMs(o.docDate),
    }),
  );
  return out;
}

export interface EwbDtlsLike {
  TransId?: string | undefined;
  TransMode?: string | undefined;
  Distance: string;
  TransDocNo?: string | undefined;
  TransDocDt?: string | undefined;
  VehNo?: string | undefined;
  VehType?: string | undefined;
}

export function dtlsRules(block: EwbDtlsLike, o: ByIrnOptions = {}): EwbIssue[] {
  return transportRules({
    route: "C",
    mode: block.TransMode,
    id: block.TransId,
    vehicleNo: block.VehNo,
    vehicleType: block.VehType,
    docNo: block.TransDocNo,
    docDate: block.TransDocDt,
    distance: block.Distance,
    keys: {
      mode: "TransMode",
      id: "TransId",
      vehicleNo: "VehNo",
      vehicleType: "VehType",
      docNo: "TransDocNo",
      docDate: "TransDocDt",
      distance: "Distance",
    },
    documentDateMs: o.docDate === undefined ? undefined : isoToMs(o.docDate),
  });
}
