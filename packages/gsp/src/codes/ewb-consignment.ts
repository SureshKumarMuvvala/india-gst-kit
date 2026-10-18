// Source: https://docs.ewaybillgst.gov.in/apidocs/master-codes-list.html —
//         sources/ewaybill/master-codes/consignment-status.csv, transportation-mode.csv;
//         https://docs.ewaybillgst.gov.in/apidocs/version1.03/extend-validity.html#validations —
//         sources/ewaybill/api/v1.03-extend-validity.txt
// Retrieved: 2026-10-16 (master codes), 2026-10-18 (extend validity)
// Status: UNVERIFIED — needs CA
//
// Transport modes 1–4 (Road, Rail, Air, Ship) ⇒ consignment status M and blank transit type;
// mode 5 (in transit) ⇒ status T and transit type R / W / O.
export const EWB_TRANSPORT_MODES = {
  "1": "Road",
  "2": "Rail",
  "3": "Air",
  "4": "Ship",
  "5": "inTransit",
} as const;

export const EWB_CONSIGNMENT_STATUS = { M: "inMovement", T: "inTransit" } as const;

export const EWB_TRANSIT_TYPES = { R: "Road", W: "Warehouse", O: "Others" } as const;

export type EwbTransportMode = keyof typeof EWB_TRANSPORT_MODES;
