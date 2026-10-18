import { z } from "zod";
import { Gstr2bOriginSchema, Gstr2bRefSchema, type Gstr2bRecord } from "@india-gst-kit/recon";
import { D } from "./decimal.js";
import { Gstr3bIssueSchema, issue, type Gstr3bIssue } from "./types.js";

const MoneySchema = z.string();

export const Gstr2bGroupKeySchema = z.strictObject({
  documentType: z.enum(["INVOICE", "DEBIT_NOTE", "CREDIT_NOTE"]),
  itcavl: z.enum(["Y", "N", "T", "ABSENT"]),
  reverseCharge: z.enum(["Y", "N", "ABSENT"]),
  origin: Gstr2bOriginSchema,
  returnPeriod: z.string(),
});
export type Gstr2bGroupKey = z.infer<typeof Gstr2bGroupKeySchema>;

export const Gstr2bTotalsSchema = z.strictObject({
  label: z.string(),
  groups: z.array(
    z.strictObject({
      key: Gstr2bGroupKeySchema,
      count: z.number().int(),
      totals: z.strictObject({
        taxableValue: MoneySchema,
        igst: MoneySchema,
        cgst: MoneySchema,
        sgst: MoneySchema,
        cess: MoneySchema,
      }),
      paths: z.array(Gstr2bRefSchema),
    }),
  ),
  issues: z.array(Gstr3bIssueSchema),
});
export type Gstr2bTotals = z.infer<typeof Gstr2bTotalsSchema>;

const FIELDS = ["taxableValue", "igst", "cgst", "sgst", "cess"] as const;

/**
 * Totals the records the caller selected, grouped by document type × itcavl × reverse charge × origin × period
 * (spec §5.2, D-H11). Never filters, never nets credit notes, never picks a 4A row.
 */
export function sumGstr2bRecords(
  records: readonly Gstr2bRecord[],
  options: { label?: string; filerGstin?: string; period?: string } = {},
): Gstr2bTotals {
  const label = options.label ?? "GSTR-2B selection";
  const issues: Gstr3bIssue[] = [];
  const groups = new Map<
    string,
    Gstr2bTotals["groups"][number] & {
      sums: Record<(typeof FIELDS)[number], InstanceType<typeof D>>;
    }
  >();
  for (const r of records) {
    if (options.filerGstin !== undefined && r.recipientGstin !== options.filerGstin) {
      issues.push(
        issue("RECIPIENT_MISMATCH", `${r.number}: recipient ${r.recipientGstin} is not the filer`, {
          path: r.path,
        }),
      );
    }
    if (options.period !== undefined && r.returnPeriod !== options.period) {
      issues.push(
        issue("PERIOD_MIXED", `${r.number}: 2B period ${r.returnPeriod} ≠ ${options.period}`, {
          path: r.path,
        }),
      );
    }
    const key: Gstr2bGroupKey = {
      documentType: r.documentType,
      itcavl: r.itc.itcavl ?? "ABSENT",
      reverseCharge: r.reverseCharge ?? "ABSENT",
      origin: r.origin,
      returnPeriod: r.returnPeriod,
    };
    const k = JSON.stringify(key);
    let g = groups.get(k);
    if (g === undefined) {
      g = {
        key,
        count: 0,
        totals: { taxableValue: "0.00", igst: "0.00", cgst: "0.00", sgst: "0.00", cess: "0.00" },
        paths: [],
        sums: {
          taxableValue: new D(0),
          igst: new D(0),
          cgst: new D(0),
          sgst: new D(0),
          cess: new D(0),
        },
      };
      groups.set(k, g);
    }
    g.count += 1;
    for (const f of FIELDS) g.sums[f] = g.sums[f].plus(r.amounts[f]);
    g.paths.push({ returnPeriod: r.returnPeriod, path: r.path });
  }
  return {
    label,
    groups: [...groups.values()].map(({ sums, ...g }) => {
      const totals = { ...g.totals };
      for (const f of FIELDS) totals[f] = sums[f].isZero() ? "0.00" : sums[f].toFixed(2);
      return { ...g, totals };
    }),
    issues,
  };
}
