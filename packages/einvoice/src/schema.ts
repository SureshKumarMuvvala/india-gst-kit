// Source: https://einv-apisandbox.nic.in/version1.03/generate-irn.html#JSONSchema (source C) —
//         sources/einvoice/generate-irn-json-schema.json
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
//
// A transcription of every constraint in the published schema (lengths, patterns, enums, min/max, required
// fields) in the schema's own key order. The published schema is not valid draft-07; the quirks below are
// normalised as listed in docs/specs/einvoice.md §4 and checked by test/schema.test.ts:
//   - keys with stray spaces are trimmed (" InvStDt ", "AddlDocDtls ", "Url ", …);
//   - `"type": " number"` (BuyerDtls.Pin) is read as number and `"type": "String"` (Ph) as string;
//   - array-wrapped item schemas (ItemList, AttribDtls, PrecDocDtls, ContrDtls, AddlDocDtls) are arrays of that item;
//   - the `required: ["InvNo","InvDt"]` pseudo-property of RefDtls applies to each PrecDocDtls item;
//   - DocPerdDtls.required applies to InvStDt / InvEndDt.
// Amounts, quantities, rates and PINs are JSON numbers on the wire and strings in memory (spec §2).
import { z } from "zod";
import { D } from "./decimal.js";
import { markNumber } from "@india-gst-kit/model";

export { isNumberLeaf } from "@india-gst-kit/model";

export const IRN_DECIMAL_PATTERN = /^-?(0|[1-9]\d*)(\.\d+)?$/;
export const IRN_INT_PATTERN = /^(0|[1-9]\d*)$/;
/** A JSON number literal as text: no exponent, no leading `+`, no leading zeros. */
export const IrnDecimalSchema = z.string().regex(IRN_DECIMAL_PATTERN);
export const IrnIntSchema = z.string().regex(IRN_INT_PATTERN);

export const TEXT_MESSAGE = "must not contain a backslash (e-invoice validations)";
const QUOTE_MESSAGE = "must not contain a double quote";

// ---- leaf builders ---------------------------------------------------------------------------
function decimalPlaces(s: string): number {
  return s.split(".")[1]?.length ?? 0;
}

/** Number leaf with the source's minimum and maximum; decimal places are capped as the maximum implies. */
function num(min: string, max: string) {
  const dp = decimalPlaces(max);
  const pattern = dp === 0 ? IRN_INT_PATTERN : IRN_DECIMAL_PATTERN;
  const lo = new D(min);
  const hi = new D(max);
  return markNumber(
    z
      .string()
      .regex(pattern, dp === 0 ? "must be a whole number" : "must be a decimal number")
      .refine(
        (s) => {
          if (!pattern.test(s)) return true; // already reported by the pattern
          const v = new D(s);
          return v.gte(lo) && v.lte(hi) && decimalPlaces(s) <= dp;
        },
        `must be between ${min} and ${max}${dp === 0 ? "" : ` with at most ${dp} decimal places`}`,
      ),
  );
}

