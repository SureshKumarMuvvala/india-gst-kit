// Source: https://developer.gst.gov.in/apiportal/taxpayer/returns — "GSTR3B – Get ITC Liability Auto Calc Details" (3183)
//         v7.1, Draft, published 23-03-2026 — sources/gstr3b/GSTR3B - Get ITC Liability Auto Calc Details response_schema v7.1.json
//         (definitions txamt, nonzerotxamt, negtxamt, pos, taxperiod, r2btaxprd, date, gstin, ret_period)
// Retrieved: 2026-10-18
// Status: UNVERIFIED — needs CA
import { z } from "zod";
import { AUTOCALC_SHAPE, type ShapeLeaf, type ShapeNode } from "./autocalc-shape.js";
import { MAX, MIN, markNumber, wireMoney } from "./numbers.js";
import { RET_PERIOD_PATTERN, SV_GSTIN_PATTERN } from "./primitives.js";

export const TAX_PERIODS = [
  "IFF - January",
  "IFF - February",
  "IFF - March",
  "IFF - April",
  "IFF - May",
  "IFF - June",
  "IFF - July",
  "IFF - August",
  "IFF - September",
  "IFF - October",
  "IFF - November",
  "IFF - December",
  "GSTR-1 Quarterly",
  "GSTR-1/1A Quarterly",
  "IFF/GSTR-1 Quarterly",
] as const;
export const R2B_TAX_PERIODS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const DATE = /^(0[1-9]|[12][0-9]|3[01])[-](0[1-9]|1[012])[-](19|20)\d\d$/;

/** AC #date DD-MM-YYYY, with a real-calendar check on top (as recon), output as ISO YYYY-MM-DD. */
export const AcDateSchema = z
  .string()
  .check((ctx) => {
    const ok = DATE.test(ctx.value) && realDate(ctx.value);
    if (!ok)
      ctx.issues.push({
        code: "custom",
        input: ctx.value,
        message: `${ctx.value}: not a DD-MM-YYYY calendar date`,
      });
  })
  .transform((v) => `${v.slice(6, 10)}-${v.slice(3, 5)}-${v.slice(0, 2)}`);

function realDate(v: string): boolean {
  const d = Number(v.slice(0, 2));
  const m = Number(v.slice(3, 5));
  const y = Number(v.slice(6, 10));
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * AC #pos: `(^(3[0-8]|[12][0-9]|0[1-9]|9[67])$)*`, length 0–2. The pattern is unanchored and its group may repeat zero
 * times, so it matches every string: only the length constrains it (spec §13 C4). Transcribed as such.
 */
export const AcPosSchema = z.string().max(2);

function leaf(code: ShapeLeaf): z.ZodType {
  switch (code) {
    case "T":
      return markNumber(wireMoney(MIN, MAX));
    case "P":
      return markNumber(wireMoney("0", MAX));
    case "N":
      return markNumber(wireMoney(MIN, "0"));
    case "pos":
      return AcPosSchema;
    case "tp":
      return z.enum(TAX_PERIODS);
    case "r2b":
      return z.enum(R2B_TAX_PERIODS);
    case "date":
      return AcDateSchema;
    case "gstin":
      return z.string().length(15).regex(SV_GSTIN_PATTERN);
    case "rp":
      return z.string().regex(RET_PERIOD_PATTERN);
    case "s":
      return z.string();
  }
}

/**
 * Builds the Zod schema of a shape node: strict objects with the source's `required` and `anyOf` alternatives, arrays
 * with the source's minItems/maxItems, and leaves.
 */
export function zodFromShape(node: ShapeNode): z.ZodType {
  if (typeof node === "string") return leaf(node);
  if ("a" in node) {
    let arr = z.array(zodFromShape(node.a));
    if (node.n !== undefined) {
      arr = arr.min(node.n[0]);
      if (node.n[1] !== null) arr = arr.max(node.n[1]);
    }
    return arr;
  }
  const required = new Set(node.r ?? []);
  const shape: Record<string, z.ZodType> = {};
  for (const [k, v] of Object.entries(node.p)) {
    const s = zodFromShape(v);
    shape[k] = required.has(k) ? s : s.optional();
  }
  const obj = z.strictObject(shape);
  const anyOf = node.o;
  if (anyOf === undefined) return obj;
  return obj.check((ctx) => {
    const v = ctx.value;
    if (!anyOf.some((keys) => keys.every((k) => v[k] !== undefined))) {
      ctx.issues.push({
        code: "custom",
        input: ctx.value,
        message: `must have one of: ${anyOf.map((keys) => keys.join(" + ")).join(" | ")} (AC anyOf)`,
      });
    }
  });
}

/** The whole AC response: `{ r3bautopop }` (required at the root, D-H9). */
export const AutoCalcSchema: z.ZodType = z.strictObject({
  r3bautopop: zodFromShape(AUTOCALC_SHAPE),
});
