import { toIrnIssues, serializeIrnRequest } from "./json.js";
import { MAX_PAYLOAD_BYTES, runRules, type ValidateOptions } from "./rules.js";
import { IrnRequestSchema, type IrnRequest } from "./schema.js";
import { hasErrors, issue, type IrnIssue } from "./types.js";

export type IrnValidationResult = { ok: boolean; value?: IrnRequest; issues: IrnIssue[] };

/**
 * Validates an IRN request payload, ours or anyone else's: structure first (schema S-…), then the
 * offline-checkable rules V1–V28 (including the ±1 rupee tolerance). `value` is the typed payload whenever the
 * structure is valid, even if rules failed. The rules are not run on a structurally invalid payload.
 */
export function validateIrnRequest(
  req: unknown,
  options: ValidateOptions = {},
): IrnValidationResult {
  const parsed = IrnRequestSchema.safeParse(req);
  if (!parsed.success) {
    return { ok: false, issues: toIrnIssues(parsed.error.issues, req, { request: true }) };
  }
  const value = parsed.data;
  const issues: IrnIssue[] = [];
  const bytes = Buffer.byteLength(serializeIrnRequest(value), "utf8");
  if (bytes > MAX_PAYLOAD_BYTES) {
    issues.push(
      issue(
        [],
        "SIZE",
        "S-SIZE",
        `Payload is ${bytes} bytes; the limit is ${MAX_PAYLOAD_BYTES} (2 MB)`,
      ),
    );
  }
  issues.push(...runRules(value, options));
  return { ok: !hasErrors(issues), value, issues };
}
