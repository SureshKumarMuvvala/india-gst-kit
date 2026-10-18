import type { z } from "zod";
import { zodPath } from "@india-gst-kit/model";
import { hasErrorIssues, type GspIssue } from "./issues.js";

export type RequestValidation<T> = { ok: boolean; value?: T; issues: GspIssue[] };

/** Strict schema first (unknown keys are errors for requests), then the cross-field rules on a valid shape. */
export function validateWith<S extends z.ZodType>(
  schema: S,
  input: unknown,
  rules: (value: z.output<S>) => GspIssue[] = () => [],
): RequestValidation<z.output<S>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issues: GspIssue[] = [];
    for (const i of parsed.error.issues) {
      const path = zodPath(i.path);
      if (i.code === "unrecognized_keys") {
        for (const key of i.keys) {
          issues.push({
            code: "UNEXPECTED_KEY",
            severity: "error",
            message: `unknown key "${key}"`,
            path: [...path, key],
            rule: "S-UNKNOWN-KEY",
          });
        }
      } else {
        issues.push({
          code: "SCHEMA",
          severity: "error",
          message: i.message,
          path,
          rule: "S-SCHEMA",
        });
      }
    }
    return { ok: false, issues };
  }
  const issues = rules(parsed.data);
  return { ok: !hasErrorIssues(issues), value: parsed.data, issues };
}

export function ruleError(rule: string, message: string, path: (string | number)[]): GspIssue {
  return { code: "RULE", severity: "error", message, path, rule };
}
