import { z } from "zod";

/**
 * A finding attached to a result. Warnings never block; errors only appear inside a `validation` error (issues
 * from the reused einvoice/ewaybill validators and our own request schemas).
 */
export const GspIssueSchema = z.strictObject({
  code: z.string(),
  severity: z.enum(["error", "warning"]),
  message: z.string(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
  /** Stable rule id when the issue comes from a validator (`S-…`, `V…`, `R-…`, `PC…`). */
  rule: z.string().optional(),
});

export type GspIssue = z.infer<typeof GspIssueSchema>;

export function warning(
  code: string,
  message: string,
  path?: readonly (string | number)[],
): GspIssue {
  return path === undefined
    ? { code, severity: "warning", message }
    : { code, severity: "warning", message, path: [...path] };
}

export function hasErrorIssues(issues: readonly GspIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

/** Converts an IrnIssue / EwbIssue (same shape) into a GspIssue. */
export function fromPackageIssue(i: {
  path: (string | number)[];
  code: string;
  rule: string;
  message: string;
  severity: "error" | "warning";
}): GspIssue {
  return {
    code: i.code,
    severity: i.severity,
    message: i.message,
    path: [...i.path],
    rule: i.rule,
  };
}
