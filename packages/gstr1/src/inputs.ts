// Source: spec docs/specs/gstr1.md §17.2 (Track A2 inputs). The shapes mirror S5 v5.0 (sources/gstr1/gstr1-save-v5.0-schema.json)
//         sections `b2csa`, `nil`, `at`/`txpd`/`ata`/`txpda`, `supeco`/`supecoa`, `ecom`/`ecoma` with neutral names.
//         Every value here is a caller fact: the package never decides taxability, exemption, advances or e-commerce
//         liability (D-A1).
// Retrieved: 2026-10-18
// Status: UNVERIFIED — needs CA
import { z } from "zod";
import { DocumentKindSchema, IsoDateSchema } from "@india-gst-kit/model";
import { ReturnPeriodSchema } from "./types.js";

/** A money string from the caller: at most 2 decimals, optionally negative. Normalised to 2 dp internally. */
export const MoneyInput = z
  .string()
  .regex(/^-?\d{1,16}(\.\d{1,2})?$/, "amount: at most 2 decimals");
/** A rate string from the caller; checked against the GSTR-1 rate list (`RATE_NOT_ACCEPTED`). */
export const RateInput = z.string().regex(/^\d{1,3}(\.\d{1,3})?$/, "rate: a decimal string");
const Code2 = z.string().regex(/^\d{2}$/, "a 2-digit state code");
const Id15 = z.string().length(15);

const HeadsInput = z.strictObject({
  taxableValue: MoneyInput,
  igst: MoneyInput.optional(),
  cgst: MoneyInput.optional(),
  sgst: MoneyInput.optional(),
  cess: MoneyInput,
});

/** Table 10 (spec §17.4): the revised Table 7 row and the row as originally reported. */
export const B2csAmendmentInputSchema = z.strictObject({
  originalPeriod: ReturnPeriodSchema,
  pos: Code2,
  rate: RateInput,
  revised: HeadsInput,
  original: HeadsInput,
});
export type B2csAmendmentInput = z.infer<typeof B2csAmendmentInputSchema>;

/** Table 8 (spec §17.5). */
export const NilRowInputSchema = z.strictObject({
  supply: z.enum([
    "INTER_REGISTERED",
    "INTRA_REGISTERED",
    "INTER_UNREGISTERED",
    "INTRA_UNREGISTERED",
  ]),
  nilRated: MoneyInput,
  exempted: MoneyInput,
  nonGst: MoneyInput,
});
export type NilRowInput = z.infer<typeof NilRowInputSchema>;

/** Table 11 (spec §17.6). */
export const AdvancePartyInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("B2B"),
    recipientGstin: Id15,
    pos: Code2,
    invoiceType: z.enum(["R", "DE", "SEWP", "SEWOP"]),
    reverseCharge: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("B2C"), pos: Code2 }),
  z.strictObject({ kind: z.literal("EXPORT"), exportType: z.enum(["WPAY", "WOPAY"]) }),
]);
export type AdvancePartyInput = z.infer<typeof AdvancePartyInputSchema>;
export const AdvanceRowInputSchema = z.strictObject({
  party: AdvancePartyInputSchema,
  items: z
    .array(
      z.strictObject({
        rate: RateInput,
        amount: MoneyInput,
        igst: MoneyInput.optional(),
        cgst: MoneyInput.optional(),
        sgst: MoneyInput.optional(),
        cess: MoneyInput.optional(),
      }),
    )
    .min(1),
});
export type AdvanceRowInput = z.infer<typeof AdvanceRowInputSchema>;
const AdvanceAmendmentInput = z.strictObject({
  originalPeriod: ReturnPeriodSchema,
  original: AdvancePartyInputSchema,
  revised: AdvanceRowInputSchema,
});
export const AdvancesInputSchema = z.strictObject({
  received: z.array(AdvanceRowInputSchema).optional(),
  adjusted: z.array(AdvanceRowInputSchema).optional(),
  receivedAmendments: z.array(AdvanceAmendmentInput).optional(),
  adjustedAmendments: z.array(AdvanceAmendmentInput).optional(),
});
export type AdvancesInput = z.infer<typeof AdvancesInputSchema>;

