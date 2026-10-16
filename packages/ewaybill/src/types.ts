import { z } from "zod";

export const EwbIssueSchema = z.strictObject({
  path: z.array(z.union([z.string(), z.number()])),
  code: z.enum([
    "SCHEMA",
    "RULE",
    "WRONG_TYPE",
    "UNEXPECTED_KEY",
    "BAD_JSON",
    "BAD_MOVEMENT",
    "NOT_EWB_DOCUMENT",
    "USE_IRN_ROUTE",
    "MISSING_PIN",
    "EXPORT_NEEDS_PORT_SHIP_TO",
    "STATE_SPLIT_MISMATCH",
    "HSN_LEADING_ZERO",
    "EINVOICE_STATUS_UNKNOWN",
  ]),
  /** Stable id: `S-…` schema, `V-T…` transport, `V-G…` Generate, `V-B…` by-IRN, `M-…` mapping, `R-…` route, `P-…` responses. */
  rule: z.string(),
  message: z.string(),
  severity: z.enum(["error", "warning"]),
});

export type EwbIssue = z.infer<typeof EwbIssueSchema>;
export type EwbIssueCode = EwbIssue["code"];

export function issue(
  path: readonly (string | number)[],
  code: EwbIssueCode,
  rule: string,
  message: string,
  severity: "error" | "warning" = "error",
): EwbIssue {
  return { path: [...path], code, rule, message, severity };
}

export const rule = (
  path: readonly (string | number)[],
  ruleId: string,
  message: string,
  severity: "error" | "warning" = "error",
): EwbIssue => issue(path, "RULE", ruleId, message, severity);

export function hasErrors(issues: readonly EwbIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

export type EwbValidationResult<T> = { ok: boolean; value?: T; issues: EwbIssue[] };
