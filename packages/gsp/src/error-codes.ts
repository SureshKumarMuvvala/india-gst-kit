import { z } from "zod";
import { SystemSchema, type System } from "./errors.js";

/**
 * One row of a caller-supplied error-code table.
 * Deprecated (spec errors D-E11): the official lists ship in `@india-gst-kit/errors` and every `api` error entry
 * carries their text. Kept for one minor version; a table passed as `errorCodeTable` still overrides
 * `officialMessage`.
 */
export const ErrorCodeInfoSchema = z.strictObject({
  system: SystemSchema,
  code: z.string(),
  message: z.string(),
  source: z.string(),
  retrieved: z.string(),
});
export type ErrorCodeInfo = z.infer<typeof ErrorCodeInfoSchema>;

/**
 * Looks a code up in a caller-supplied table.
 * Deprecated (spec errors D-E11): use `describeError` from `@india-gst-kit/errors`.
 */
export function describeErrorCode(
  system: System,
  code: string,
  table: readonly ErrorCodeInfo[] = [],
): ErrorCodeInfo | undefined {
  return table.find((r) => r.system === system && r.code === code.trim());
}
