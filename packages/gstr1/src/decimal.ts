import { Decimal } from "decimal.js";

// Local copy of the model's private Decimal constructor (packages/model/src/decimal.ts is not exported).
// To be replaced by a shared export once the model's PR lands (spec deviation, see the PR).

/** Private Decimal constructor: half-up rounding and plenty of precision, without touching the global one. */
export const D = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

/** Round half-up to 2 dp and format. Negative zero becomes "0.00". */
export function fmt2(d: Dec): string {
  const r = d.toDecimalPlaces(2, D.ROUND_HALF_UP);
  return r.isZero() ? "0.00" : r.toFixed(2);
}

/** Rate / plain decimal in normal notation without trailing zeros: "18.000" → "18", "0.250" → "0.25". */
export function trimDecimal(s: string): string {
  return new D(s).toFixed();
}
