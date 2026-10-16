// Source: https://einvoice1.gst.gov.in/Others/MasterCodes (table "State Code"; copy in sources/einvoice/master-codes/state-codes.csv)
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA

export type StateCode = string;

// Codes are zero-padded to 2 digits (the master publishes them without the leading zero).
// Notes from the e-invoice validations (sources/README.md, finding 5): there is no code 28; 25 is
// still listed but withdrawn as a place of supply; 96 and 99 are both "OTHER COUNTRIES".
export const STATE_CODES: readonly { readonly code: StateCode; readonly name: string }[] = [
  { code: "01", name: "JAMMU AND KASHMIR" },
  { code: "02", name: "HIMACHAL PRADESH" },
  { code: "03", name: "PUNJAB" },
  { code: "04", name: "CHANDIGARH" },
  { code: "05", name: "UTTARAKHAND" },
  { code: "06", name: "HARYANA" },
  { code: "07", name: "DELHI" },
  { code: "08", name: "RAJASTHAN" },
  { code: "09", name: "UTTAR PRADESH" },
  { code: "10", name: "BIHAR" },
  { code: "11", name: "SIKKIM" },
  { code: "12", name: "ARUNACHAL PRADESH" },
  { code: "13", name: "NAGALAND" },
  { code: "14", name: "MANIPUR" },
  { code: "15", name: "MIZORAM" },
  { code: "16", name: "TRIPURA" },
  { code: "17", name: "MEGHALAYA" },
  { code: "18", name: "ASSAM" },
  { code: "19", name: "WEST BENGAL" },
  { code: "20", name: "JHARKHAND" },
  { code: "21", name: "ODISHA" },
  { code: "22", name: "CHHATTISGARH" },
  { code: "23", name: "MADHYA PRADESH" },
  { code: "24", name: "GUJARAT" },
  { code: "25", name: "DAMAN AND DIU" },
  { code: "26", name: "DADRA AND NAGAR HAVELI" },
  { code: "27", name: "MAHARASHTRA" },
  { code: "29", name: "KARNATAKA" },
  { code: "30", name: "GOA" },
  { code: "31", name: "LAKSHADWEEP" },
  { code: "32", name: "KERALA" },
  { code: "33", name: "TAMIL NADU" },
  { code: "34", name: "PUDUCHERRY" },
  { code: "35", name: "ANDAMAN AND NICOBAR" },
  { code: "36", name: "TELANGANA" },
  { code: "37", name: "ANDHRA PRADESH" },
  { code: "38", name: "LADAKH" },
  { code: "96", name: "OTHER COUNTRIES" },
  { code: "97", name: "Other Territory" },
  { code: "99", name: "OTHER COUNTRIES" },
];

const BY_CODE: ReadonlyMap<string, string> = new Map(STATE_CODES.map((s) => [s.code, s.name]));

function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

// First entry wins, so "OTHER COUNTRIES" resolves to 96 (the code source C uses for POS outside India).
const BY_NAME: ReadonlyMap<string, StateCode> = (() => {
  const m = new Map<string, StateCode>();
  for (const s of STATE_CODES) {
    const key = normaliseName(s.name);
    if (!m.has(key)) m.set(key, s.code);
  }
  return m;
})();

const OUTSIDE_INDIA: ReadonlySet<string> = new Set(["96", "99"]);

export function isStateCode(code: string): code is StateCode {
  return BY_CODE.has(code);
}

export function stateName(code: string): string | undefined {
  return BY_CODE.get(code);
}

export function stateCodeFromName(name: string): StateCode | undefined {
  return BY_NAME.get(normaliseName(name));
}

/** "1" → "01". Returns undefined for anything that is not a listed state code. */
export function normaliseStateCode(code: string): StateCode | undefined {
  const t = code.trim();
  if (!/^\d{1,2}$/.test(t)) return undefined;
  const padded = t.padStart(2, "0");
  return isStateCode(padded) ? padded : undefined;
}

/** False for 25 (Daman and Diu): withdrawn as place of supply per the e-invoice validations. */
export function isPlaceOfSupplyCode(code: string): boolean {
  return isStateCode(code) && code !== "25";
}

/** False for 96 / 99 (Other Countries): they cannot prefix a GSTIN. */
export function isGstinStateCode(code: string): boolean {
  return isStateCode(code) && !OUTSIDE_INDIA.has(code);
}
