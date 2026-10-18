import { z } from "zod";

// Issue codes (spec §11).
export const GSTR3B_ISSUE_CODES = [
  // errors
  "GSTR1_INVALID",
  "GSTR1_GSTIN_MISMATCH",
  "GSTR1_PERIOD_MISMATCH",
  "TRAIL_MISMATCH",
  "AMOUNT_OUT_OF_RANGE",
  "NEGATIVE_NOT_ALLOWED",
  "PERIOD_FORMAT",
  "GSTIN_INVALID",
  "GSTIN_NOT_ACCEPTED_BY_3B",
  "POS_NOT_ACCEPTED",
  "POS_UNKNOWN",
  "DUPLICATE_POS",
  "CALLER_LABEL_MISSING",
  "FIELD_NOT_IN_BOX",
  "SCHEMA",
  "WRONG_TYPE",
  // unmapped gstr1 data
  "RCM_NOT_MAPPED",
  "INTRA_ITEM_IN_32",
  "INTRA_ITEM_IN_31B",
  "NOTE_POS_MISSING",
  // other warnings
  "ITC_NET_DIFFERS",
  "T32_EXCEEDS_31A",
  "PERIOD_MIXED",
  "RECIPIENT_MISMATCH",
  "UNEXPECTED_KEY",
  "PORTAL_ERRORS",
  "SCHEMA_VERSION",
] as const;
export const Gstr3bIssueCodeSchema = z.enum(GSTR3B_ISSUE_CODES);
export type Gstr3bIssueCode = z.infer<typeof Gstr3bIssueCodeSchema>;

export const SeveritySchema = z.enum(["error", "warning", "info"]);
export type Severity = z.infer<typeof SeveritySchema>;

/** Box ids (spec §3.2). */
export const BOX_IDS = [
  "3.1a",
  "3.1b",
  "3.1c",
  "3.1d",
  "3.1e",
  "3.1.1i",
  "3.1.1ii",
  "3.2unreg",
  "3.2comp",
  "3.2uin",
  "4A.IMPG",
  "4A.IMPS",
  "4A.ISRC",
  "4A.ISD",
  "4A.OTH",
  "4B.RUL",
  "4B.OTH",
  "4C",
  "4D.RUL",
  "4D.OTH",
  "5.GST",
  "5.NONGST",
  "5.1",
] as const;
export const BoxIdSchema = z.enum(BOX_IDS);
export type BoxId = z.infer<typeof BoxIdSchema>;

export const Gstr3bIssueSchema = z.strictObject({
  code: Gstr3bIssueCodeSchema,
  severity: SeveritySchema,
  message: z.string(),
  box: BoxIdSchema.optional(),
  pos: z.string().optional(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
});
export type Gstr3bIssue = z.infer<typeof Gstr3bIssueSchema>;

const WARNING_CODES: ReadonlySet<Gstr3bIssueCode> = new Set<Gstr3bIssueCode>([
  "RCM_NOT_MAPPED",
  "INTRA_ITEM_IN_31B",
  "NOTE_POS_MISSING",
  "ITC_NET_DIFFERS",
  "T32_EXCEEDS_31A",
  "PERIOD_MIXED",
  "RECIPIENT_MISMATCH",
  "UNEXPECTED_KEY",
  "PORTAL_ERRORS",
  "SCHEMA_VERSION",
]);
/** INTRA_ITEM_IN_32 is information only: 3.2 covers inter-State supplies (FG-3B), so leaving it out is expected. */
const INFO_CODES: ReadonlySet<Gstr3bIssueCode> = new Set<Gstr3bIssueCode>(["INTRA_ITEM_IN_32"]);

export function severityOf(code: Gstr3bIssueCode): Severity {
  if (INFO_CODES.has(code)) return "info";
  return WARNING_CODES.has(code) ? "warning" : "error";
}

export function issue(
  code: Gstr3bIssueCode,
  message: string,
  extra: { box?: BoxId; pos?: string; path?: (string | number)[]; severity?: Severity } = {},
): Gstr3bIssue {
  const out: Gstr3bIssue = { code, severity: extra.severity ?? severityOf(code), message };
  if (extra.box !== undefined) out.box = extra.box;
  if (extra.pos !== undefined) out.pos = extra.pos;
  if (extra.path !== undefined) out.path = extra.path;
  return out;
}

export function hasErrors(issues: readonly Gstr3bIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

export type RenderResult<T> =
  { ok: true; value: T } | { ok: false; issues: readonly Gstr3bIssue[] };
