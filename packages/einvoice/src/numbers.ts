import type { z } from "zod";
import { convertNumbers, type LosslessTypeIssue } from "@india-gst-kit/model";
import { issue, type IrnIssue } from "./types.js";

/** `convertNumbers` from `@india-gst-kit/model`, with each mismatch reported as a WRONG_TYPE {@link IrnIssue}. */
export function convertIrnNumbers(
  value: unknown,
  schema: z.ZodType,
  issues: IrnIssue[],
  prefix: (string | number)[] = [],
  rule = "S-TYPE",
): unknown {
  const found: LosslessTypeIssue[] = [];
  const out = convertNumbers(value, schema, [], found, prefix);
  for (const f of found) issues.push(issue(f.path, "WRONG_TYPE", rule, f.message));
  return out;
}
