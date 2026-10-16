import { D } from "./decimal.js";
import { AMOUNT_FIELDS, type AmountField, type ReconResult } from "./result.js";

export type ReconSummary = {
  counts: {
    matched: number;
    matchedWithDifferences: number;
    possibleMatches: number;
    in2bOnly: number;
    inRegisterOnly: number;
    excluded: number;
  };
  /** Σ (gstr2b − register) per amount field over matchedWithDifferences and possibleMatches. */
  differenceTotals: Record<AmountField, string>;
};

/** Counts per bucket and per-field totals of the amount differences. It reports no ITC figures. */
export function summarise(result: ReconResult): ReconSummary {
  const totals = Object.fromEntries(AMOUNT_FIELDS.map((f) => [f, new D(0)])) as Record<
    AmountField,
    InstanceType<typeof D>
  >;
  for (const pair of [...result.matchedWithDifferences, ...result.possibleMatches]) {
    for (const d of pair.differences) {
      if (d.difference === undefined) continue;
      const f = d.field as AmountField;
      totals[f] = totals[f].plus(d.difference);
    }
  }
  return {
    counts: {
      matched: result.matched.length,
      matchedWithDifferences: result.matchedWithDifferences.length,
      possibleMatches: result.possibleMatches.length,
      in2bOnly: result.in2bOnly.length,
      inRegisterOnly: result.inRegisterOnly.length,
      excluded: result.excluded.length,
    },
    differenceTotals: Object.fromEntries(
      AMOUNT_FIELDS.map((f) => [f, totals[f].toFixed(2)]),
    ) as Record<AmountField, string>,
  };
}
