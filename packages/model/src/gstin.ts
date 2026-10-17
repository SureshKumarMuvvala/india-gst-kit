// Structure: sources/einvoice/generate-irn-json-schema.json — the only official pattern is the loose
// `[0-9]{2}[0-9A-Z]{13}`. Check digit: no official document exists; the publicly documented mod-36
// algorithm is used. Status: UNVERIFIED — needs CA (see docs/legal-facts.md).
import { isGstinStateCode } from "./states.js";
import type { StateCode } from "./primitives.js";

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PATTERN = /^[0-9]{2}[0-9A-Z]{13}$/;

/**
 * Official loose pattern plus a GSTIN-capable state code, and not a temporary ID (spec §6.4: some `…TMP` values
 * happen to pass mod-36, e.g. `330000000000TMP`; they are still rejected). Does not look at the check digit.
 */
export function isGstinStructurallyValid(gstin: string): boolean {
  return PATTERN.test(gstin) && isGstinStateCode(gstin.slice(0, 2)) && !isTemporaryId(gstin);
}

/**
 * Shape of a temporary ID seen on a real document: 2-digit state + 10 digits + "TMP". Not a GSTIN;
 * accepting such IDs as recipients is deferred (spec §12). Shape only, nothing official is known.
 */
export function isTemporaryId(value: string): boolean {
  return /^[0-9]{12}TMP$/.test(value);
}

/** mod-36 check character for the first 14 characters. Throws unless given 14 chars of [0-9A-Z]. */
export function gstinCheckDigit(first14: string): string {
  if (!/^[0-9A-Z]{14}$/.test(first14)) {
    throw new RangeError("gstinCheckDigit(): expected 14 characters from [0-9A-Z]");
  }
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = CHARSET.indexOf(first14.charAt(i)) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET.charAt((36 - (sum % 36)) % 36);
}

export function isValidGstin(gstin: string): boolean {
  return (
    isGstinStructurallyValid(gstin) && gstinCheckDigit(gstin.slice(0, 14)) === gstin.charAt(14)
  );
}

/** Splits a structurally valid GSTIN; the check digit is not verified here. */
export function parseGstin(
  gstin: string,
): { stateCode: StateCode; panOrId: string; entityCode: string; checkDigit: string } | undefined {
  if (!isGstinStructurallyValid(gstin)) return undefined;
  return {
    stateCode: gstin.slice(0, 2),
    panOrId: gstin.slice(2, 12),
    entityCode: gstin.charAt(12),
    checkDigit: gstin.charAt(14),
  };
}
