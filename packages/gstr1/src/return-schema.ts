import { z } from "zod";
import { IsoDateSchema } from "@india-gst-kit/model";
import { DocIssueEntrySchema } from "./doc-issue.js";
import { ReturnPeriodSchema } from "./types.js";

// The internal GSTR-1 structure: neutral names, decimal strings, document kinds as enums. It holds no
// schema-version-specific encoding (no doc_det vs doc_det_new, no string vs integer doc_num, no header literals).

/** A decimal string with exactly 2 decimals (signed: b2cs and hsn rows can be negative). */
const Amount = z.string().regex(/^-?\d{1,16}\.\d{2}$/, "amount: a decimal string with 2 decimals");
/** A rate without trailing zeros, at most 2 decimals. */
const Rate = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "rate: at most 2 decimals, no trailing zeros");
const Pos = z.string().regex(/^\d{2}$/);
const Gstin = z.string().length(15);

export const InvoiceTypeSchema = z.enum(["R", "DE", "SEWP", "SEWOP"]);
export type InvoiceType = z.infer<typeof InvoiceTypeSchema>;
export const NoteTypeSchema = z.enum(["C", "D"]);
export const SupplyTypeSchema = z.enum(["INTRA", "INTER"]);

/** Per-rate item of an invoice or note. Intra-state items carry cgst+sgst, inter-state items igst. */
export const ItemSchema = z.strictObject({
  rate: Rate,
  taxableValue: Amount,
  igst: Amount.optional(),
  cgst: Amount.optional(),
  sgst: Amount.optional(),
  cess: Amount,
});
export type Item = z.infer<typeof ItemSchema>;

export const ExportItemSchema = z.strictObject({
  rate: Rate,
  taxableValue: Amount,
  igst: Amount,
  cess: Amount,
});

const documentShape = {
  number: z.string(),
  date: IsoDateSchema,
  value: Amount,
};

/** E-commerce operator GSTIN of a marked invoice (spec §17.7); written to output (b) only. */
const Etin = z.string().length(15);

export const B2bInvoiceSchema = z.strictObject({
  ...documentShape,
  pos: Pos,
  reverseCharge: z.boolean(),
  invoiceType: InvoiceTypeSchema,
  etin: Etin.optional(),
  items: z.array(ItemSchema).min(1),
});
export const B2bGroupSchema = z.strictObject({
  ctin: Gstin,
  invoices: z.array(B2bInvoiceSchema).min(1),
});

export const B2clInvoiceSchema = z.strictObject({
  ...documentShape,
  etin: Etin.optional(),
  items: z.array(ItemSchema).min(1),
});
export const B2clGroupSchema = z.strictObject({
  pos: Pos,
  invoices: z.array(B2clInvoiceSchema).min(1),
});

export const B2csRowSchema = z.strictObject({
  supplyType: SupplyTypeSchema,
  pos: Pos,
  rate: Rate,
  taxableValue: Amount,
  igst: Amount.optional(),
  cgst: Amount.optional(),
  sgst: Amount.optional(),
  cess: Amount,
});

export const CdnrNoteSchema = z.strictObject({
  ...documentShape,
  noteType: NoteTypeSchema,
  pos: Pos,
  reverseCharge: z.boolean(),
  invoiceType: InvoiceTypeSchema,
  items: z.array(ItemSchema).min(1),
});
export const CdnrGroupSchema = z.strictObject({
  ctin: Gstin,
  notes: z.array(CdnrNoteSchema).min(1),
});

export const CdnurNoteSchema = z.strictObject({
  ...documentShape,
  noteType: NoteTypeSchema,
  type: z.enum(["B2CL", "EXPWP", "EXPWOP"]),
  pos: Pos.optional(),
  items: z.array(ItemSchema).min(1),
});

export const ExpInvoiceSchema = z.strictObject({
  ...documentShape,
  items: z.array(ExportItemSchema).min(1),
});
export const ExpGroupSchema = z.strictObject({
  exportType: z.enum(["WPAY", "WOPAY"]),
  invoices: z.array(ExpInvoiceSchema).min(1),
});

export const HsnRowSchema = z.strictObject({
  code: z.string().regex(/^\d{4,8}$/),
  uqc: z.string().min(1),
  quantity: z.string().regex(/^-?\d{1,16}(\.\d{1,3})?$/),
  rate: Rate,
  taxableValue: Amount,
  igst: Amount,
  cgst: Amount,
  sgst: Amount,
  cess: Amount,
});
export type HsnRow = z.infer<typeof HsnRowSchema>;

// ---- Track A2 (spec §17): every key below is optional, so a v0.1 return still parses. ----

/**
 * The original of a 9A/9C amendment as the caller supplied it, kept for `gstr3b` (revised − original, D-A12).
 * Never emitted by either output.
 */
