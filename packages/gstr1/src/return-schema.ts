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

export const B2bInvoiceSchema = z.strictObject({
  ...documentShape,
  pos: Pos,
  reverseCharge: z.boolean(),
  invoiceType: InvoiceTypeSchema,
  items: z.array(ItemSchema).min(1),
});
export const B2bGroupSchema = z.strictObject({
  ctin: Gstin,
  invoices: z.array(B2bInvoiceSchema).min(1),
});

export const B2clInvoiceSchema = z.strictObject({
  ...documentShape,
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
});
export type Gstr1Return = z.infer<typeof Gstr1ReturnSchema>;