/** Tables 4C/5B marks (spec §17.7): a document made through an e-commerce operator attracting TCS. */
export const EcoMarkInputSchema = z.strictObject({
  kind: DocumentKindSchema,
  number: z.string(),
  etin: z.string(),
});
export type EcoMarkInput = z.infer<typeof EcoMarkInputSchema>;

const EcoFlag = z.enum(["N", "E", "D"]);

/** Table 14 / 14A (spec §17.8, §17.21): reported by the supplier. `flag` is caller input, never defaulted. */
const SupecoRowInput = z.strictObject({
  etin: z.string(),
  netValue: MoneyInput,
  igst: MoneyInput,
  cgst: MoneyInput,
  sgst: MoneyInput,
  cess: MoneyInput.optional(),
  flag: EcoFlag.optional(),
});
const SupecoAmendmentInput = z.strictObject({
  ...SupecoRowInput.shape,
  originalEtin: z.string(),
  originalPeriod: ReturnPeriodSchema,
});
export const SupecoInputSchema = z.strictObject({
  collectsTcs: z.array(SupecoRowInput).optional(),
  paysTax95: z.array(SupecoRowInput).optional(),
  collectsTcsAmendments: z.array(SupecoAmendmentInput).optional(),
  paysTax95Amendments: z.array(SupecoAmendmentInput).optional(),
});
export type SupecoInput = z.infer<typeof SupecoInputSchema>;

/** Table 15 / 15A (spec §17.8, §17.21): reported by the operator. `flag` is required caller input. */
const EcomItemInput = z.strictObject({
  rate: RateInput,
  taxableValue: MoneyInput,
  igst: MoneyInput.optional(),
  cgst: MoneyInput.optional(),
  sgst: MoneyInput.optional(),
  cess: MoneyInput.optional(),
});
const ecomDoc = {
  number: z.string(),
  date: IsoDateSchema,
  value: MoneyInput,
  pos: Code2,
  supplyType: z.enum(["INTRA", "INTER"]),
  invoiceType: z.enum(["R", "DE", "SEWP", "SEWOP"]),
  flag: EcoFlag,
  items: z.array(EcomItemInput).min(1),
};
const ecomAmend = { originalNumber: z.string(), originalDate: IsoDateSchema };
const ecomRow = { pos: Code2, supplyType: z.enum(["INTRA", "INTER"]), flag: EcoFlag };
export const EcomInputSchema = z.strictObject({
  b2b: z
    .array(z.strictObject({ supplierGstin: Id15, recipientGstin: Id15, ...ecomDoc }))
    .optional(),
  urp2b: z.array(z.strictObject({ recipientGstin: Id15, ...ecomDoc })).optional(),
  b2c: z
    .array(z.strictObject({ supplierGstin: Id15, ...ecomRow, ...EcomItemInput.shape }))
    .optional(),
  urp2c: z.array(z.strictObject({ ...ecomRow, ...EcomItemInput.shape })).optional(),
  b2ba: z
    .array(z.strictObject({ supplierGstin: Id15, recipientGstin: Id15, ...ecomDoc, ...ecomAmend }))
    .optional(),
  urp2ba: z.array(z.strictObject({ recipientGstin: Id15, ...ecomDoc, ...ecomAmend })).optional(),
  b2ca: z
    .array(
      z.strictObject({
        supplierGstin: Id15,
        originalSupplierGstin: Id15,
        originalPeriod: ReturnPeriodSchema,
        ...ecomRow,
        items: z.array(EcomItemInput).min(1),
      }),
    )
    .optional(),
  urp2ca: z
    .array(
      z.strictObject({
        originalPeriod: ReturnPeriodSchema,
        ...ecomRow,
        items: z.array(EcomItemInput).min(1),
      }),
    )
    .optional(),
});
export type EcomInput = z.infer<typeof EcomInputSchema>;
