// Source: https://docs.ewaybillgst.gov.in/apidocs/version1.03/{vehicle-number-update,cancel-eway-bill,
//         extend-validity,consolidated-eway-bill,update-transporter,reject-eway-bill}.html —
//         sources/ewaybill/api/v1.03-*.txt
// Retrieved: 2026-10-18
// Status: UNVERIFIED — needs CA
//
// Hand-transcribed from the draft-04 schemas, data structures and validations (spec §8.2). In memory every
// field is a string; `markNumber` marks the fields the source schema types as JSON numbers (D-G18). Where the
// source schema is malformed (G7, §13 GD15) the evident intent is applied (D-G17).
import { z } from "zod";
import { markNumber } from "@india-gst-kit/model";
import { EWB_CANCEL_REASON_CODES } from "../codes/ewb-cancel-reasons.js";
import { EWB_EXTENSION_REASON_CODES } from "../codes/ewb-extension-reasons.js";
import { EWB_VEHICLE_REASON_CODES } from "../codes/ewb-vehicle-reasons.js";
import type { GspIssue } from "../issues.js";
import { ruleError, validateWith, type RequestValidation } from "../validate.js";

const num = <T extends z.ZodType>(s: T): T => markNumber(s);
const EwbNo = () => num(z.string().regex(/^\d{12}$/, "e-way bill number: 12 digits"));
const State = () => num(z.string().regex(/^\d{1,2}$/, "state code: 1–2 digits (≤ 99)"));
const VehicleNo = z.string().min(7).max(15);
const Place = z.string().max(50);
const TransDocNo = z.string().max(15);
// The source pattern `[0-3][0-9]/[0-1][0-9]/[2][0][1-2][0-9]` stops at 2029 (as einvoice D2); kept.
const TransDocDate = z
  .string()
  .regex(/^[0-3][0-9]\/[0-1][0-9]\/20[1-2][0-9]$/, "dd/mm/yyyy, 2010–2029");
const Mode14 = z.enum(["1", "2", "3", "4"]);

export const CancelEwbRequestSchema = z.strictObject({
  ewbNo: EwbNo(),
  cancelRsnCode: num(z.enum(EWB_CANCEL_REASON_CODES)),
  // Schema: no limit; data structure: Text(50). The stricter is applied.
  cancelRmrk: z.string().max(50).optional(),
});
export type CancelEwbRequest = z.infer<typeof CancelEwbRequestSchema>;

export const RejectEwbRequestSchema = z.strictObject({ ewbNo: EwbNo() });
export type RejectEwbRequest = z.infer<typeof RejectEwbRequestSchema>;

/** `ewbNo` is missing from the source's `required` and `vehicleType` sits outside `properties` (G7). */
export const UpdateVehicleRequestSchema = z.strictObject({
  ewbNo: EwbNo(),
  vehicleNo: VehicleNo.optional(),
  fromPlace: Place,
  fromState: State(),
  reasonCode: z.enum(EWB_VEHICLE_REASON_CODES),
  reasonRem: z.string().max(50),
  transDocNo: TransDocNo.optional(),
  transDocDate: TransDocDate.optional(),
  transMode: Mode14,
  vehicleType: z.enum(["R", "O"]).optional(),
});
export type UpdateVehicleRequest = z.infer<typeof UpdateVehicleRequestSchema>;

/** The source requires `TransMode` (capital T) but defines `transMode`; `transMode` is required (G7). */
export const ExtendValidityRequestSchema = z.strictObject({
  ewbNo: EwbNo(),
  vehicleNo: VehicleNo.optional(),
  fromPlace: Place,
  fromState: State(),
  remainingDistance: num(z.string().regex(/^\d+$/)),
  transDocNo: TransDocNo.optional(),
  transDocDate: TransDocDate.optional(),
  transMode: z.enum(["1", "2", "3", "4", "5"]),
  extnRsnCode: num(z.enum(EWB_EXTENSION_REASON_CODES)),
  // Schema: string; data structure: "Number … Refer Master". The schema is followed (GD16).
  extnRemarks: z.string(),
  fromPincode: num(z.string().regex(/^\d{6}$/)),
  consignmentStatus: z.enum(["M", "T"]),
  transitType: z.enum(["", "R", "W", "O"]),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  addressLine3: z.string().optional(),
});
export type ExtendValidityRequest = z.infer<typeof ExtendValidityRequestSchema>;

/** `items` is in draft-04 tuple form, which checks only the first element; every element is checked here. */
export const ConsolidatedEwbRequestSchema = z.strictObject({
  fromPlace: Place,
  fromState: State(),
  vehicleNo: VehicleNo.optional(),
  transMode: Mode14,
  transDocNo: TransDocNo.optional(),
  transDocDate: TransDocDate.optional(),
  tripSheetEwbBills: z.array(z.strictObject({ ewbNo: EwbNo() })).min(1),
});
export type ConsolidatedEwbRequest = z.infer<typeof ConsolidatedEwbRequestSchema>;

/**
 * `transporterId` sits outside `properties` and its pattern is unanchored with a literal `|` (G7): anchored, `|`
 * dropped. GSTIN or TRANSIN, pattern only: no check digit (TRANSIN structure is not in sources/).
 */
export const UpdateTransporterRequestSchema = z.strictObject({
  ewbNo: EwbNo(),
  transporterId: z.string().regex(/^[0-9]{2}[0-9A-Z]{13}$/),
});
export type UpdateTransporterRequest = z.infer<typeof UpdateTransporterRequestSchema>;

