// Source: https://docs.ewaybillgst.gov.in/apidocs/version1.03/generate-eway-bill.html#JSONSchema (source H) —
//         sources/ewaybill/generate-ewaybill-schema.json;
//         https://einv-apisandbox.nic.in/version1.03/ewaybill-generation-irn.html#JSONSchema (source I) —
//         sources/ewaybill/ewb-by-irn-schema.json
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
//
// A transcription of every constraint in the two published schemas, in their key order. Quirks, normalised as
// in docs/specs/ewaybill.md §7 and asserted by test/conformance.test.ts:
//   H  - GSTIN patterns are unanchored and contain a literal `|` in the class: read as ^[0-9]{2}[0-9A-Z]{13}$,
//        and fromGstin/toGstin additionally accept exactly "URP" (overrides minLength 15, §13 D2);
//   H  - the docDate pattern is unanchored: anchored, year part 20[1-2][0-9] kept (§13 D3);
//   H  - `itemList.items: [ {…} ]` (array form) is read as "every item";
//   H  - optional strings equal to "" count as absent (decision D-M4; see dropEmptyStrings in json.ts);
//   I  - properties sit at the top level beside `$schema` and `required`: read as one object schema;
//   I  - `[A-Z|a-z|0-9]` and `[O|R]` are read without `|` (VehType: the enum applies);
//   I  - `Distance` and `Pin` (type number, whole-number bounds) are read as whole numbers, like source C.
// Numbers are JSON numbers on the wire and strings in memory (spec §2). A string-typed JSON field
// (transDistance, transMode, subSupplyType, Stcd) is an ordinary z.string().
import { z } from "zod";
import { markNumber } from "@india-gst-kit/model";
import { IrnRequestSchema } from "@india-gst-kit/einvoice";
import { D } from "./decimal.js";

export { isNumberLeaf } from "@india-gst-kit/model";

/** A JSON number literal as text: no exponent, no leading `+`, no leading zeros (so it is always writable). */
export const EWB_DECIMAL_PATTERN = /^-?(0|[1-9]\d*)(\.\d+)?$/;
export const EWB_INT_PATTERN = /^(0|[1-9]\d*)$/;
export const EwbDecimalSchema = z.string().regex(EWB_DECIMAL_PATTERN);
export const EwbIntSchema = z.string().regex(EWB_INT_PATTERN);

/** Message for a number with more decimal places than `multipleOf` allows; reported as rule V-G13. */
export const dpMessage = (dp: number): string =>
  `must have at most ${dp} decimal places (multipleOf ${dp === 2 ? "0.01" : "0.001"})`;

const places = (s: string): number => s.split(".")[1]?.length ?? 0;

/** Integer leaf with optional bounds. */
function int(min?: number, max?: number) {
  return markNumber(
    z
      .string()
      .regex(EWB_INT_PATTERN, "must be a whole number")
      .refine(
        (s) =>
          !EWB_INT_PATTERN.test(s) ||
          ((min === undefined || new D(s).gte(min)) && (max === undefined || new D(s).lte(max))),
        `must be between ${min ?? "-∞"} and ${max ?? "∞"}`,
      ),
  );
}

/** Number leaf without bounds. */
const decimal = () => markNumber(EwbDecimalSchema);

/** `multipleOf 0.01` / `0.001`: at most `dp` decimal places. */
function multiple(dp: 2 | 3) {
  return markNumber(
    EwbDecimalSchema.refine((s) => !EWB_DECIMAL_PATTERN.test(s) || places(s) <= dp, dpMessage(dp)),
  );
}
const money = () => multiple(2);
const rate = () => multiple(3);

const GSTIN_RE = /^[0-9]{2}[0-9A-Z]{13}$/;
const gstinOrUrp = () => z.string().regex(/^(?:[0-9]{2}[0-9A-Z]{13}|URP)$/);

const ISSUE_ENUM = (values: [string, ...string[]], message: string) =>
  z.enum(values, { error: message });
export const SUPPLY_TYPE_MESSAGE = "supplyType must be O or I";
export const DOC_TYPE_MESSAGE = "docType must be one of INV, CHL, BIL, BOE, OTH";

// ---- H: Generate E-way Bill --------------------------------------------------------------------
export const EwbItemSchema = z.strictObject({
  productName: z.string().max(100).optional(),
  productDesc: z.string().max(100).optional(),
  hsnCode: decimal(),
  quantity: decimal().optional(),
  qtyUnit: z.string().min(3).max(3).optional(),
  taxableAmount: money(),
  sgstRate: rate().optional(),
  cgstRate: rate().optional(),
  igstRate: rate().optional(),
  cessRate: rate().optional(),
  cessNonadvol: decimal().optional(),
});

