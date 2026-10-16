import { z } from "zod";

export const ReconIssueCodeSchema = z.enum([
  "BAD_JSON",
  "SCHEMA",
  "WRONG_TYPE",
  "UNEXPECTED_KEY",
  "SCHEMA_VERSION",
  "CTIN_CHECK_DIGIT",
  "ITEMS_TOTAL_MISMATCH",
  "NO_AMOUNTS",
  "RECIPIENT_MISMATCH",
  "DUPLICATE_IN_REGISTER",
  "DUPLICATE_IN_2B",
]);

export const ReconIssueSchema = z.strictObject({
  path: z.array(z.union([z.string(), z.number()])),
  code: ReconIssueCodeSchema,
  message: z.string(),
  severity: z.enum(["error", "warning", "info"]),
});

export type ReconIssueCode = z.infer<typeof ReconIssueCodeSchema>;
export type ReconIssue = z.infer<typeof ReconIssueSchema>;

export function issue(
  path: readonly (string | number)[],
  code: ReconIssueCode,
  message: string,
  severity: ReconIssue["severity"] = "error",
): ReconIssue {
  return { path: [...path], code, message, severity };
}

export function hasErrors(issues: readonly ReconIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
