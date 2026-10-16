import { dropEmptyStrings, toEwbIssues } from "./json.js";
import {
  byIrnRules,
  dtlsRules,
  generateRules,
  type ByIrnOptions,
  type GenerateOptions,
} from "./rules.js";
import {
  EwbByIrnRequestSchema,
  EwbDtlsSchema,
  EwbRequestSchema,
  type EwbByIrnRequest,
  type EwbDtls,
  type EwbRequest,
} from "./schema.js";
import { hasErrors, type EwbValidationResult } from "./types.js";

/**
 * Validates a Generate-EWB request payload, ours or anyone else's: structure first (S-…), then the offline-checkable
 * rules V-T and V-G. `""` in the optional string fields of H counts as absent (D-M4). `value` is the typed payload
 * whenever the structure is valid, even if rules failed. The rules are not run on a structurally invalid payload.
 */
export function validateEwbRequest(
  req: unknown,
  options: GenerateOptions = {},
): EwbValidationResult<EwbRequest> {
  const input = dropEmptyStrings(req);
  const parsed = EwbRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: toEwbIssues(parsed.error.issues, input) };
  const issues = generateRules(parsed.data, options);
  return { ok: !hasErrors(issues), value: parsed.data, issues };
}

/** Validates an EWB-by-IRN request payload (schema, V-B and the transport rules). */
export function validateEwbByIrnRequest(
  req: unknown,
  options: ByIrnOptions = {},
): EwbValidationResult<EwbByIrnRequest> {
  const parsed = EwbByIrnRequestSchema.safeParse(req);
  if (!parsed.success) return { ok: false, issues: toEwbIssues(parsed.error.issues, req) };
  const issues = byIrnRules(parsed.data, options);
  return { ok: !hasErrors(issues), value: parsed.data, issues };
}

/** Validates the `EwbDtls` block of an IRN request (source C) with the transport rules. */
export function validateEwbDtls(
  block: unknown,
  options: ByIrnOptions = {},
): EwbValidationResult<EwbDtls> {
  const parsed = EwbDtlsSchema.safeParse(block);
  if (!parsed.success) return { ok: false, issues: toEwbIssues(parsed.error.issues, block) };
  const issues = dtlsRules(parsed.data, options);
  return { ok: !hasErrors(issues), value: parsed.data, issues };
}