export const AmendmentOriginalSchema = z.strictObject({
  number: z.string(),
  date: IsoDateSchema,
  period: ReturnPeriodSchema,
  pos: Pos.optional(),
  reverseCharge: z.boolean().optional(),
  invoiceType: InvoiceTypeSchema.optional(),
  noteType: NoteTypeSchema.optional(),
  type: z.enum(["B2CL", "EXPWP", "EXPWOP"]).optional(),
  exportType: z.enum(["WPAY", "WOPAY"]).optional(),
  items: z.array(ItemSchema).min(1),
});
export type AmendmentOriginal = z.infer<typeof AmendmentOriginalSchema>;
const amended = { original: AmendmentOriginalSchema };

export const B2baGroupSchema = z.strictObject({
  ctin: Gstin,
  invoices: z.array(z.strictObject({ ...B2bInvoiceSchema.shape, ...amended })).min(1),
});
/** Grouped by the **original** place of supply (S5 `b2cla[].pos`; C `b2cla.csv`). */
export const B2claGroupSchema = z.strictObject({
  pos: Pos,
  invoices: z.array(z.strictObject({ ...B2clInvoiceSchema.shape, ...amended })).min(1),
});
export const ExpaGroupSchema = z.strictObject({
  exportType: z.enum(["WPAY", "WOPAY"]),
  invoices: z.array(z.strictObject({ ...ExpInvoiceSchema.shape, ...amended })).min(1),
});
export const CdnraGroupSchema = z.strictObject({
  ctin: Gstin,
  notes: z.array(z.strictObject({ ...CdnrNoteSchema.shape, ...amended })).min(1),
});
export const CdnuraNoteSchema = z.strictObject({ ...CdnurNoteSchema.shape, ...amended });

/** Tax heads of a caller-supplied row (Tables 10, 11). Amounts may be negative where S5 allows it. */
export const HeadsSchema = z.strictObject({
  taxableValue: Amount,
  igst: Amount.optional(),
  cgst: Amount.optional(),
  sgst: Amount.optional(),
  cess: Amount,
});
export type Heads = z.infer<typeof HeadsSchema>;

/** Table 10: one revised Table 7 row and the row as first reported (spec §17.4, D-A4). */
export const B2csaRowSchema = z.strictObject({
  originalPeriod: ReturnPeriodSchema,
  supplyType: SupplyTypeSchema,
  pos: Pos,
  rate: Rate,
  revised: HeadsSchema,
  original: HeadsSchema,
});
export type B2csaRow = z.infer<typeof B2csaRowSchema>;

export const NilSupplySchema = z.enum([
  "INTER_REGISTERED",
  "INTRA_REGISTERED",
  "INTER_UNREGISTERED",
  "INTRA_UNREGISTERED",
]);
export const NilRowSchema = z.strictObject({
  supply: NilSupplySchema,
  nilRated: Amount,
  exempted: Amount,
  nonGst: Amount,
});
export type NilRow = z.infer<typeof NilRowSchema>;

export const AdvancePartySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("B2B"),
    recipientGstin: Gstin,
    pos: Pos,
    invoiceType: InvoiceTypeSchema,
    reverseCharge: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("B2C"), pos: Pos }),
  z.strictObject({ kind: z.literal("EXPORT"), exportType: z.enum(["WPAY", "WOPAY"]) }),
]);
export type AdvanceParty = z.infer<typeof AdvancePartySchema>;
export const AdvanceItemSchema = z.strictObject({
  rate: Rate,
  amount: Amount,
  igst: Amount.optional(),
  cgst: Amount.optional(),
  sgst: Amount.optional(),
  cess: Amount,
});
export type AdvanceItem = z.infer<typeof AdvanceItemSchema>;
export const AdvanceRowSchema = z.strictObject({
  party: AdvancePartySchema,
  supplyType: SupplyTypeSchema,
  items: z.array(AdvanceItemSchema).min(1),
});
export type AdvanceRow = z.infer<typeof AdvanceRowSchema>;
export const AdvanceAmendmentSchema = z.strictObject({
  originalPeriod: ReturnPeriodSchema,
  original: AdvancePartySchema,
  row: AdvanceRowSchema,
});
export type AdvanceAmendment = z.infer<typeof AdvanceAmendmentSchema>;
/** Table 11: 11A received (`at`), 11B adjusted (`txpd`), 11(II) amendments (`ata`, `txpda`). */
export const AdvancesSchema = z.strictObject({
  received: z.array(AdvanceRowSchema),
  adjusted: z.array(AdvanceRowSchema),
  receivedAmendments: z.array(AdvanceAmendmentSchema),
  adjustedAmendments: z.array(AdvanceAmendmentSchema),
});
export type Advances = z.infer<typeof AdvancesSchema>;

