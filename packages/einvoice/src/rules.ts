// Source: https://einv-apisandbox.nic.in/version1.03/generate-irn.html#Validations (source C) —
//         sources/einvoice/generate-irn-validations.txt, and the schema (source C) for ranges and counts
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
//
// Offline-checkable validations of an IRN request. Rule ids are stable; each is listed in docs/legal-facts.md.
//   V1  Version "1.1"                                V13 1–1000 items
//   V2  Irn absent                                   V14 SlNo numeric and unique
//   V3  Doc number not starting with 0, / or -       V15 goods need Qty and a UQC unit
//   V4  Doc date: real, >= 2025-04-01 (default)      V16 services use a 99… SAC (model rule; proxy for the HSN master)
//   V5  GSTIN structure and check digit              V17 tax rate 0.5% is withdrawn
//   V6  GSTIN state prefix = Stcd                    V20–V25 item arithmetic within ±1 rupee
//   V7  state codes; POS 25 withdrawn                V26–V28 document totals (V27: RndOffAmt ±99.99)
//   V8  direct exports: URP / 96 / 96 / 999999       S-SIZE payload <= 2 MB
//   V9  reverse charge only B2B/SEZ                  V12 PIN prefix (warning only)
//   V10 IGST on intra needs reverse charge
//   V11 intra/inter tax split
// V3 and V27 are also enforced by the structural schema; the structural issue is reported under these ids.
import {
  isGstinStructurallyValid,
  isPlaceOfSupplyCode,
  isUqcCode,
  isValidGstin,
  normaliseStateCode,
  type IsoDate,
} from "@india-gst-kit/model";
import { D, type Dec } from "./decimal.js";
import { PIN_RANGES } from "./pin-ranges.js";
import type { IrnItem, IrnRequest } from "./schema.js";
import { rupeeTolerance, withinTolerance } from "./tolerance.js";
import { issue, type IrnIssue } from "./types.js";

export const IRN_SCHEMA_VERSION = "1.1";
/** "IRN requests with Document Date from 01/04/2025 only will be accepted" (UNVERIFIED). */
export const DEFAULT_EARLIEST_DOC_DATE: IsoDate = "2025-04-01";
/** "JSON payload size cannot exceed 2MB" — read as 2 MiB (UNVERIFIED). */
export const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

export const RULE_IDS = [
  "S-SCHEMA",
  "S-TEXT",
  "S-SIZE",
  "V1",
  "V2",
  "V3",
  "V4",
  "V5",
  "V6",
  "V7",
  "V8",
  "V9",
  "V10",
  "V11",
  "V12",
  "V13",
  "V14",
  "V15",
  "V16",
  "V17",
  "V20",
  "V21",
  "V22",
  "V23",
  "V24",
  "V25",
  "V26",
  "V27",
  "V28",
] as const;

export interface ValidateOptions {
  /** Upper bound for DocDtls.Dt, if given. */
  asOf?: IsoDate;
  /** Lower bound for DocDtls.Dt (V4). Default {@link DEFAULT_EARLIEST_DOC_DATE}. */
  earliestDocDate?: IsoDate;
  /** V5 check digit (mod-36, UNVERIFIED). Default "enforce". */
  gstinCheckDigit?: "enforce" | "off";
}

const dec = (s: string | undefined): Dec => new D(s ?? "0");
const ns = (code: string): string => normaliseStateCode(code) ?? code;
const EXPORT_TYPES = new Set(["EXPWP", "EXPWOP"]);

function rule(
  path: (string | number)[],
  id: string,
  message: string,
  severity: "error" | "warning" = "error",
): IrnIssue {
  return issue(path, "RULE", id, message, severity);
}

function toIso(irnDate: string): { iso: string; real: boolean } {
  const [dd = "", mm = "", yyyy = ""] = irnDate.split("/");
  const d = Number(dd);
  const m = Number(mm);
  const y = Number(yyyy);
  const t = new Date(Date.UTC(y, m - 1, d));
  const real = t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  return { iso: `${yyyy}-${mm}-${dd}`, real };
}

function arithmetic(
  out: IrnIssue[],
  id: string,
  path: (string | number)[],
  passed: string | undefined,
  calculated: Dec,
  what: string,
): void {
  const calc = calculated.toFixed();
  if (!withinTolerance(passed ?? "0", calc)) {
    const { min, max } = rupeeTolerance(calc);
    out.push(
      issue(
        path,
        "ARITHMETIC",
        id,
        `${what}: expected about ${calculated.toFixed(2)} (allowed ${min} to ${max}), got ${passed ?? "0"}`,
      ),
    );
  }
}

type PartyKey = "SellerDtls" | "BuyerDtls" | "DispDtls" | "ShipDtls";

