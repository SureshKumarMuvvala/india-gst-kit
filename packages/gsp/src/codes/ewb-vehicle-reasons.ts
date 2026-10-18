// Source: https://docs.ewaybillgst.gov.in/apidocs/master-codes-list.html —
//         sources/ewaybill/master-codes/vehicle-update-reason-codes.csv
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
export const EWB_VEHICLE_REASONS = {
  "1": "Due to Break Down",
  "2": "Due to Transshipment",
  "3": "Others (Pls. Specify)",
  "4": "First Time",
} as const;

export type EwbVehicleReason = keyof typeof EWB_VEHICLE_REASONS;
export const EWB_VEHICLE_REASON_CODES = Object.keys(EWB_VEHICLE_REASONS) as [
  EwbVehicleReason,
  ...EwbVehicleReason[],
];
