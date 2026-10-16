// Source: https://docs.ewaybillgst.gov.in/apidocs/master-codes-list.html (source K1);
//         copies in sources/ewaybill/master-codes/{supply-type,sub-supply-type,document-type,transportation-mode,vehicle-type,transaction-types}.csv
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
//
// The e-way bill master codes this package enforces. Mode 5 "inTransit" of K1 is in no schema enum and is not
// supported. Document types BOE, CHL and OTH and sub-types other than 1 and 3 are listed because the validator
// checks payloads built elsewhere; the mapper only produces INV/BIL and sub-types 1/3 (spec §16).

export const EWB_SUPPLY_TYPES: readonly { readonly code: string; readonly name: string }[] = [
  { code: "I", name: "Inward" },
  { code: "O", name: "Outward" },
];

export const EWB_SUB_SUPPLY_TYPES: readonly { readonly code: string; readonly name: string }[] = [
  { code: "1", name: "Supply" },
  { code: "2", name: "Import" },
  { code: "3", name: "Export" },
  { code: "4", name: "Job Work" },
  { code: "5", name: "For Own Use" },
  { code: "6", name: "Job work Returns" },
  { code: "7", name: "Sales Return" },
  { code: "8", name: "Others" },
  { code: "9", name: "SKD/CKD/Lots" },
  { code: "10", name: "Line Sales" },
  { code: "11", name: "Recipient Not Known" },
  { code: "12", name: "Exhibition or Fairs" },
];

export const EWB_DOC_TYPES: readonly { readonly code: string; readonly name: string }[] = [
  { code: "INV", name: "Tax Invoice" },
  { code: "BIL", name: "Bill of Supply" },
  { code: "BOE", name: "Bill of Entry" },
  { code: "CHL", name: "Delivery Challan" },
  { code: "OTH", name: "Others" },
];

export const EWB_TRANSPORT_MODES: readonly { readonly code: string; readonly name: string }[] = [
  { code: "1", name: "Road" },
  { code: "2", name: "Rail" },
  { code: "3", name: "Air" },
  { code: "4", name: "Ship" },
];

export const EWB_VEHICLE_TYPES: readonly { readonly code: string; readonly name: string }[] = [
  { code: "R", name: "Regular" },
  { code: "O", name: "ODC (Over Dimensional Cargo)" },
];

export const EWB_TRANSACTION_TYPES: readonly { readonly code: string; readonly name: string }[] = [
  { code: "1", name: "Regular" },
  { code: "2", name: "Bill To - Ship To" },
  { code: "3", name: "Bill From - Dispatch From" },
  { code: "4", name: "Combination of 2 and 3" },
];

const has = (list: readonly { readonly code: string }[], code: string): boolean =>
  list.some((c) => c.code === code);

export const isEwbSupplyType = (c: string): boolean => has(EWB_SUPPLY_TYPES, c);
export const isEwbSubSupplyType = (c: string): boolean => has(EWB_SUB_SUPPLY_TYPES, c);
export const isEwbDocType = (c: string): boolean => has(EWB_DOC_TYPES, c);
export const isEwbTransactionType = (c: string): boolean => has(EWB_TRANSACTION_TYPES, c);

/** Model transport mode → EWB code. */
export const MODE_CODE = { ROAD: "1", RAIL: "2", AIR: "3", SHIP: "4" } as const;
/** Model vehicle type → EWB code. */
export const VEHICLE_TYPE_CODE = { REGULAR: "R", ODC: "O" } as const;