function itemRules(req: IrnRequest, intra: boolean, out: IrnIssue[]): void {
  const crnDbn = req.DocDtls.Typ === "CRN" || req.DocDtls.Typ === "DBN";
  const supTyp = req.TranDtls.SupTyp;
  const rcmLike = req.TranDtls.RegRev === "Y" || supTyp === "EXPWP";
  const seenSl = new Set<string>();
  req.ItemList.forEach((it: IrnItem, i) => {
    const at = (k: string): (string | number)[] => ["ItemList", i, k];
    if (seenSl.has(it.SlNo))
      out.push(rule(at("SlNo"), "V14", `SlNo ${it.SlNo} is used more than once`));
    seenSl.add(it.SlNo);

    if (it.IsServc === "N") {
      if (it.Qty === undefined) out.push(rule(at("Qty"), "V15", "Quantity is mandatory for goods"));
      if (it.Unit === undefined)
        out.push(rule(at("Unit"), "V15", "Unit quantity code is mandatory for goods"));
      else if (!isUqcCode(it.Unit))
        out.push(rule(at("Unit"), "V15", `"${it.Unit}" is not a unit quantity code in the master`));
    } else if (!it.HsnCd.startsWith("99")) {
      out.push(rule(at("HsnCd"), "V16", "A service needs a SAC starting with 99"));
    }
    if (dec(it.GstRt).eq("0.5")) out.push(rule(at("GstRt"), "V17", "Tax rate 0.5% is withdrawn"));

    const ass = dec(it.AssAmt);
    const rate = dec(it.GstRt);
    arithmetic(
      out,
      "V20",
      at("AssAmt"),
      it.AssAmt,
      dec(it.TotAmt).minus(dec(it.Discount)),
      "AssAmt = TotAmt − Discount",
    );
    if (!crnDbn) {
      if (intra) {
        const half = ass.mul(rate).div(200);
        arithmetic(out, "V21", at("CgstAmt"), it.CgstAmt, half, "CgstAmt = AssAmt × GstRt / 200");
        arithmetic(out, "V21", at("SgstAmt"), it.SgstAmt, half, "SgstAmt = AssAmt × GstRt / 200");
      } else if (!((supTyp === "EXPWOP" || supTyp === "SEZWOP") && dec(it.IgstAmt).isZero())) {
        arithmetic(
          out,
          "V22",
          at("IgstAmt"),
          it.IgstAmt,
          ass.mul(rate).div(100),
          "IgstAmt = AssAmt × GstRt / 100",
        );
      }
      arithmetic(
        out,
        "V23",
        at("CesAmt"),
        it.CesAmt,
        ass.mul(dec(it.CesRt)).div(100),
        "CesAmt = AssAmt × CesRt / 100",
      );
      arithmetic(
        out,
        "V24",
        at("StateCesAmt"),
        it.StateCesAmt,
        ass.mul(dec(it.StateCesRt)).div(100),
        "StateCesAmt = AssAmt × StateCesRt / 100",
      );
    }
    const taxes = [
      it.CgstAmt,
      it.SgstAmt,
      it.IgstAmt,
      it.CesAmt,
      it.CesNonAdvlAmt,
      it.StateCesAmt,
      it.StateCesNonAdvlAmt,
    ].reduce((a, v) => a.plus(dec(v)), new D(0));
    const withTax = ass.plus(taxes).plus(dec(it.OthChrg));
    const withoutTax = ass.plus(dec(it.OthChrg));
    const okTotal =
      withinTolerance(it.TotItemVal, withTax.toFixed()) ||
      (rcmLike && withinTolerance(it.TotItemVal, withoutTax.toFixed()));
    if (!okTotal) {
      const { min, max } = rupeeTolerance(withTax.toFixed());
      out.push(
        issue(
          at("TotItemVal"),
          "ARITHMETIC",
          "V25",
          `TotItemVal: expected about ${withTax.toFixed(2)} (allowed ${min} to ${max})${rcmLike ? ` or ${withoutTax.toFixed(2)} without tax` : ""}, got ${it.TotItemVal}`,
        ),
      );
    }

    // V11 — tax split
    if (intra) {
      if (!dec(it.IgstAmt).isZero())
        out.push(rule(at("IgstAmt"), "V11", "IGST must be 0 on an intra-state supply"));
    } else {
      if (!dec(it.CgstAmt).isZero())
        out.push(rule(at("CgstAmt"), "V11", "CGST must be 0 on an inter-state supply"));
      if (!dec(it.SgstAmt).isZero())
        out.push(rule(at("SgstAmt"), "V11", "SGST must be 0 on an inter-state supply"));
    }
  });
}

