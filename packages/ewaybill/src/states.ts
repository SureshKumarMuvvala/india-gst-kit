// Source: https://docs.ewaybillgst.gov.in/apidocs/state-code.html (source K2);
//         copy in sources/ewaybill/master-codes/state-codes.csv
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
//
// The e-way bill system's state list. It differs from the e-invoice list (model STATE_CODES, source A): it has
// no 25 and no 96, and 26 is the merged "DADRA AND NAGAR HAVELI & DAMAN AND DIU" (spec §13 D7). 99 is
// "OTHER COUNTRY"; the validations also accept 96, which the system stores as 99 ("For 'Other Country',
// State code as 96 as well as 99 are accepted but system stores the state code as 99").
// Codes are stored 2-digit like everywhere else in this repo; the EWB schema sends them as integers.

export const EWB_STATE_CODES: readonly { readonly code: string; readonly name: string }[] = [
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
  { code: "21", name: "ORISSA" },
  { code: "22", name: "CHHATTISGARH" },
  { code: "23", name: "MADHYA PRADESH" },
  { code: "24", name: "GUJARAT" },
  { code: "26", name: "DADRA AND NAGAR HAVELI & DAMAN AND DIU" },
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
  { code: "97", name: "OTHER TERRITORY" },
  { code: "99", name: "OTHER COUNTRY" },
];

const CODES: ReadonlySet<string> = new Set(EWB_STATE_CODES.map((s) => s.code));

/** True for a K2 state code, 2-digit (`"03"`). */
export function isEwbStateCode(code: string): boolean {
  return CODES.has(code);
}

/** The state code as the integer text the EWB schema carries: `"03"` → `"3"`. */
export function ewbStateInt(code: string): string {
  return String(Number(code));
}

/** An EWB integer state code → the 2-digit K2 form; 96 reads as 99. `undefined` if not a K2 code. */
export function ewbStateFromInt(value: string): string | undefined {
  if (!/^\d{1,2}$/.test(value)) return undefined;
  const padded = value.padStart(2, "0");
  const code = padded === "96" ? "99" : padded;
  return CODES.has(code) ? code : undefined;
}
