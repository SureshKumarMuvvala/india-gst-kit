import { z } from "zod";
import { IsoDateSchema, parseLenient } from "@india-gst-kit/model";
import { AutoCalcSchema } from "./autocalc-schema.js";
import { convertWire, readJson } from "./numbers.js";
import { wrongTypeIssues, zodIssues, type ParseResult } from "./render.js";
import { issue, type Gstr3bIssue } from "./types.js";

export const GSTR3B_AUTOCALC_SCHEMA_VERSION = "7.1";

export const AutoCalcParsedSchema = z.strictObject({
  meta: z.strictObject({
    r1fildt: IsoDateSchema.optional(),
    r2bgendt: IsoDateSchema.optional(),
    r3bgendt: IsoDateSchema.optional(),
    r1afildt: IsoDateSchema.optional(),
  }),
  errors: z.array(z.strictObject({ error_cd: z.string(), error_desc: z.string() })),
  /** The validated `r3bautopop` object: money as 2-dp strings, dates ISO, unknown keys dropped. */
  data: z.record(z.string(), z.unknown()),
});
export type AutoCalc = z.infer<typeof AutoCalcParsedSchema>;

/**
 * Parses an Auto Calc v7.1 response losslessly (spec §9.1). Unknown keys are dropped with UNEXPECTED_KEY warnings;
 * a non-empty `error[]` gives PORTAL_ERRORS. Never throws on bad input.
 */
export function parseAutoCalcJson(text: string): ParseResult<AutoCalc> {
  if (typeof text !== "string") throw new TypeError("parseAutoCalcJson: text must be a string");
  const j = readJson(text);
  if (!j.ok) return { ok: false, issues: [issue("SCHEMA", j.message)] };
  const wrong: (string | number)[][] = [];
  const converted = convertWire(j.value, AutoCalcSchema, wrong);
  const lenient = parseLenient(AutoCalcSchema, converted);
  const issues: Gstr3bIssue[] = [
    ...wrongTypeIssues(wrong),
    ...lenient.unknown.map((p) =>
      issue("UNEXPECTED_KEY", `unknown key ${p.join(".")} dropped`, { path: p }),
    ),
  ];
  if (lenient.data === undefined || wrong.length > 0) {
    issues.push(...zodIssues(lenient.issues, wrong));
    return { ok: false, issues };
  }
  const root = (lenient.data as { r3bautopop: Record<string, unknown> }).r3bautopop;
  const errors = (root["error"] ?? []) as AutoCalc["errors"];
  if (errors.length > 0) {
    issues.push(
      issue(
        "PORTAL_ERRORS",
        `the portal returned ${errors.length} error(s): ${errors.map((e) => e.error_cd).join(", ")}`,
      ),
    );
  }
  const meta: AutoCalc["meta"] = {};
  for (const k of ["r1fildt", "r2bgendt", "r3bgendt", "r1afildt"] as const) {
    const v = root[k];
    if (typeof v === "string") meta[k] = v;
  }
  return { ok: true, value: { meta, errors, data: root }, issues };
}
