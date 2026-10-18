// Source: sources/gstr3b/GSTR3B - Save GSTR3B data request_schema v7.1.json (SV; boxes and signs) and
//         sources/gstr3b/form-gstr3b-excerpt-18052021.txt (FG-3B; row meanings, spec §3.2)
// Retrieved: 2026-10-18
// Status: UNVERIFIED — needs CA
// The ITC and inward rows are keyed by SV's `ty` codes, never by meanings (D-H1). Presumed rows (FG-3B, by SV enum
// order; Q-H1): IMPG 4(A)(1) import of goods, IMPS 4(A)(2) import of services, ISRC 4(A)(3) inward liable to reverse
// charge, ISD 4(A)(4) inward from ISD, OTH 4(A)(5) all other ITC; RUL 4(B)(1)/4(D)(1), OTH 4(B)(2)/4(D)(2);
// GST "composition, exempt and nil rated", NONGST "non GST supply".
import { z } from "zod";
import {
  FilerGstinSchema,
  PeriodSchema,
  Pos3bSchema,
  Signed3bSchema,
  Unsigned3bSchema,
} from "./primitives.js";
import { BoxIdSchema } from "./types.js";

const S = Signed3bSchema;
const U = Unsigned3bSchema;

export const Heads5Schema = z.strictObject({ taxableValue: S, igst: S, cgst: S, sgst: S, cess: S });
export const TaxHeadsSignedSchema = z.strictObject({ igst: S, cgst: S, sgst: S, cess: S });
export const TaxHeadsUnsignedSchema = z.strictObject({ igst: U, cgst: U, sgst: U, cess: U });
export const PosRowSchema = z.strictObject({ pos: Pos3bSchema, taxableValue: S, igst: S });
export type Heads5 = z.infer<typeof Heads5Schema>;
export type TaxHeads = z.infer<typeof TaxHeadsSignedSchema>;
export type PosRow = z.infer<typeof PosRowSchema>;

export const Gstr3bReturnSchema = z.strictObject({
  gstin: FilerGstinSchema,
  period: PeriodSchema,
  t31: z.strictObject({
    a: Heads5Schema,
    b: z.strictObject({ taxableValue: S, igst: S, cess: S }),
    c: z.strictObject({ taxableValue: S }),
    d: Heads5Schema,
    e: z.strictObject({ taxableValue: S }),
  }),
  t311: z.strictObject({ i: Heads5Schema, ii: z.strictObject({ taxableValue: S }) }),
  t32: z.strictObject({
    unregistered: z.array(PosRowSchema),
    composition: z.array(PosRowSchema),
    uinHolders: z.array(PosRowSchema),
  }),
  t4: z.strictObject({
    available: z.strictObject({
      IMPG: TaxHeadsSignedSchema,
      IMPS: TaxHeadsSignedSchema,
      ISRC: TaxHeadsSignedSchema,
      ISD: TaxHeadsSignedSchema,
      OTH: TaxHeadsSignedSchema,
    }),
    reversed: z.strictObject({ RUL: TaxHeadsUnsignedSchema, OTH: TaxHeadsUnsignedSchema }),
    net: TaxHeadsSignedSchema,
    // SV itc_inelg oneOf: RUL is #nonEmptyCost, OTH is #negVal.
    ineligible: z.strictObject({ RUL: TaxHeadsUnsignedSchema, OTH: TaxHeadsSignedSchema }),
  }),
  t5: z.strictObject({
    GST: z.strictObject({ inter: U, intra: U }),
    NONGST: z.strictObject({ inter: U, intra: U }),
  }),
  t51: z.strictObject({ interest: TaxHeadsUnsignedSchema }),
});
export type Gstr3bReturn = z.infer<typeof Gstr3bReturnSchema>;

export const AMOUNT_KEYS = [
  "taxableValue",
  "igst",
  "cgst",
  "sgst",
  "cess",
  "inter",
  "intra",
] as const;
export const AmountKeySchema = z.enum(AMOUNT_KEYS);
export type AmountKey = z.infer<typeof AmountKeySchema>;
export const AmountsSchema = z.partialRecord(AmountKeySchema, Signed3bSchema);
export type Amounts = z.infer<typeof AmountsSchema>;

export const TrailSourceSchema = z.enum(["GSTR1", "GSTR2B_SUM", "CALLER", "COMPUTED"]);
export type TrailSource = z.infer<typeof TrailSourceSchema>;

export const TrailEntrySchema = z.strictObject({
  box: BoxIdSchema,
  pos: z.string().optional(),
  source: TrailSourceSchema,
  ref: z.string(),
  amounts: AmountsSchema,
  documents: z.array(z.strictObject({ section: z.string(), number: z.string() })).optional(),
});
export type TrailEntry = z.infer<typeof TrailEntrySchema>;

export const Gstr3bDraftSchema = z.strictObject({
  return: Gstr3bReturnSchema,
  trail: z.array(TrailEntrySchema),
});
export type Gstr3bDraft = z.infer<typeof Gstr3bDraftSchema>;
