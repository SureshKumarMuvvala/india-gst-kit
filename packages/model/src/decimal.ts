import { Decimal } from "decimal.js";

/** Private Decimal constructor: half-up rounding and plenty of precision, without touching the global one. */
export const D = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

/** Round half-up to 2 dp and format. Negative zero becomes "0.00". */
export function fmt2(d: Dec): string {
  const r = d.toDecimalPlaces(2, D.ROUND_HALF_UP);
  return r.isZero() ? "0.00" : r.toFixed(2);
}

/** decimal.js throws plain Errors whose message starts with "[DecimalError]". */
export function isDecimalError(e: unknown): boolean {
  return e instanceof Error && e.message.startsWith("[DecimalError]");
}
