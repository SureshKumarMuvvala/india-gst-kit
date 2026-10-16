import { Decimal } from "decimal.js";

/** Private Decimal constructor: half-up rounding and plenty of precision, without touching the global one. */
export const D = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;
