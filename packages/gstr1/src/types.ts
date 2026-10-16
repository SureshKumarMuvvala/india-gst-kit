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
export type Section = z.infer<typeof SectionSchema>;

/** `YYYYMM` as a number, for comparing periods (the year first, then the month). */
export function periodKey(fp: ReturnPeriod): number {
  return Number(fp.slice(2)) * 100 + Number(fp.slice(0, 2));
}

export type RenderResult<T> = { ok: true; value: T } | { ok: false; issues: readonly Gstr1Issue[] };
