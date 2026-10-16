import { D, fmt2 } from "./decimal.js";
import type { Money, SplitConvention, TaxSplit } from "./primitives.js";

/** Round half-up to 2 dp. Throws on negative, NaN or non-finite input. */
export function money(x: string | number): Money {
  const d = new D(x);
  if (!d.isFinite()) throw new RangeError(`money(): not a finite number: ${String(x)}`);
  if (d.isNegative() && !d.isZero()) throw new RangeError(`money(): negative amount: ${String(x)}`);
  return fmt2(d);
}

export function sumMoney(xs: readonly Money[]): Money {
  return fmt2(xs.reduce((acc, x) => acc.plus(x), new D(0)));
}

/** Total tax on `taxable` at `rate` per cent: round2(taxable × rate / 100). */
export function totalTax(taxable: Money, rate: string): Money {
  return fmt2(new D(taxable).mul(rate).div(100));
}

export function computeLineTax(
  taxable: Money,
  rate: string,
  split: TaxSplit,
  options?: { convention?: SplitConvention },
): { cgst: Money; sgst: Money; igst: Money } {
  const t = totalTax(taxable, rate);
  if (split === "INTER") return { cgst: "0.00", sgst: "0.00", igst: t };
  if ((options?.convention ?? "remainder-to-sgst") === "equal-halves") {
    const half = fmt2(new D(taxable).mul(rate).div(200));
    return { cgst: half, sgst: half, igst: "0.00" };
  }
  const cgst = fmt2(new D(t).div(2));
  return { cgst, sgst: fmt2(new D(t).minus(cgst)), igst: "0.00" };
}
