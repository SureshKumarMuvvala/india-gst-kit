import type { StateCode, SupplyCategory, TaxSplit } from "./primitives.js";

export function decideTaxSplit(
  supplierState: StateCode,
  placeOfSupply: StateCode,
  category: SupplyCategory = "DOMESTIC",
): TaxSplit {
  return supplierState === placeOfSupply && category === "DOMESTIC" ? "INTRA" : "INTER";
}

// Source: UTGST Act 2017 s.2(8) and CGST Act s.2(114), as enacted — sources/acts/ (GST Council site)
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
// Andaman and Nicobar Islands (35), Lakshadweep (31), Dadra and Nagar Haveli (26), Daman and Diu (25),
// Chandigarh (04), other territory (97). Later amendments (Ladakh, the 2020 Dadra/Daman merger) were
// not retrieved, so Ladakh (38) is NOT listed here.
const UTGST_CODES: ReadonlySet<string> = new Set(["35", "31", "26", "25", "04", "97"]);

export function usesUtgst(stateCode: StateCode): boolean {
  return UTGST_CODES.has(stateCode);
}
