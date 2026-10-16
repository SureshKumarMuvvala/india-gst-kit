import { z } from "zod";
import { D, fmt2, isDecimalError } from "../decimal.js";
import { totalTax } from "../money.js";
import {
  CessRateSchema,
  GstRateSchema,
  HsnSacSchema,
  MoneySchema,
  QuantitySchema,
  UnitPriceSchema,
  UqcCodeSchema,
} from "../primitives.js";

const lineShape = {
  lineNo: z.number().int().min(1),
  description: z.string().trim().min(1).max(300),
  hsnSac: HsnSacSchema,
  isService: z.boolean(),
  quantity: QuantitySchema.optional(),
  unit: UqcCodeSchema.optional(),
  unitPrice: UnitPriceSchema.optional(),
  grossAmount: MoneySchema,
  discount: MoneySchema.default("0.00"),
  taxableValue: MoneySchema,
  gstRate: GstRateSchema,
  cgst: MoneySchema,
  sgst: MoneySchema, // holds SGST or UTGST
  igst: MoneySchema,
  cessRate: CessRateSchema.optional(),
  cessNonAdvol: MoneySchema.default("0.00"),
  cess: MoneySchema.default("0.00"),
  lineTotal: MoneySchema,
};

const ONE_PAISA = new D("0.01");

export const LineSchema = z.strictObject(lineShape).superRefine((l, ctx) => {
  const add = (path: string, message: string) => {
    ctx.addIssue({ code: "custom", path: [path], message });
  };
  try {
    if (l.isService && !l.hsnSac.startsWith("99"))
      add("hsnSac", "A service line needs a SAC starting with 99");
    if (!l.isService && l.quantity === undefined) add("quantity", "quantity is required for goods");
    if (l.quantity === undefined && l.unit !== undefined) add("unit", "unit requires quantity");
    if (l.quantity !== undefined && l.unit === undefined)
      add("unit", "unit is required when quantity is present");
    if (l.quantity === undefined && l.unitPrice !== undefined)
      add("unitPrice", "unitPrice requires quantity");
    if (l.quantity !== undefined && l.unitPrice === undefined) {
      add("unitPrice", "unitPrice is required when quantity is present");
    }
    const gross = new D(l.grossAmount);
    if (l.quantity !== undefined && l.unitPrice !== undefined) {
      const expected = fmt2(new D(l.quantity).mul(l.unitPrice));
      if (expected !== l.grossAmount)
        add("grossAmount", `grossAmount must equal round2(quantity × unitPrice) = ${expected}`);
    }
    const discount = new D(l.discount);
    if (discount.gt(gross)) {
      add("discount", "discount cannot exceed grossAmount");
    } else if (fmt2(gross.minus(discount)) !== l.taxableValue) {
      add("taxableValue", "taxableValue must equal grossAmount − discount");
    }
    if (new D(l.cgst).minus(l.sgst).abs().gt(ONE_PAISA)) {
      add("sgst", "cgst and sgst may differ by at most 0.01");
    }
    if (!new D(l.igst).isZero() && (!new D(l.cgst).isZero() || !new D(l.sgst).isZero())) {
      add("igst", "igst and cgst/sgst cannot both be non-zero");
    }
    const total = [l.taxableValue, l.cgst, l.sgst, l.igst, l.cess].reduce(
      (a, x) => a.plus(x),
      new D(0),
    );
    if (fmt2(total) !== l.lineTotal)
      add("lineTotal", "lineTotal must equal taxable + cgst + sgst + igst + cess");
  } catch (e) {
    // Malformed number strings are already reported by the field schemas.
    if (!isDecimalError(e)) throw e;
  }
});

export type Line = z.output<typeof LineSchema>;
export type LineInput = z.input<typeof LineSchema>;

export type TaxMode = "INTRA" | "INTER" | "ZERO";
export interface LineTaxIssue {
  field: "cgst" | "sgst" | "igst" | "cess";
  message: string;
}

/**
 * Checks a line's tax amounts against the mode that applies to its document:
 * INTRA (cgst+sgst), INTER (igst) or ZERO (bill of supply, composition, SEZ/export without payment).
 * INTRA accepts both split conventions (spec §7).
 */
export function lineTaxIssues(line: Line, mode: TaxMode): LineTaxIssue[] {
  const issues: LineTaxIssue[] = [];
  const isZero = (s: string) => new D(s).isZero();
  if (mode === "ZERO") {
    for (const f of ["cgst", "sgst", "igst", "cess"] as const) {
      if (!isZero(line[f])) issues.push({ field: f, message: `${f} must be 0.00` });
    }
    return issues;
  }
  const t = totalTax(line.taxableValue, line.gstRate);
  if (mode === "INTER") {
    if (!isZero(line.cgst))
      issues.push({ field: "cgst", message: "cgst must be 0.00 on an inter-state supply" });
    if (!isZero(line.sgst))
      issues.push({ field: "sgst", message: "sgst must be 0.00 on an inter-state supply" });
    if (line.igst !== t) issues.push({ field: "igst", message: `igst must equal ${t}` });
  } else {
    if (!isZero(line.igst))
      issues.push({ field: "igst", message: "igst must be 0.00 on an intra-state supply" });
    const half2 = new D(line.taxableValue).mul(line.gstRate).div(200);
    const alt = new D(fmt2(half2)).mul(2);
    const sum = new D(line.cgst).plus(line.sgst);
    if (!sum.eq(t) && !sum.eq(alt)) {
      issues.push({
        field: "cgst",
        message: `cgst + sgst must equal ${t} (or ${fmt2(alt)} with equal halves)`,
      });
    }
  }
  const adValorem = new D(totalTax(line.taxableValue, line.cessRate ?? "0"));
  const expectedCess = fmt2(adValorem.plus(line.cessNonAdvol));
  if (line.cess !== expectedCess) {
    issues.push({ field: "cess", message: `cess must equal ${expectedCess}` });
  }
  return issues;
}