const EcoFlag = z.enum(["N", "E", "D"]);
/** Table 14 row (S5 `supeco.clttx` / `paytx`). */
export const SupecoRowSchema = z.strictObject({
  etin: Gstin,
  netValue: Amount,
  igst: Amount,
  cgst: Amount,
  sgst: Amount,
  cess: Amount.optional(),
  flag: EcoFlag.optional(),
});
export const SupecoAmendmentRowSchema = z.strictObject({
  ...SupecoRowSchema.shape,
  originalEtin: Gstin,
  originalPeriod: ReturnPeriodSchema,
});
export const SupecoSchema = z.strictObject({
  collectsTcs: z.array(SupecoRowSchema),
  paysTax95: z.array(SupecoRowSchema),
  collectsTcsAmendments: z.array(SupecoAmendmentRowSchema),
  paysTax95Amendments: z.array(SupecoAmendmentRowSchema),
});
export type Supeco = z.infer<typeof SupecoSchema>;

/** Table 15 item (S5 `ecom.*.inv[].itms[].itm_det`, `ecom.b2c`, …). */
export const EcomItemSchema = z.strictObject({
  rate: Rate,
  taxableValue: Amount,
  igst: Amount.optional(),
  cgst: Amount.optional(),
  sgst: Amount.optional(),
  cess: Amount.optional(),
});
export type EcomItem = z.infer<typeof EcomItemSchema>;
const ecomDocShape = {
  number: z.string(),
  date: IsoDateSchema,
  value: Amount,
  pos: Pos,
  supplyType: SupplyTypeSchema,
  invoiceType: InvoiceTypeSchema,
  flag: EcoFlag,
  items: z.array(EcomItemSchema).min(1),
};
const ecomAmendShape = { originalNumber: z.string(), originalDate: IsoDateSchema };
export const EcomSchema = z.strictObject({
  b2b: z.array(z.strictObject({ supplierGstin: Gstin, recipientGstin: Gstin, ...ecomDocShape })),
  urp2b: z.array(z.strictObject({ recipientGstin: Gstin, ...ecomDocShape })),
  b2c: z.array(
    z.strictObject({
      supplierGstin: Gstin,
      pos: Pos,
      supplyType: SupplyTypeSchema,
      flag: EcoFlag,
      ...EcomItemSchema.shape,
    }),
  ),
  urp2c: z.array(
    z.strictObject({
      pos: Pos,
      supplyType: SupplyTypeSchema,
      flag: EcoFlag,
      ...EcomItemSchema.shape,
    }),
  ),
  b2ba: z.array(
    z.strictObject({
      supplierGstin: Gstin,
      recipientGstin: Gstin,
      ...ecomDocShape,
      ...ecomAmendShape,
    }),
  ),
  urp2ba: z.array(z.strictObject({ recipientGstin: Gstin, ...ecomDocShape, ...ecomAmendShape })),
  b2ca: z.array(
    z.strictObject({
      pos: Pos,
      supplierGstin: Gstin,
      originalSupplierGstin: Gstin,
      originalPeriod: ReturnPeriodSchema,
      supplyType: SupplyTypeSchema,
      flag: EcoFlag,
      items: z.array(EcomItemSchema).min(1),
    }),
  ),
  urp2ca: z.array(
    z.strictObject({
      pos: Pos,
      originalPeriod: ReturnPeriodSchema,
      supplyType: SupplyTypeSchema,
      flag: EcoFlag,
      items: z.array(EcomItemSchema).min(1),
    }),
  ),
});
export type Ecom = z.infer<typeof EcomSchema>;

export const Gstr1ReturnSchema = z.strictObject({
  gstin: Gstin,
  period: ReturnPeriodSchema,
  b2b: z.array(B2bGroupSchema),
  b2cl: z.array(B2clGroupSchema),
  b2cs: z.array(B2csRowSchema),
  cdnr: z.array(CdnrGroupSchema),
  cdnur: z.array(CdnurNoteSchema),
  exp: z.array(ExpGroupSchema),
  hsn: z.strictObject({ b2b: z.array(HsnRowSchema), b2c: z.array(HsnRowSchema) }),
  docIssue: z.array(DocIssueEntrySchema),
  b2ba: z.array(B2baGroupSchema).optional(),
  b2cla: z.array(B2claGroupSchema).optional(),
  expa: z.array(ExpaGroupSchema).optional(),
  cdnra: z.array(CdnraGroupSchema).optional(),
  cdnura: z.array(CdnuraNoteSchema).optional(),
  b2csa: z.array(B2csaRowSchema).optional(),
  nil: z.array(NilRowSchema).optional(),
  advances: AdvancesSchema.optional(),
  supeco: SupecoSchema.optional(),
  ecom: EcomSchema.optional(),
});
export type Gstr1Return = z.infer<typeof Gstr1ReturnSchema>;
