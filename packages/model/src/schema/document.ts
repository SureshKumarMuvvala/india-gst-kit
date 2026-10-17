import { z } from "zod";
import { D, fmt2, isDecimalError } from "../decimal.js";
import {
  DocumentKindSchema,
  DocumentNumberSchema,
  IsoDateSchema,
  MoneySchema,
  PlaceOfSupplySchema,
  SignedMoneySchema,
  SupplyCategorySchema,
} from "../primitives.js";
import { decideTaxSplit } from "../supply.js";
import { LineSchema, lineTaxIssues, type TaxMode } from "./line.js";
import { PartySchema, SupplierSchema } from "./party.js";
import { DispatchFromSchema, ShipToSchema } from "./ship.js";

export const OriginalDocRefSchema = z.strictObject({
  number: DocumentNumberSchema,
  date: IsoDateSchema,
});

export const TotalsSchema = z
  .strictObject({
    taxableValue: MoneySchema,
    cgst: MoneySchema,
    sgst: MoneySchema,
    igst: MoneySchema,
    cess: MoneySchema,
    lineDiscount: MoneySchema,
    otherCharges: MoneySchema.default("0.00"),
    roundOff: SignedMoneySchema.default("0.00"),
    grandTotal: MoneySchema,
  })
  .superRefine((t, ctx) => {
    if (new D(t.roundOff).abs().gte(1)) {
      ctx.addIssue({
        code: "custom",
        path: ["roundOff"],
        message: "|roundOff| must be less than 1.00",
      });
    }
  });

export const GstDocumentSchema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    kind: DocumentKindSchema,
    number: DocumentNumberSchema,
    date: IsoDateSchema,
    supplier: SupplierSchema,
    recipient: PartySchema,
    placeOfSupply: PlaceOfSupplySchema,
    supplyCategory: SupplyCategorySchema.default("DOMESTIC"),
    reverseCharge: z.boolean().default(false),
    originalDocument: OriginalDocRefSchema.optional(),
    lines: z.array(LineSchema).min(1),
    totals: TotalsSchema,
    notes: z.string().max(500).optional(),
    // Track E (spec §5.7): never change placeOfSupply or the tax split (refinement 7).
    shipTo: ShipToSchema.optional(),
    dispatchFrom: DispatchFromSchema.optional(),
  })
  .superRefine((d, ctx) => {
    const add = (path: (string | number)[], message: string) => {
      ctx.addIssue({ code: "custom", path, message });
    };
    try {
      const isNote = d.kind === "CREDIT_NOTE" || d.kind === "DEBIT_NOTE";
      if (isNote && d.originalDocument === undefined) {
        add(["originalDocument"], "originalDocument is required for credit and debit notes");
      }
      if (!isNote && d.originalDocument !== undefined) {
        add(["originalDocument"], "originalDocument is only allowed on credit and debit notes");
      }
      if (d.originalDocument !== undefined && d.originalDocument.date > d.date) {
        add(
          ["originalDocument", "date"],
          "originalDocument.date must not be after the document date",
        );
      }

      const composition = d.supplier.registrationType === "COMPOSITION";
      if (composition && d.kind === "TAX_INVOICE") {
        add(["kind"], "A composition supplier cannot issue a tax invoice");
      }
      if (d.recipient.gstin !== undefined && d.recipient.gstin === d.supplier.gstin) {
        add(["recipient", "gstin"], "supplier and recipient GSTIN must differ");
      }

      // Tax mode: what the lines' tax amounts must look like.
      let mode: TaxMode;
      let why: string;
      if (d.kind === "BILL_OF_SUPPLY") {
        mode = "ZERO";
        why = "bill of supply";
      } else if (composition) {
        mode = "ZERO";
        why = "composition supplier";
      } else if (
        d.supplyCategory === "SEZ_WITHOUT_PAYMENT" ||
        d.supplyCategory === "EXPORT_WITHOUT_PAYMENT"
      ) {
        mode = "ZERO";
        why = d.supplyCategory;
      } else {
        mode = decideTaxSplit(d.supplier.stateCode, d.placeOfSupply, d.supplyCategory);
        why = mode === "INTRA" ? "intra-state supply" : "inter-state supply";
      }
      d.lines.forEach((line, i) => {
        if (line.lineNo !== i + 1)
          add(["lines", i, "lineNo"], `lineNo must be ${i + 1} (lines are numbered 1..n)`);
        for (const issue of lineTaxIssues(line, mode))
          add(["lines", i, issue.field], `${why}: ${issue.message}`);
      });

      const sum = (
        f: "taxableValue" | "cgst" | "sgst" | "igst" | "cess" | "discount" | "lineTotal",
      ) => d.lines.reduce((a, l) => a.plus(l[f]), new D(0));
      const expected = {
        taxableValue: sum("taxableValue"),
        cgst: sum("cgst"),
        sgst: sum("sgst"),
        igst: sum("igst"),
        cess: sum("cess"),
        lineDiscount: sum("discount"),
      };
      for (const [f, v] of Object.entries(expected) as [
        keyof typeof expected,
        InstanceType<typeof D>,
      ][]) {
        if (d.totals[f] !== fmt2(v))
          add(["totals", f], `totals.${f} must equal the sum of the lines (${fmt2(v)})`);
      }
      const grand = sum("lineTotal").plus(d.totals.otherCharges).plus(d.totals.roundOff);
      if (grand.isNegative()) {
        add(["totals", "grandTotal"], "grandTotal would be negative");
      } else if (d.totals.grandTotal !== fmt2(grand)) {
        add(
          ["totals", "grandTotal"],
          `grandTotal must equal Σ lineTotal + otherCharges + roundOff (${fmt2(grand)})`,
        );
      }
    } catch (e) {
      // Malformed number strings are already reported by the field schemas.
      if (!isDecimalError(e)) throw e;
    }
  });

export type OriginalDocRef = z.output<typeof OriginalDocRefSchema>;
export type Totals = z.output<typeof TotalsSchema>;
export type GstDocument = z.output<typeof GstDocumentSchema>;
export type GstDocumentInput = z.input<typeof GstDocumentSchema>;

export function parseGstDocument(
  input: unknown,
  options?: Parameters<typeof GstDocumentSchema.safeParse>[1],
) {
  return GstDocumentSchema.safeParse(input, options);
}
