// Safe placeholder filling (spec §5.3, X8, D-E6).

/** Cuts a sanitised value longer than this many characters (params). */
export const PARAM_MAX_LENGTH = 100;
/** Cuts a sanitised `returnedMessage` longer than this. */
export const RETURNED_MESSAGE_MAX_LENGTH = 500;

const WHITESPACE_RUN = /\s+/gu;
/** C0/C1 controls and the bidi controls U+200E, U+200F, U+202A–U+202E, U+2066–U+2069. */
function isControl(cp: number): boolean {
  return (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    cp === 0x200e ||
    cp === 0x200f ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069)
  );
}

function removeControls(text: string): string {
  let out = "";
  for (const ch of text) if (!isControl(ch.codePointAt(0) ?? 0)) out += ch;
  return out;
}
const PLACEHOLDER = /\{(\d+)\}/g;

/** Collapses whitespace, removes control and bidi characters, trims, and cuts to `max` characters plus `…`. */
export function sanitizeText(value: string, max: number): string {
  const clean = removeControls(value.replace(WHITESPACE_RUN, " ")).trim();
  if (clean.length <= max) return clean;
  // Do not split a surrogate pair at the cut.
  const end = /[\ud800-\udbff]/.test(clean.charAt(max - 1)) ? max - 1 : max;
  return `${clean.slice(0, end)}…`;
}

/**
 * Fills `{0}`, `{1}`, … in one pass. Only `{digits}` is a placeholder (`{0)` is literal text); replacement text is
 * never scanned again; each value is sanitised. A placeholder without a value stays as written and sets `missing`.
 */
export function fillPlaceholders(
  template: string,
  params: readonly string[] = [],
): { text: string; missing: boolean } {
  let missing = false;
  const text = template.replace(PLACEHOLDER, (whole, index: string) => {
    const value = params[Number(index)];
    if (value === undefined) {
      missing = true;
      return whole;
    }
    return sanitizeText(value, PARAM_MAX_LENGTH);
  });
  return { text, missing };
}

/** True when the template has a placeholder-like token that is not `{digits}`, e.g. EWB 4074's `{0)`. */
export function hasMalformedPlaceholder(template: string): boolean {
  return /\{\d+(?!\d*\})/.test(template);
}