export const EwbRequestSchema = z.strictObject({
  supplyType: ISSUE_ENUM(["O", "I"], SUPPLY_TYPE_MESSAGE),
  subSupplyType: z.string(),
  subSupplyDesc: z.string().max(20).optional(),
  docType: ISSUE_ENUM(["INV", "CHL", "BIL", "BOE", "OTH"], DOC_TYPE_MESSAGE),
  docNo: z.string().max(16),
  docDate: z.string().regex(/^[0-3][0-9]\/[0-1][0-9]\/20[1-2][0-9]$/),
  fromGstin: gstinOrUrp(),
  fromTrdName: z.string().max(100).optional(),
  fromAddr1: z.string().max(120).optional(),
  fromAddr2: z.string().max(120).optional(),
  fromPlace: z.string().max(50).optional(),
  actFromStateCode: int(undefined, 99),
  fromPincode: int(100000, 999999),
  fromStateCode: int(undefined, 99),
  toGstin: gstinOrUrp(),
  toTrdName: z.string().max(100).optional(),
  toAddr1: z.string().max(120).optional(),
  toAddr2: z.string().max(120).optional(),
  toPlace: z.string().max(50).optional(),
  toPincode: int(),
  actToStateCode: int(undefined, 99),
  toStateCode: int(undefined, 99),
  transactionType: int(undefined, 4),
  totalValue: money().optional(),
  cgstValue: money().optional(),
  sgstValue: money().optional(),
  igstValue: money().optional(),
  cessValue: money().optional(),
  cessNonAdvolValue: money().optional(),
  otherValue: money().optional(),
  totInvValue: money(),
  transMode: z.enum(["1", "2", "3", "4"]).optional(),
  transDistance: z.string(),
  transporterName: z.string().max(100).optional(),
  transporterId: z.string().regex(GSTIN_RE).optional(),
  transDocNo: z.string().max(15).optional(),
  transDocDate: z.string().optional(),
  vehicleNo: z.string().min(7).max(15).optional(),
  vehicleType: z.string().optional(),
  itemList: z.array(EwbItemSchema),
});

/** Optional string fields of H that count as absent when `""` (decision D-M4). */
export const EMPTY_AS_ABSENT = [
  "transporterName",
  "transporterId",
  "transDocNo",
  "transDocDate",
  "vehicleNo",
  "vehicleType",
  "subSupplyDesc",
] as const;

// ---- I: EWB by IRN -----------------------------------------------------------------------------
const noQuote = /^([^"])*$/;
const text = (min: number, max: number) => z.string().min(min).max(max).regex(noQuote);
const stcd = () =>
  z
    .string()
    .min(1)
    .max(2)
    .regex(/^(?!0+$)([0-9]{1,2})$/);
const pin = () => int(100000, 999999);

export const ExpShipDtlsSchema = z.strictObject({
  Addr1: text(3, 100),
  Addr2: text(3, 100).optional(),
  Loc: text(3, 100),
  Pin: pin(),
  Stcd: stcd(),
});

export const DispDtlsSchema = z.strictObject({
  Nm: text(3, 100),
  Addr1: text(1, 100),
  Addr2: text(3, 100).optional(),
  Loc: text(3, 100),
  Pin: pin(),
  Stcd: stcd(),
});

export const EwbByIrnRequestSchema = z.strictObject({
  Irn: z.string().min(64).max(64).optional(),
  TransId: z.string().min(15).max(15).regex(GSTIN_RE).optional(),
  TransName: text(3, 100).optional(),
  TransMode: z.enum(["1", "2", "3", "4"]).optional(),
  Distance: int(0, 4000),
  TransDocNo: z
    .string()
    .min(1)
    .max(15)
    .regex(/^([a-zA-Z0-9/-]{1,15})$/)
    .optional(),
  TransDocDt: z
    .string()
    .min(10)
    .max(10)
    .regex(/^[a-zA-Z0-9]{1}[a-zA-Z0-9-/]*$/)
    .optional(),
  VehNo: z
    .string()
    .min(4)
    .max(20)
    .regex(/^([A-Za-z0-9]{4,20})$/)
    .optional(),
  VehType: z.enum(["O", "R"]).optional(),
  ExpShipDtls: ExpShipDtlsSchema.optional(),
  DispDtls: DispDtlsSchema.optional(),
});

/** The `EwbDtls` block of an IRN request (source C), taken from `@india-gst-kit/einvoice`. */
export const EwbDtlsSchema = IrnRequestSchema.shape.EwbDtls.unwrap();

export type EwbItem = z.infer<typeof EwbItemSchema>;
export type EwbRequest = z.infer<typeof EwbRequestSchema>;
export type EwbByIrnRequest = z.infer<typeof EwbByIrnRequestSchema>;
export type EwbDtls = z.infer<typeof EwbDtlsSchema>;
