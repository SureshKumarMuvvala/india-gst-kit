// Source: https://einv-apisandbox.nic.in/version1.03/generate-irn.html#Validations (source C) —
//         sources/einvoice/generate-irn-validations.txt, "Tolerance limit" paragraphs and their 3 examples
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
// "Minimum value is the rupee part of the calculated value minus one rupee and maximum is the calculated
// value rounded up to the next rupee plus one rupee." A negative calculated value uses the same
// floor/ceil formula (the source gives no example; UNVERIFIED).
import { D } from "./decimal.js";

export function rupeeTolerance(calculated: string): { min: string; max: string } {
  const c = new D(calculated);
  return { min: c.floor().minus(1).toFixed(2), max: c.ceil().plus(1).toFixed(2) };
}

/** Inclusive on both ends. `calculated` is an exact decimal and is never rounded first. */
export function withinTolerance(passed: string, calculated: string): boolean {
  const { min, max } = rupeeTolerance(calculated);
  const p = new D(passed);
  return p.gte(min) && p.lte(max);
}