/** Road ⇒ vehicle number; rail/air/ship ⇒ transport document number (EW-VEH, EW-CEWB, EW-EXT validations). */
function transportRules(v: {
  transMode: string;
  vehicleNo?: string | undefined;
  transDocNo?: string | undefined;
}): GspIssue[] {
  const out: GspIssue[] = [];
  if (v.transMode === "1" && v.vehicleNo === undefined) {
    out.push(ruleError("R-T1", "road transport needs a vehicle number", ["vehicleNo"]));
  }
  if (["2", "3", "4"].includes(v.transMode) && v.transDocNo === undefined) {
    out.push(
      ruleError("R-T2", "rail, air or ship transport needs a transport document number", [
        "transDocNo",
      ]),
    );
  }
  return out;
}

/** EW-EXT: modes 1–4 ⇒ `consignmentStatus` M and `transitType` ""; mode 5 ⇒ T and R / W / O. */
function extendRules(v: ExtendValidityRequest): GspIssue[] {
  const out = transportRules(v);
  if (v.transMode === "5") {
    if (v.consignmentStatus !== "T")
      out.push(
        ruleError("R-X1", "mode 5 (in transit) needs consignmentStatus T", ["consignmentStatus"]),
      );
    if (v.transitType === "")
      out.push(
        ruleError("R-X2", "mode 5 (in transit) needs transitType R, W or O", ["transitType"]),
      );
  } else {
    if (v.consignmentStatus !== "M")
      out.push(ruleError("R-X1", "modes 1–4 need consignmentStatus M", ["consignmentStatus"]));
    if (v.transitType !== "")
      out.push(ruleError("R-X2", 'modes 1–4 need a blank transitType ("")', ["transitType"]));
  }
  return out;
}

export const validateCancelEwbRequest = (input: unknown): RequestValidation<CancelEwbRequest> =>
  validateWith(CancelEwbRequestSchema, input);
export const validateRejectEwbRequest = (input: unknown): RequestValidation<RejectEwbRequest> =>
  validateWith(RejectEwbRequestSchema, input);
export const validateUpdateVehicleRequest = (
  input: unknown,
): RequestValidation<UpdateVehicleRequest> =>
  validateWith(UpdateVehicleRequestSchema, input, transportRules);
export const validateExtendValidityRequest = (
  input: unknown,
): RequestValidation<ExtendValidityRequest> =>
  validateWith(ExtendValidityRequestSchema, input, extendRules);
export const validateConsolidatedEwbRequest = (
  input: unknown,
): RequestValidation<ConsolidatedEwbRequest> =>
  validateWith(ConsolidatedEwbRequestSchema, input, transportRules);
export const validateUpdateTransporterRequest = (
  input: unknown,
): RequestValidation<UpdateTransporterRequest> =>
  validateWith(UpdateTransporterRequestSchema, input);

// Responses (decrypted `data`; samples in each source). Numbers arrive as numbers or strings; kept as strings.
const Digits = z.string().regex(/^\d+$/);
const alert = { alert: z.string().nullable().optional() };

export const UpdateVehicleResponseSchema = z.strictObject({
  vehUpdDate: z.string(),
  validUpto: z.string().nullable(),
  ...alert,
});
export const CancelEwbResponseSchema = z.strictObject({
  ewayBillNo: Digits,
  cancelDate: z.string(),
  ...alert,
});
export const ExtendValidityResponseSchema = z.strictObject({
  ewayBillNo: Digits,
  updatedDate: z.string(),
  validUpto: z.string(),
  ...alert,
});
export const ConsolidatedEwbResponseSchema = z.strictObject({
  cEwbNo: Digits,
  cEWBDate: z.string(),
  ...alert,
});
export const UpdateTransporterResponseSchema = z.strictObject({
  ewayBillNo: Digits,
  transporterId: z.string(),
  transUpdateDate: z.string(),
  ...alert,
});
export const RejectEwbResponseSchema = z.strictObject({
  ewayBillNo: Digits,
  ewbRejectedDate: z.string(),
  ...alert,
});

export type UpdateVehicleResponse = z.infer<typeof UpdateVehicleResponseSchema>;
export type CancelEwbResponse = z.infer<typeof CancelEwbResponseSchema>;
export type ExtendValidityResponse = z.infer<typeof ExtendValidityResponseSchema>;
export type ConsolidatedEwbResponse = z.infer<typeof ConsolidatedEwbResponseSchema>;
export type UpdateTransporterResponse = z.infer<typeof UpdateTransporterResponseSchema>;
export type RejectEwbResponse = z.infer<typeof RejectEwbResponseSchema>;

const EWB_DATE = /^\d{2}\/\d{2}\/\d{4}\s+\d{1,2}[:.]\d{2}:\d{2}(\s+[AP]M)?$/;

/** Warns on response dates that do not look like `dd/MM/yyyy hh:mm:ss AM` (formats vary, GD20). */
export function ewbDateWarnings(
  value: Record<string, unknown>,
  keys: readonly string[],
): GspIssue[] {
  const out: GspIssue[] = [];
  for (const k of keys) {
    const v = value[k];
    if (typeof v === "string" && !EWB_DATE.test(v.trim())) {
      out.push({
        code: "UNUSUAL_DATE",
        severity: "warning",
        message: `${k} "${v}" is not dd/MM/yyyy hh:mm:ss`,
        path: [k],
      });
    }
  }
  return out;
}
