// Source: https://docs.ewaybillgst.gov.in/apidocs/master-codes-list.html (source K1, "Valid formats of vehicle
//         numbers"); copy in sources/ewaybill/master-codes/valid-formats-of-vehicle-numbers.csv
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
//
// K1 gives ten illustrative shapes, not patterns. This is our reading (spec §8.4): A = letter, 1 = digit,
// X = letter or digit; the whole string upper case, no spaces. The first two letters "are State Code", but
// the list of valid prefixes is not published (sources finding E9), so prefixes are not checked.
export const VEHICLE_NUMBER_SHAPES: readonly RegExp[] = [
  /^[A-Z]{2}\d{2}\d{4}$/, // AB121234
  /^[A-Z]{2}\d{2}[A-Z]\d{4}$/, // AB12A1234
  /^[A-Z]{2}\d{2}[A-Z]{2}\d{4}$/, // AB12AB1234
  /^[A-Z]{3}\d{4}$/, // ABC1234
  /^[A-Z]{2}\d{3}[A-Z]\d{4}$/, // AB123A1234
  /^[A-Z]{2}\d{2}[A-Z]{3}\d{4}$/, // AB12ABC1234
  /^DF[A-Z0-9]{6}$/, // DFXXXXXX (Defence)
  /^(TM|BP|NP)[A-Z0-9]{5,13}$/, // Temp RC / Bhutan / Nepal: "at least 7 characters"; H max 15
];

export function matchesVehicleShape(vehicleNo: string): boolean {
  return VEHICLE_NUMBER_SHAPES.some((r) => r.test(vehicleNo));
}
