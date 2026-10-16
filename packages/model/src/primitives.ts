import { z } from "zod";
import { isValidGstin } from "./gstin.js";
import { isPlaceOfSupplyCode, isStateCode } from "./states.js";
import { isUqcCode } from "./uqc.js";

// Money-like values are strings so floats never touch them (docs/specs/model.md §3).
export const MoneySchema = z
  .string()
  .regex(
    /^\d{1,15}\.\d{2}$/,
    "Money must be a non-negative decimal string with exactly 2 decimals",
  );
export const SignedMoneySchema = z
  .string()
  .regex(/^-?\d{1,15}\.\d{2}$/, "SignedMoney must be a decimal string with exactly 2 decimals");

// Source C (e-invoice schema): Qty ≤ 9999999999.999, UnitPrice ≤ 999999999999.999, GstRt/CesRt 0–999.999.
export const QuantitySchema = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,3})?$/, "Quantity: up to 10 integer digits and 3 decimals")
  .refine((s) => /[1-9]/.test(s), "Quantity must be greater than zero");
export const UnitPriceSchema = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,3})?$/, "UnitPrice: up to 12 integer digits and 3 decimals");
export const GstRateSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,2})(\.\d{1,3})?$/,
    "Rate: 0–999.999 with up to 3 decimals, no leading zeros",
  );
export const CessRateSchema = GstRateSchema;

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((s) => {
    const [y = 0, m = 0, d = 0] = s.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }, "Not a real calendar date");

export const StateCodeSchema = z
  .string()
  .refine(isStateCode, "Unknown state code (2 digits, see STATE_CODES)");
export const PlaceOfSupplySchema = StateCodeSchema.refine(
  isPlaceOfSupplyCode,
  "State code 25 is withdrawn as a place of supply",
);
export const GstinSchema = z
  .string()
  .refine(isValidGstin, "Invalid GSTIN (pattern, state code or check digit)");
export const HsnSacSchema = z
  .string()
  .regex(/^(?!0+$)(\d{4}|\d{6}|\d{8})$/, "HSN/SAC must be 4, 6 or 8 digits");
export const UqcCodeSchema = z.string().refine(isUqcCode, "Not an official unit quantity code");
// Source C `Doc.No`: ^[a-zA-Z1-9][a-zA-Z0-9/-]{0,15}$ — max 16, not starting with 0, / or -.
export const DocumentNumberSchema = z
  .string()
  .regex(
    /^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$/,
    "Document number: 1–16 of [A-Za-z0-9/-], not starting with 0, / or -",
  );

export type Money = z.infer<typeof MoneySchema>;
export type SignedMoney = z.infer<typeof SignedMoneySchema>;
export type Quantity = z.infer<typeof QuantitySchema>;
export type UnitPrice = z.infer<typeof UnitPriceSchema>;
export type GstRate = z.infer<typeof GstRateSchema>;
export type IsoDate = z.infer<typeof IsoDateSchema>;
export type { StateCode } from "./states.js";
export type Gstin = z.infer<typeof GstinSchema>;
export type HsnSac = z.infer<typeof HsnSacSchema>;
export type UqcCode = z.infer<typeof UqcCodeSchema>;

export const DocumentKindSchema = z.enum([
  "TAX_INVOICE",
  "BILL_OF_SUPPLY",
  "CREDIT_NOTE",
  "DEBIT_NOTE",
]);
export const RegistrationTypeSchema = z.enum([
  "REGULAR",
  "COMPOSITION",
  "UNREGISTERED",
  "SEZ_UNIT",
  "SEZ_DEVELOPER",
  "OVERSEAS",
]);
export const SupplyCategorySchema = z.enum([
  "DOMESTIC",
  "SEZ_WITH_PAYMENT",
  "SEZ_WITHOUT_PAYMENT",
  "EXPORT_WITH_PAYMENT",
  "EXPORT_WITHOUT_PAYMENT",
  "DEEMED_EXPORT",
]);
export const TaxSplitSchema = z.enum(["INTRA", "INTER"]);
export const SplitConventionSchema = z.enum(["remainder-to-sgst", "equal-halves"]);

export type DocumentKind = z.infer<typeof DocumentKindSchema>;
export type RegistrationType = z.infer<typeof RegistrationTypeSchema>;
export type SupplyCategory = z.infer<typeof SupplyCategorySchema>;
export type TaxSplit = z.infer<typeof TaxSplitSchema>;
export type SplitConvention = z.infer<typeof SplitConventionSchema>;
