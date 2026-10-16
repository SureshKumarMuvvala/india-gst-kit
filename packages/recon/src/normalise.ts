/**
 * Document number as compared by recon (spec §5): trimmed, upper-cased, every run of Unicode whitespace
 * collapsed to one space. Punctuation and leading zeros are kept, so `INV/001` ≠ `INV/1` and `INV-1` ≠ `INV/1`.
 */
export function normaliseDocNumber(s: string): string {
  return s.trim().replace(/\s+/gu, " ").toUpperCase();
}

/**
 * Loose form, used only to suggest possible matches (spec §5, D-P3): {@link normaliseDocNumber}, then the
 * leading zeros of each maximal digit run are dropped (an all-zero run keeps a single `0`; the runs are
 * found before any punctuation is removed), then everything except `A–Z` and `0–9` is removed.
 */
export function looseDocNumber(s: string): string {
  return normaliseDocNumber(s)
    .replace(/\d+/gu, (run) => run.replace(/^0+(?=\d)/u, ""))
    .replace(/[^A-Z0-9]/gu, "");
}
