// Source: https://docs.ewaybillgst.gov.in/apidocs/master-codes-list.html —
//         sources/ewaybill/master-codes/reasons-for-extension-of-validity.csv
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
//
// There is no code 3 in the source.
export const EWB_EXTENSION_REASONS = {
  "1": "Natural Calamity",
  "2": "Law and Order Situation",
  "4": "Transshipment",
  "5": "Accident",
  "99": "Others",
} as const;

export type EwbExtensionReason = keyof typeof EWB_EXTENSION_REASONS;
export const EWB_EXTENSION_REASON_CODES = Object.keys(EWB_EXTENSION_REASONS) as [
  EwbExtensionReason,
  ...EwbExtensionReason[],
];
