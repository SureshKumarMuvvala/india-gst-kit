// Source: https://docs.ewaybillgst.gov.in/apidocs/master-codes-list.html —
//         sources/ewaybill/master-codes/cancellation-reason-codes.csv
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
//
// Different from the e-invoice cancellation codes: 2 and 3 are swapped (spec §13 GD1, D-G14). Never translate.
export const EWB_CANCEL_REASONS = {
  "1": "Duplicate",
  "2": "Order Cancelled",
  "3": "Data Entry mistake",
  "4": "Others",
} as const;

export type EwbCancelReason = keyof typeof EWB_CANCEL_REASONS;
export const EWB_CANCEL_REASON_CODES = Object.keys(EWB_CANCEL_REASONS) as [
  EwbCancelReason,
  ...EwbCancelReason[],
];
