import { z } from "zod";
import { DocumentKindSchema, IsoDateSchema } from "@india-gst-kit/model";
import { Gstr2bRecordSchema } from "./schema.js";
import { ReconIssueSchema } from "./types.js";

const PathSchema = z.array(z.union([z.string(), z.number()]));

export const RegisterRefSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  supplierGstin: z.string(),
  kind: DocumentKindSchema,
  number: z.string(),
  date: IsoDateSchema,
});
export const Gstr2bRefSchema = z.strictObject({ returnPeriod: z.string(), path: PathSchema });

export const AMOUNT_FIELDS = ["value", "taxableValue", "igst", "cgst", "sgst", "cess"] as const;
export const AmountFieldSchema = z.enum(AMOUNT_FIELDS);
export const DifferenceFieldSchema = z.enum([
  ...AMOUNT_FIELDS,
  "placeOfSupply",
  "reverseCharge",
  "number",
  "date",
  "documentType",
]);

/** `difference` (gstr2b − register, signed, 2 dp) exists for the amount fields only. */
export const DifferenceSchema = z.strictObject({
  field: DifferenceFieldSchema,
  register: z.string(),
  gstr2b: z.string(),
  difference: z.string().optional(),
});

export const PossibleReasonSchema = z.enum([
  "AMENDED_FROM",
  "DATE_DIFFERS",
  "TYPE_DIFFERS",
  "NUMBER_DIFFERS",
  "NUMBER_LOOSE",
]);

export const PairSchema = z.strictObject({
  register: RegisterRefSchema,
  gstr2b: Gstr2bRecordSchema,
  differences: z.array(DifferenceSchema),
});

export const ReconResultSchema = z.strictObject({
  matched: z.array(PairSchema),
  matchedWithDifferences: z.array(PairSchema),
  possibleMatches: z.array(PairSchema.extend({ reasons: z.array(PossibleReasonSchema).min(1) })),
  in2bOnly: z.array(
    z.strictObject({ record: Gstr2bRecordSchema, candidates: z.array(RegisterRefSchema) }),
  ),
  inRegisterOnly: z.array(
    z.strictObject({ register: RegisterRefSchema, candidates: z.array(Gstr2bRefSchema) }),
  ),
  excluded: z.array(
    z.strictObject({
      register: RegisterRefSchema,
      reason: z.enum(["NOT_OUR_PURCHASE", "KIND_NOT_IN_2B_SECTIONS"]),
    }),
  ),
  issues: z.array(ReconIssueSchema),
  options: z.strictObject({ amountTolerance: z.string() }),
});

export type RegisterRef = z.infer<typeof RegisterRefSchema>;
export type Gstr2bRef = z.infer<typeof Gstr2bRefSchema>;
export type Difference = z.infer<typeof DifferenceSchema>;
export type PossibleReason = z.infer<typeof PossibleReasonSchema>;
export type Pair = z.infer<typeof PairSchema>;
export type ReconResult = z.infer<typeof ReconResultSchema>;
export type AmountField = z.infer<typeof AmountFieldSchema>;
