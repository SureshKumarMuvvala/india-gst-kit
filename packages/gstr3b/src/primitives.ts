// Source: https://developer.gst.gov.in/apiportal/taxpayer/returns — "GSTR3B – Save GSTR3B data" (2269) v7.1, Draft,
//         published 23-03-2026 — sources/gstr3b/GSTR3B - Save GSTR3B data request_schema v7.1.json
//         (#negVal, #nonEmptyCost, #nonEmptyCostITCNet, #state_cd, gstin, ret_period)
// Retrieved: 2026-10-18
// Status: UNVERIFIED — needs CA
import { z } from "zod";
import { GstinSchema, isPlaceOfSupplyCode } from "@india-gst-kit/model";
import type { Gstr3bIssueCode } from "./types.js";

/** SV `ret_period` (and AC `#ret_period`): MMYYYY, years 1900–2099. */
export const RET_PERIOD_PATTERN = /^((0[1-9]|1[012])((19|20)\d\d))$/;
/** SV `#state_cd`, the 3.2 place of supply. */
export const STATE_CD_PATTERN = /^(3[0-8]|[12][0-9]|0[1-9]|97)$/;
/**
 * SV `gstin` (PAN-structured; also AC `#gstin`). The source pattern has no anchors; with minLength = maxLength = 15
 * and a pattern of exactly 15 characters it is a whole-string match, so it is anchored here (spec §13 R3).
 */
export const SV_GSTIN_PATTERN =
  /^[0-9]{2}[a-zA-Z]{5}[0-9]{4}[a-zA-Z]{1}[1-9A-Za-z]{1}[Zz1-9A-Ja-j]{1}[0-9a-zA-Z]{1}$/;

/** The SV maximum and minimum: ±9999999999999.99 (13 integer digits). */
const SIGNED_2DP = /^-?(0|[1-9]\d{0,12})\.\d{2}$/;

type Ctx = z.core.ParsePayload<string>;
function fail(ctx: Ctx, code: Gstr3bIssueCode, message: string): void {
  ctx.issues.push({ code: "custom", message, input: ctx.value, params: { gstr3b: code } });
}
function isNegativeZero(v: string): boolean {
  return /^-0\.00$/.test(v);
}

/** In-memory signed money (#negVal, #nonEmptyCostITCNet): exactly 2 decimals, within ±9999999999999.99, no "-0.00". */
export const Signed3bSchema = z.string().check((ctx) => {
  if (!SIGNED_2DP.test(ctx.value) || isNegativeZero(ctx.value)) {
    fail(
      ctx,
      "AMOUNT_OUT_OF_RANGE",
      `"${ctx.value}": a decimal string with exactly 2 decimals within ±9999999999999.99`,
    );
  }
});
/** In-memory unsigned money (#nonEmptyCost): exactly 2 decimals, 0 … 9999999999999.99. */
export const Unsigned3bSchema = z.string().check((ctx) => {
  if (!SIGNED_2DP.test(ctx.value) || isNegativeZero(ctx.value)) {
    fail(
      ctx,
      "AMOUNT_OUT_OF_RANGE",
      `"${ctx.value}": a decimal string with exactly 2 decimals within 0 … 9999999999999.99`,
    );
  } else if (ctx.value.startsWith("-")) {
    fail(
      ctx,
      "NEGATIVE_NOT_ALLOWED",
      `"${ctx.value}": this field cannot be negative (SV #nonEmptyCost)`,
    );
  }
});
export type Signed3b = z.infer<typeof Signed3bSchema>;
export type Unsigned3b = z.infer<typeof Unsigned3bSchema>;

export const PeriodSchema = z.string().check((ctx) => {
  if (!RET_PERIOD_PATTERN.test(ctx.value))
    fail(ctx, "PERIOD_FORMAT", `"${ctx.value}": ret_period must be MMYYYY`);
});

/** V4: the model's GSTIN check (loose pattern, state, mod-36) and SV's PAN-structured pattern (D-H4). */
export const FilerGstinSchema = z.string().check((ctx) => {
  if (!GstinSchema.safeParse(ctx.value).success) {
    fail(
      ctx,
      "GSTIN_INVALID",
      `"${ctx.value}": not a valid GSTIN (pattern, state code or check digit)`,
    );
  } else if (!SV_GSTIN_PATTERN.test(ctx.value)) {
    fail(
      ctx,
      "GSTIN_NOT_ACCEPTED_BY_3B",
      `"${ctx.value}": does not match the GSTR-3B (SV) GSTIN pattern`,
    );
  }
});

/** V5 + V6: SV `#state_cd` and a model place-of-supply code, so 25 and 28 are rejected (D-H5). */
export const Pos3bSchema = z.string().check((ctx) => {
  if (!STATE_CD_PATTERN.test(ctx.value)) {
    fail(ctx, "POS_NOT_ACCEPTED", `"${ctx.value}": place of supply not accepted by SV #state_cd`);
  } else if (!isPlaceOfSupplyCode(ctx.value)) {
    fail(
      ctx,
      "POS_UNKNOWN",
      `"${ctx.value}": not a place-of-supply code in the model's state list`,
    );
  }
});

/** The issue code carried by a custom issue raised in this package, if any. */
export function codeOf(i: z.core.$ZodIssue): Gstr3bIssueCode | undefined {
  if (i.code !== "custom") return undefined;
  const params: unknown = i.params;
  if (typeof params !== "object" || params === null) return undefined;
  const c = (params as Record<string, unknown>)["gstr3b"];
  return typeof c === "string" ? (c as Gstr3bIssueCode) : undefined;
}
