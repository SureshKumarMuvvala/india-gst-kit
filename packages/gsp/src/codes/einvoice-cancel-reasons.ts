// Source: https://einv-apisandbox.nic.in/version1.03/cancel-irn.html#JSONSchema —
//         sources/einvoice/api/v1.03-cancel-irn.txt (`CnlRsn` description)
// Retrieved: 2026-10-18
// Status: UNVERIFIED — needs CA
//
// Different from the e-way bill cancellation codes: 2 and 3 are swapped (spec §13 GD1, D-G14). Never translate.
export const EINVOICE_CANCEL_REASONS = {
  "1": "Duplicate",
  "2": "Data entry mistake",
  "3": "Order Cancelled",
  "4": "Others",
} as const;

export type EinvoiceCancelReason = keyof typeof EINVOICE_CANCEL_REASONS;
export const EINVOICE_CANCEL_REASON_CODES = Object.keys(EINVOICE_CANCEL_REASONS) as [
  EinvoiceCancelReason,
  ...EinvoiceCancelReason[],
];