/** Free text: `^([^\"])*$` in the schema; the validations text also forbids the backslash (spec §10 D6). */
function text(min: number, max: number) {
  return z
    .string()
    .min(min)
    .max(max)
    .regex(/^([^"])*$/, QUOTE_MESSAGE)
    .refine((s) => !s.includes("\\"), TEXT_MESSAGE);
}

const yn = z.enum(["Y", "N"]);
/** `(?i)` patterns are accepted case-insensitively, as published, and normalised to upper case. */
function ci<const T extends [string, ...string[]]>(values: T) {
  return z
    .string()
    .transform((s) => s.toUpperCase())
    .pipe(z.enum(values));
}

const date = () =>
  z
    .string()
    .min(10)
    .max(10)
    .regex(/^[0-3][0-9]\/[0-1][0-9]\/[2][0][1-2][0-9]$/);
const stateCode = () =>
  z
    .string()
    .min(1)
    .max(2)
    .regex(/^(?!0+$)([0-9]{1,2})$/);
const gstin = () =>
  z
    .string()
    .min(15)
    .max(15)
    .regex(/^([0-9]{2}[0-9A-Z]{13})$/);
const gstinOrUrp = () =>
  z
    .string()
    .min(3)
    .max(15)
    .regex(/^(([0-9]{2}[0-9A-Z]{13})|URP)$/);
const pin = () => num("100000", "999999");
const phone = () =>
  z
    .string()
    .min(6)
    .max(12)
    .regex(/^([0-9]{6,12})$/);
const email = () =>
  z
    .string()
    .min(6)
    .max(100)
    .regex(/^[a-zA-Z0-9+_.-]+@[a-zA-Z0-9.-]+$/);

const MONEY_MAX = "999999999999.99";
const DOC_MAX = "99999999999999.99";

// ---- blocks ----------------------------------------------------------------------------------
export const TranDtlsSchema = z.strictObject({
  TaxSch: z.enum(["GST"]),
  SupTyp: ci(["B2B", "SEZWP", "SEZWOP", "EXPWP", "EXPWOP", "DEXP"]),
  RegRev: yn.optional(),
  EcmGstin: gstin().optional(),
  IgstOnIntra: yn.optional(),
});

export const DocDtlsSchema = z.strictObject({
  Typ: ci(["INV", "CRN", "DBN"]),
  No: z
    .string()
    .min(1)
    .max(16)
    .regex(/^([a-zA-Z1-9]{1}[a-zA-Z0-9/-]{0,15})$/),
  Dt: date(),
});

export const SellerDtlsSchema = z.strictObject({
  Gstin: gstin(),
  LglNm: text(3, 100),
  TrdNm: text(3, 100).optional(),
  Addr1: text(1, 100),
  Addr2: text(3, 100).optional(),
  Loc: text(3, 50),
  Pin: pin(),
  Stcd: stateCode(),
  Ph: phone().optional(),
  Em: email().optional(),
});

export const BuyerDtlsSchema = z.strictObject({
  Gstin: gstinOrUrp(),
  LglNm: text(3, 100),
  TrdNm: text(3, 100).optional(),
  Pos: stateCode(),
  Addr1: text(1, 100),
  Addr2: text(3, 100).optional(),
  Loc: text(3, 100),
  Pin: pin().optional(),
  Stcd: stateCode(),
  Ph: phone().optional(),
  Em: email().optional(),
});

export const DispDtlsSchema = z.strictObject({
  Nm: text(3, 100),
  Addr1: text(1, 100),
  Addr2: text(3, 100).optional(),
  Loc: text(3, 100),
  Pin: pin(),
  Stcd: stateCode(),
});

export const ShipDtlsSchema = z.strictObject({
  Gstin: gstinOrUrp().optional(),
  LglNm: text(3, 100),
  TrdNm: text(3, 100).optional(),
  Addr1: text(1, 100),
  Addr2: text(3, 100).optional(),
  Loc: text(3, 100),
  Pin: pin(),
  Stcd: stateCode(),
});

export const BchDtlsSchema = z.strictObject({
  Nm: text(3, 20),
  ExpDt: date().optional(),
  WrDt: date().optional(),
});

export const AttribDtlsItemSchema = z.strictObject({
  Nm: text(1, 100).optional(),
  Val: text(1, 100).optional(),
});

export const ItemSchema = z.strictObject({
  SlNo: z
    .string()
    .min(1)
    .max(6)
    .regex(/^([0-9]{1,6})$/),
  PrdDesc: text(3, 300).optional(),
  IsServc: yn,
  HsnCd: z
    .string()
    .min(4)
    .max(8)
    .regex(/^(?!0+$)([0-9]{4}|[0-9]{6}|[0-9]{8})$/),
  Barcde: text(3, 30).optional(),
  Qty: num("0", "9999999999.999").optional(),
  FreeQty: num("0", "9999999999.999").optional(),
  Unit: z
    .string()
    .min(3)
    .max(8)
    .regex(/^([A-Z|a-z]{3,8})$/)
    .optional(),
  UnitPrice: num("0", "999999999999.999"),
  TotAmt: num("0", MONEY_MAX),
  Discount: num("0", MONEY_MAX).optional(),
  PreTaxVal: num("0", MONEY_MAX).optional(),
  AssAmt: num("0", MONEY_MAX),
  GstRt: num("0", "999.999"),
  IgstAmt: num("0", MONEY_MAX).optional(),
  CgstAmt: num("0", MONEY_MAX).optional(),
  SgstAmt: num("0", MONEY_MAX).optional(),
  CesRt: num("0", "999.999").optional(),
  CesAmt: num("0", MONEY_MAX).optional(),
  CesNonAdvlAmt: num("0", MONEY_MAX).optional(),
  StateCesRt: num("0", "999.999").optional(),
  StateCesAmt: num("0", MONEY_MAX).optional(),
  StateCesNonAdvlAmt: num("0", MONEY_MAX).optional(),
  OthChrg: num("0", MONEY_MAX).optional(),
  TotItemVal: num("0", MONEY_MAX),
  OrdLineRef: text(1, 50).optional(),
  OrgCntry: z
    .string()
    .min(2)
    .max(2)
    .regex(/^([A-Z|a-z]{2})$/)
    .optional(),
  PrdSlNo: text(1, 20).optional(),
  BchDtls: BchDtlsSchema.optional(),
  AttribDtls: z.array(AttribDtlsItemSchema).optional(),
});

export const ValDtlsSchema = z.strictObject({
  AssVal: num("0", DOC_MAX),
  CgstVal: num("0", DOC_MAX).optional(),
  SgstVal: num("0", DOC_MAX).optional(),
  IgstVal: num("0", DOC_MAX).optional(),
  CesVal: num("0", DOC_MAX).optional(),
  StCesVal: num("0", DOC_MAX).optional(),
  Discount: num("0", DOC_MAX).optional(),
  OthChrg: num("0", DOC_MAX).optional(),
  RndOffAmt: num("-99.99", "99.99").optional(),
  TotInvVal: num("0", DOC_MAX),
  TotInvValFc: num("0", DOC_MAX).optional(),
});

export const PayDtlsSchema = z.strictObject({
  Nm: text(1, 100).optional(),
  AccDet: text(1, 18).optional(),
  Mode: text(1, 18).optional(),
  FinInsBr: text(1, 11).optional(),
  PayTerm: text(1, 100).optional(),
  PayInstr: text(1, 100).optional(),
  CrTrn: text(1, 100).optional(),
  DirDr: text(1, 100).optional(),
  CrDay: num("0", "9999").optional(),
  PaidAmt: num("0", DOC_MAX).optional(),
  PaymtDue: num("0", DOC_MAX).optional(),
});

export const DocPerdDtlsSchema = z.strictObject({ InvStDt: date(), InvEndDt: date() });
export const PrecDocDtlsItemSchema = z.strictObject({
  InvNo: z
    .string()
    .min(1)
    .max(16)
    .regex(/^[1-9a-zA-Z]{1}[0-9a-zA-Z/-]{1,15}$/),
  InvDt: date(),
  OthRefNo: text(1, 20).optional(),
});
export const ContrDtlsItemSchema = z.strictObject({
  RecAdvRefr: text(1, 20).optional(),
  RecAdvDt: date().optional(),
  TendRefr: text(1, 20).optional(),
  ContrRefr: text(1, 20).optional(),
  ExtRefr: text(1, 20).optional(),
  ProjRefr: text(1, 20).optional(),
  PORefr: text(1, 16).optional(),
  PORefDt: date().optional(),
});
export const RefDtlsSchema = z.strictObject({
  InvRm: text(3, 100).optional(),
  DocPerdDtls: DocPerdDtlsSchema.optional(),
  PrecDocDtls: z.array(PrecDocDtlsItemSchema).optional(),
  ContrDtls: z.array(ContrDtlsItemSchema).optional(),
});

export const AddlDocDtlsItemSchema = z.strictObject({
  Url: text(3, 100).optional(),
  Docs: text(3, 1000).optional(),
  Info: text(3, 1000).optional(),
});

export const ExpDtlsSchema = z.strictObject({
  ShipBNo: text(1, 20).optional(),
  ShipBDt: date().optional(),
  Port: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[0-9|A-Z|a-z]{2,10}$/)
    .optional(),
  RefClm: z
    .string()
    .min(1)
    .max(1)
    .regex(/^([Y|N]{1})$/)
    .optional(),
  ForCur: z
    .string()
    .min(3)
    .max(16)
    .regex(/^[A-Z|a-z]{3,16}$/)
    .optional(),
  CntCode: z
    .string()
    .min(2)
    .max(2)
    .regex(/^([A-Z]{2})$/)
    .optional(),
  ExpDuty: num("0", "999999999999.99").optional(),
});

export const EwbDtlsSchema = z.strictObject({
  TransId: z
    .string()
    .min(15)
    .max(15)
    .regex(/^([0-9]{2}[0-9A-Z]{13})$/)
    .optional(),
  TransName: text(3, 100).optional(),
  TransMode: z.enum(["1", "2", "3", "4"]).optional(),
  Distance: num("0", "4000"),
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
    .regex(/^([A-Z|a-z|0-9]{4,20})$/)
    .optional(),
  VehType: z.enum(["O", "R"]).optional(),
});

export const IrnRequestSchema = z.strictObject({
  Version: z.string().min(1).max(6),
  Irn: z.string().min(64).max(64).optional(),
  TranDtls: TranDtlsSchema,
  DocDtls: DocDtlsSchema,
  SellerDtls: SellerDtlsSchema,
  BuyerDtls: BuyerDtlsSchema,
  DispDtls: DispDtlsSchema.optional(),
  ShipDtls: ShipDtlsSchema.optional(),
  ItemList: z.array(ItemSchema),
  ValDtls: ValDtlsSchema,
  PayDtls: PayDtlsSchema.optional(),
  RefDtls: RefDtlsSchema.optional(),
  AddlDocDtls: z.array(AddlDocDtlsItemSchema).optional(),
  ExpDtls: ExpDtlsSchema.optional(),
  EwbDtls: EwbDtlsSchema.optional(),
});

export type IrnRequest = z.infer<typeof IrnRequestSchema>;
export type IrnItem = z.infer<typeof ItemSchema>;
