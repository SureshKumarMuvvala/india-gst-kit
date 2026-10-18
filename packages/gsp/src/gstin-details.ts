// Source: https://einv-apisandbox.nic.in/version1.04/get-gstin-details.html, Sync-GSTIN-Details-from-CP.html —
//         sources/einvoice/api/v1.04-get-gstin-details.txt, v1.04-sync-gstin-details-from-cp.txt;
//         https://docs.ewaybillgst.gov.in/apidocs/version1.03/get-gstin-details.html —
//         sources/ewaybill/api/v1.03-get-gstin-details.txt
// Retrieved: 2026-10-18
// Status: UNVERIFIED — needs CA
//
// "Considered active only if status='ACT'" (EI FAQ). Block status: 'U' or '' unblocked, 'B' blocked. `isActive`
// reports the portal's flag; it says nothing about the taxpayer's legal position (D-G13, needs CA).
import { z } from "zod";
import { isGstinStructurallyValid, isValidGstin } from "@india-gst-kit/model";
import { warning, type GspIssue } from "./issues.js";

const Str = z.string().nullable();

export const GstinDetailsSchema = z.strictObject({
  gstin: z.string(),
  tradeName: Str,
  legalName: Str,
  address: z.strictObject({
    buildingName: Str,
    buildingNo: Str,
    floorNo: Str,
    street: Str,
    location: Str,
    line1: Str,
    line2: Str,
  }),
  stateCode: Str,
  pincode: Str,
  taxpayerType: Str,
  status: Str,
  isActive: z.boolean(),
  blockStatus: z.enum(["UNBLOCKED", "BLOCKED", "UNKNOWN"]),
  registrationDate: Str,
  deregistrationDate: Str,
  source: z.enum(["einvoice", "einvoice-sync", "ewaybill"]),
});
export type GstinDetails = z.infer<typeof GstinDetailsSchema>;
export type GstinDetailsSource = GstinDetails["source"];

const EINVOICE_KEYS = [
  "Gstin",
  "TradeName",
  "LegalName",
  "AddrBnm",
  "AddrBno",
  "AddrFlno",
  "AddrSt",
  "AddrLoc",
  "StateCode",
  "AddrPncd",
  "TxpType",
  "Status",
  "BlkStatus",
  "DtReg",
  "DtDReg",
] as const;
const EWAYBILL_KEYS = [
  "gstin",
  "tradeName",
  "legalName",
  "address1",
  "address2",
  "stateCode",
  "pinCode",
  "txpType",
  "status",
  "blkStatus",
] as const;

export const GSTIN_STATUSES = ["ACT", "CNL", "INA", "PRO"] as const;

export type NormaliseResult =
  | { ok: true; value: GstinDetails; warnings: GspIssue[] }
  | { ok: false; message: string; warnings: GspIssue[] };

/** A string or number as text; `null`, missing or another type → `null`. */
function text(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}

function blank(v: string | null): string | null {
  return v === null || v.trim() === "" ? null : v.trim();
}

/**
 * The e-invoice (numbers) and e-way bill (strings) GSTIN lookups mapped to one shape. `raw` must be the decrypted
 * JSON with numbers already as strings or numbers. Unknown keys warn; nothing the portal sent is dropped silently.
 */
export function normaliseGstinDetails(raw: unknown, source: GstinDetailsSource): NormaliseResult {
  const warnings: GspIssue[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "GSTIN details are not a JSON object", warnings };
  }
  const r = raw as Record<string, unknown>;
  const known: readonly string[] = source === "ewaybill" ? EWAYBILL_KEYS : EINVOICE_KEYS;
  for (const k of Object.keys(r)) {
    if (!known.includes(k)) warnings.push(warning("UNEXPECTED_KEY", `unknown key "${k}"`, [k]));
  }
  const ei = source !== "ewaybill";
  const gstin = blank(text(ei ? r.Gstin : r.gstin));
  if (gstin === null) return { ok: false, message: "GSTIN details carry no GSTIN", warnings };

  const rawState = blank(text(ei ? r.StateCode : r.stateCode));
  let stateCode = rawState;
  if (rawState !== null) {
    if (/^\d{1,2}$/.test(rawState)) stateCode = rawState.padStart(2, "0");
    else
      warnings.push(
        warning("UNUSUAL_STATE_CODE", `state code "${rawState}" is not 1–2 digits`, ["stateCode"]),
      );
  }
  const pincode = blank(text(ei ? r.AddrPncd : r.pinCode));
  if (pincode !== null && !/^\d{6}$/.test(pincode)) {
    warnings.push(warning("UNUSUAL_PINCODE", `PIN code "${pincode}" is not 6 digits`, ["pincode"]));
  }

  const status = blank(text(ei ? r.Status : r.status));
  if (status === null || !(GSTIN_STATUSES as readonly string[]).includes(status)) {
    warnings.push(
      warning(
        "UNKNOWN_GSTIN_STATUS",
        status === null ? "GSTIN status is missing" : `GSTIN status "${status}" is not documented`,
        ["status"],
      ),
    );
  }

  const blk = ei ? r.BlkStatus : r.blkStatus;
  let blockStatus: GstinDetails["blockStatus"] = "UNKNOWN";
  if (typeof blk === "string") {
    const b = blk.trim();
    if (b === "" || b === "U") blockStatus = "UNBLOCKED";
    else if (b === "B") blockStatus = "BLOCKED";
    else
      warnings.push(
        warning("UNKNOWN_BLOCK_STATUS", `block status "${blk}" is not documented`, ["blockStatus"]),
      );
  }

  const value: GstinDetails = {
    gstin,
    tradeName: blank(text(ei ? r.TradeName : r.tradeName)),
    legalName: blank(text(ei ? r.LegalName : r.legalName)),
    address: {
      buildingName: ei ? blank(text(r.AddrBnm)) : null,
      buildingNo: ei ? blank(text(r.AddrBno)) : null,
      floorNo: ei ? blank(text(r.AddrFlno)) : null,
      street: ei ? blank(text(r.AddrSt)) : null,
      location: ei ? blank(text(r.AddrLoc)) : null,
      line1: ei ? null : blank(text(r.address1)),
      line2: ei ? null : blank(text(r.address2)),
    },
    stateCode,
    pincode,
    taxpayerType: blank(text(ei ? r.TxpType : r.txpType)),
    status,
    isActive: status === "ACT",
    blockStatus,
    registrationDate: ei ? blank(text(r.DtReg)) : null,
    deregistrationDate: ei ? blank(text(r.DtDReg)) : null,
    source,
  };
  return { ok: true, value, warnings };
}

/**
 * A GSTIN argument: pattern and a GSTIN-capable state code are required (else nothing is sent); a failing mod-36
 * check digit only warns, because the algorithm is UNVERIFIED (D-G19).
 */
export function checkGstinArgument(
  gstin: string,
  path: string,
): { ok: true; warnings: GspIssue[] } | { ok: false; issue: GspIssue } {
  if (!isGstinStructurallyValid(gstin)) {
    return {
      ok: false,
      issue: {
        code: "BAD_GSTIN",
        severity: "error",
        message: `${path}: "${gstin}" is not a GSTIN`,
        path: [path],
      },
    };
  }
  return isValidGstin(gstin)
    ? { ok: true, warnings: [] }
    : {
        ok: true,
        warnings: [
          warning("GSTIN_CHECK_DIGIT", `${path}: check digit does not match mod-36`, [path]),
        ],
      };
}
