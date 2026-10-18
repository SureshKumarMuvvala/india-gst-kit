import { z } from "zod";

export const GSTR1_ISSUE_CODES = [
  "PERIOD_NOT_SUPPORTED",
  "SUPPLIER_MISMATCH",
  "SUPPLIER_GSTIN_FORMAT",
  "DATE_OUT_OF_RANGE",
  "DUPLICATE_DOCUMENT",
  "UNSUPPORTED_SUPPLIER",
  "UNSUPPORTED_DOCUMENT",
  "RATE_NOT_ACCEPTED",
  "REVERSE_CHARGE_B2C",
  "RECIPIENT_GSTIN_FORMAT",
  "POS_NOT_ACCEPTED",
  "AMOUNT_OUT_OF_RANGE",
  "CATEGORY_NEEDS_GSTIN",
  "POS_96_NOT_EXPORT",
  "ORIGINAL_NOT_FOUND",
  "NOTE_POS_MISMATCH",
  "HSN_LENGTH",
  "QTY_PRECISION",
  "DOC_ISSUE_INVALID",
  "FILE_TOO_LARGE",
  "SCHEMA",
  // Track A2 (spec §17.12)
  "AMENDMENT_PERIOD",
  "AMENDMENT_KIND_MISMATCH",
  "AMENDMENT_SECTION_CHANGE",
  "AMENDMENT_RECIPIENT_CHANGE",
  "AMENDMENT_POS_CHANGE",
  "AMENDMENT_USE_TABLE_10",
  "AMENDMENT_ORIGINAL_IN_PERIOD",
  "DUPLICATE_AMENDMENT",
  "DUPLICATE_B2CS_AMENDMENT",
  "B2CS_TAX_SPLIT",
  "DUPLICATE_NIL_ROW",
  "ADVANCE_TAX_SPLIT",
  "ADVANCE_PARTY_CHANGE",
  "ECO_GSTIN_FORMAT",
  "ECO_NOT_APPLICABLE",
  "ECO_UNKNOWN_DOCUMENT",
  "TAX_SPLIT",
  "NOT_IN_OFFLINE_SHAPE",
  /** Warning only (returned in `RenderResult.warnings`), from output (a). */
  "ECO_NOT_IN_API_SHAPE",
] as const;

export type Gstr1IssueCode = (typeof GSTR1_ISSUE_CODES)[number];

export interface Gstr1Issue {
  code: Gstr1IssueCode;
  message: string;
  documentNumber?: string;
  path?: (string | number)[];
}

export function issue(
  code: Gstr1IssueCode,
  message: string,
  where: { documentNumber?: string; path?: (string | number)[] } = {},
): Gstr1Issue {
  const out: Gstr1Issue = { code, message };
  if (where.documentNumber !== undefined) out.documentNumber = where.documentNumber;
  if (where.path !== undefined) out.path = where.path;
  return out;
}

/** S5 `fp` pattern: MMYYYY, years 1900–2099. */
export const ReturnPeriodSchema = z.string().regex(/^((0[1-9]|1[012])((19|20)\d\d))$/);
export type ReturnPeriod = z.infer<typeof ReturnPeriodSchema>;

export const SectionSchema = z.enum(["b2b", "b2cl", "b2cs", "cdnr", "cdnur", "exp"]);
/** The amendment sections of Tables 9A / 9C (spec §17.3). */
export const AmendmentSectionSchema = z.enum(["b2ba", "b2cla", "expa", "cdnra", "cdnura"]);
export type AmendmentSection = z.infer<typeof AmendmentSectionSchema>;
export type Section = z.infer<typeof SectionSchema>;

/** `YYYYMM` as a number, for comparing periods (the year first, then the month). */
export function periodKey(fp: ReturnPeriod): number {
  return Number(fp.slice(2)) * 100 + Number(fp.slice(0, 2));
}

/** `warnings` (spec §17.2, D-A8) hold facts the output could not carry while the rest is still correct. */
export type RenderResult<T> =
  | { ok: true; value: T; warnings: readonly Gstr1Issue[] }
  | { ok: false; issues: readonly Gstr1Issue[] };