function totalsRules(req: IrnRequest, out: IrnIssue[]): void {
  const sum = (f: (it: IrnItem) => Dec): Dec =>
    req.ItemList.reduce((a, it) => a.plus(f(it)), new D(0));
  const v = req.ValDtls;
  const at = (k: string): (string | number)[] => ["ValDtls", k];
  arithmetic(
    out,
    "V26",
    at("AssVal"),
    v.AssVal,
    sum((it) => dec(it.AssAmt)),
    "AssVal = ΣAssAmt",
  );
  arithmetic(
    out,
    "V26",
    at("CgstVal"),
    v.CgstVal,
    sum((it) => dec(it.CgstAmt)),
    "CgstVal = ΣCgstAmt",
  );
  arithmetic(
    out,
    "V26",
    at("SgstVal"),
    v.SgstVal,
    sum((it) => dec(it.SgstAmt)),
    "SgstVal = ΣSgstAmt",
  );
  arithmetic(
    out,
    "V26",
    at("IgstVal"),
    v.IgstVal,
    sum((it) => dec(it.IgstAmt)),
    "IgstVal = ΣIgstAmt",
  );
  arithmetic(
    out,
    "V26",
    at("CesVal"),
    v.CesVal,
    sum((it) => dec(it.CesAmt).plus(dec(it.CesNonAdvlAmt))),
    "CesVal = Σ(CesAmt + CesNonAdvlAmt)",
  );
  arithmetic(
    out,
    "V26",
    at("StCesVal"),
    v.StCesVal,
    sum((it) => dec(it.StateCesAmt).plus(dec(it.StateCesNonAdvlAmt))),
    "StCesVal = Σ(StateCesAmt + StateCesNonAdvlAmt)",
  );
  const expected = sum((it) => dec(it.TotItemVal))
    .minus(dec(v.Discount))
    .plus(dec(v.OthChrg))
    .plus(dec(v.RndOffAmt));
  arithmetic(
    out,
    "V28",
    at("TotInvVal"),
    v.TotInvVal,
    expected,
    "TotInvVal = ΣTotItemVal − Discount + OthChrg + RndOffAmt",
  );
}

