// Source: S5 definitions `#gstin`, `#ctin`, `#inum`, `#state_cd`, `#state_cd_foreign`, `#nonEmptydate`
//         — sources/gstr1/gstr1-save-v5.0-schema.json (patterns copied; the schema's GSTIN patterns have no
//         ^…$ anchors but minLength = maxLength = 15, so anchoring them is equivalent)
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA

/** S5 `#gstin`: the supplier (filer) GSTIN, PAN-structured. */
export const GSTIN_PATTERN =
  /^[0-9]{2}[a-zA-Z]{5}[0-9]{4}[a-zA-Z]{1}[1-9A-Za-z]{1}[Zz1-9A-Ja-j]{1}[0-9a-zA-Z]{1}$/;

/** S5 `#ctin` anyOf: regular GSTIN, UIN, NRTP, TDS. */
export const CTIN_PATTERNS: readonly RegExp[] = [
  GSTIN_PATTERN,
  /^[0-9]{4}[A-Z]{3}[0-9]{5}[UO]{1}[N][A-Z0-9]{1}$/,
  /^[0-9]{4}[a-zA-Z]{3}[0-9]{5}[N][R][0-9a-zA-Z]{1}$/,
  /^[0-9]{2}[a-zA-Z]{4}[a-zA-Z0-9]{1}[0-9]{4}[a-zA-Z]{1}[1-9A-Za-z]{1}[D]{1}[0-9a-zA-Z]{1}$/,
];

/** S5 `#etin` (TCS operator GSTIN) — allowed only in the offline-upload shape (S4). */
export const ETIN_PATTERN =
  /^[0-9]{2}[a-zA-Z]{5}[0-9]{4}[a-zA-Z]{1}[1-9A-Za-z]{1}[C]{1}[0-9a-zA-Z]{1}$/;

/** S5 `#inum` (document number). */
export const INUM_PATTERN = /^(?=.{1,16}$)([/0-]*[a-zA-Z0-9/-]*[a-zA-Z1-9]+[a-zA-Z0-9/-]*)$/;

/** S5 `#state_cd` (b2cl, b2cs, cdnur): no 96. */
export const POS_PATTERN = /^(3[0-8]|[12][0-9]|0[1-9]|97)$/;
/** S5 `#state_cd_foreign` (b2b, cdnr): also 96. */
export const POS_FOREIGN_PATTERN = /^(3[0-8]|[12][0-9]|0[1-9]|96|97)$/;

/** S5 `#nonEmptydate`: DD-MM-YYYY, calendar-checked. */
export const WIRE_DATE_PATTERN =
  /^(0[1-9]|1[0-9]|2[0-8]|29((?=-([0][13-9]|1[0-2])|(?=-(0[1-9]|1[0-2])-([0-9]{2}(0[48]|[13579][26]|[2468][048])|([02468][048]|[13579][26])00))))|30(?=-(0[13-9]|1[0-2]))|31(?=-(0[13578]|1[02])))-(0[1-9]|1[0-2])-[0-9]{4}$/;

export function isS5Gstin(s: string): boolean {
  return GSTIN_PATTERN.test(s);
}

export function isS5Ctin(s: string): boolean {
  return CTIN_PATTERNS.some((p) => p.test(s));
}
