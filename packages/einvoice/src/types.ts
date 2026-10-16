import { z } from "zod";

export const IrnIssueSchema = z.strictObject({
  path: z.array(z.union([z.string(), z.number()])),
  code: z.enum([
    "SCHEMA",
    "SIZE",
    "RULE",
    "ARITHMETIC",
    "NOT_EINVOICEABLE",
    "UNEXPECTED_KEY",
    "WRONG_TYPE",
    "MALFORMED_JWT",
    "BAD_BASE64URL",
    "BAD_JSON",
    "UNSUPPORTED_ALG",
  ]),
  /** Stable id: `S-…` structural, `V…` validation, `M…` mapping precondition, `J-…` JWT decoding. */
  rule: z.string(),
  message: z.string(),
  severity: z.enum(["error", "warning"]),
});

export type IrnIssue = z.infer<typeof IrnIssueSchema>;
export type IrnIssueCode = IrnIssue["code"];

export function issue(
  path: readonly (string | number)[],
  code: IrnIssueCode,
  rule: string,
  message: string,
  severity: "error" | "warning" = "error",
): IrnIssue {
  return { path: [...path], code, rule, message, severity };
}

export function hasErrors(issues: readonly IrnIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