/** Runs V1–V28 on a payload that already passed the structural schema. */
export function runRules(req: IrnRequest, options: ValidateOptions = {}): IrnIssue[] {
  const out: IrnIssue[] = [];
  const earliest = options.earliestDocDate ?? DEFAULT_EARLIEST_DOC_DATE;
  const checkDigit = options.gstinCheckDigit ?? "enforce";
  const supTyp = req.TranDtls.SupTyp;
  const isExport = EXPORT_TYPES.has(supTyp);

  if (req.Version !== IRN_SCHEMA_VERSION)
    out.push(rule(["Version"], "V1", `Version must be "${IRN_SCHEMA_VERSION}"`));
  if (req.Irn !== undefined)
    out.push(rule(["Irn"], "V2", "Irn must not be sent; it is generated by the e-invoice system"));

  const dt = toIso(req.DocDtls.Dt);
  if (!dt.real)
    out.push(rule(["DocDtls", "Dt"], "V4", "Document date is not a real calendar date"));
  else {
    if (dt.iso < earliest)
      out.push(rule(["DocDtls", "Dt"], "V4", `Document date must not be before ${earliest}`));
    if (options.asOf !== undefined && dt.iso > options.asOf)
      out.push(rule(["DocDtls", "Dt"], "V4", `Document date must not be after ${options.asOf}`));
  }

  // V5 — GSTINs
  const gstins: [(string | number)[], string | undefined][] = [
    [["SellerDtls", "Gstin"], req.SellerDtls.Gstin],
    [["BuyerDtls", "Gstin"], req.BuyerDtls.Gstin],
    [["ShipDtls", "Gstin"], req.ShipDtls?.Gstin],
    [["TranDtls", "EcmGstin"], req.TranDtls.EcmGstin],
  ];
  for (const [path, g] of gstins) {
    if (g === undefined || g === "URP") continue;
    if (!isGstinStructurallyValid(g))
      out.push(
        rule(
          path,
          "V5",
          "GSTIN does not match the pattern or its state code is not a GSTIN state code",
        ),
      );
    else if (checkDigit === "enforce" && !isValidGstin(g))
      out.push(rule(path, "V5", "GSTIN check digit is wrong (mod-36, UNVERIFIED)"));
  }

  // V6 — state prefix
  if (req.SellerDtls.Gstin.slice(0, 2) !== ns(req.SellerDtls.Stcd)) {
    out.push(
      rule(
        ["SellerDtls", "Stcd"],
        "V6",
        "Seller state code must equal the first two digits of the GSTIN",
      ),
    );
  }
  if (
    !isExport &&
    req.BuyerDtls.Gstin !== "URP" &&
    req.BuyerDtls.Gstin.slice(0, 2) !== ns(req.BuyerDtls.Stcd)
  ) {
    out.push(
      rule(
        ["BuyerDtls", "Stcd"],
        "V6",
        "Buyer state code must equal the first two digits of the GSTIN",
      ),
    );
  }

  // V7 — state codes
  const parties: [PartyKey, string | undefined][] = [
    ["SellerDtls", req.SellerDtls.Stcd],
    ["BuyerDtls", req.BuyerDtls.Stcd],
    ["DispDtls", req.DispDtls?.Stcd],
    ["ShipDtls", req.ShipDtls?.Stcd],
  ];
  for (const [key, stcd] of parties) {
    if (stcd !== undefined && normaliseStateCode(stcd) === undefined) {
      out.push(rule([key, "Stcd"], "V7", `"${stcd}" is not a state code in the master`));
    }
  }
  const pos = normaliseStateCode(req.BuyerDtls.Pos);
  if (pos === undefined)
    out.push(
      rule(["BuyerDtls", "Pos"], "V7", `"${req.BuyerDtls.Pos}" is not a state code in the master`),
    );
  else if (!isPlaceOfSupplyCode(pos))
    out.push(rule(["BuyerDtls", "Pos"], "V7", "State code 25 is withdrawn as a place of supply"));

  // V8 — direct exports
  if (isExport) {
    if (req.BuyerDtls.Gstin !== "URP")
      out.push(rule(["BuyerDtls", "Gstin"], "V8", "A direct export needs the recipient GSTIN URP"));
    if (ns(req.BuyerDtls.Stcd) !== "96")
      out.push(
        rule(["BuyerDtls", "Stcd"], "V8", "A direct export needs the recipient state code 96"),
      );
    if (ns(req.BuyerDtls.Pos) !== "96")
      out.push(rule(["BuyerDtls", "Pos"], "V8", "A direct export needs the place of supply 96"));
    if (req.BuyerDtls.Pin !== undefined && req.BuyerDtls.Pin !== "999999") {
      out.push(rule(["BuyerDtls", "Pin"], "V8", "A direct export needs the PIN code 999999"));
    }
  }

  // V9, V10
  const regRev = req.TranDtls.RegRev === "Y";
  if (regRev && !(supTyp === "B2B" || supTyp === "SEZWP" || supTyp === "SEZWOP")) {
    out.push(
      rule(["TranDtls", "RegRev"], "V9", "Reverse charge is allowed only for B2B and SEZ supplies"),
    );
  }
  const igstOnIntra = req.TranDtls.IgstOnIntra === "Y";
  const sameState = ns(req.SellerDtls.Stcd) === ns(req.BuyerDtls.Pos);
  if (igstOnIntra && !(sameState && regRev)) {
    out.push(
      rule(
        ["TranDtls", "IgstOnIntra"],
        "V10",
        "IGST on an intra-state supply needs seller state = place of supply and reverse charge",
      ),
    );
  }

  // V11 tax split (decision D-Q3: deemed exports are decided by state, like B2B)
  const intra = sameState && (supTyp === "B2B" || supTyp === "DEXP") && !igstOnIntra;

  // V12 — PIN prefix (warning only: the portal checks its full PIN master first)
  const pins: [PartyKey, string | undefined, string | undefined][] = [
    ["SellerDtls", req.SellerDtls.Pin, req.SellerDtls.Stcd],
    ["BuyerDtls", req.BuyerDtls.Pin, req.BuyerDtls.Stcd],
    ["DispDtls", req.DispDtls?.Pin, req.DispDtls?.Stcd],
    ["ShipDtls", req.ShipDtls?.Pin, req.ShipDtls?.Stcd],
  ];
  for (const [key, pinCode, stcd] of pins) {
    if (pinCode === undefined || stcd === undefined) continue;
    const state = ns(stcd);
    if (pinCode === "999999" && (state === "97" || (key === "BuyerDtls" && isExport))) continue;
    const ranges = PIN_RANGES.filter((r) => r.stateCode === state);
    if (ranges.length === 0) continue;
    const prefix = Number(pinCode.slice(0, 3));
    if (!ranges.some((r) => prefix >= r.from && prefix <= r.to)) {
      out.push(
        rule(
          [key, "Pin"],
          "V12",
          `PIN ${pinCode} does not start with a postal prefix of state ${state}`,
          "warning",
        ),
      );
    }
  }

  // V13
  if (req.ItemList.length < 1 || req.ItemList.length > 1000) {
    out.push(
      rule(
        ["ItemList"],
        "V13",
        `An invoice needs between 1 and 1000 items (found ${req.ItemList.length})`,
      ),
    );
  }

  itemRules(req, intra, out);
  totalsRules(req, out);
  return out;
}
