import { z } from "zod";
import { SystemSchema, type System } from "./errors.js";

/**
 * One row of an official error-code table. v0.1 ships no table: the lists are not captured (spec §7.4, D-G20,
 * §16 F2). A later build adds the official one as its own sourced file; callers may pass their own.
 */
export const ErrorCodeInfoSchema = z.strictObject({
  system: SystemSchema,
  code: z.string(),
  message: z.string(),
  source: z.string(),
  retrieved: z.string(),
});
export type ErrorCodeInfo = z.infer<typeof ErrorCodeInfoSchema>;

export function describeErrorCode(
  system: System,
  code: string,
  table: readonly ErrorCodeInfo[] = [],
): ErrorCodeInfo | undefined {
  return table.find((r) => r.system === system && r.code === code.trim());
}
