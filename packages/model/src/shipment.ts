import { z } from "zod";
import type { DispatchFrom, ShipTo } from "./schema/ship.js";

// Source: e-invoice validations lines 29–31 (sources/einvoice/generate-irn-validations.txt);
//         EWB transaction types (sources/ewaybill/master-codes/transaction-types.csv)
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
export const ShipmentPatternSchema = z.enum([
  "REGULAR",
  "BILL_TO_SHIP_TO",
  "BILL_FROM_DISPATCH_FROM",
  "COMBINATION",
]);
export type ShipmentPattern = z.infer<typeof ShipmentPatternSchema>;

/** Shipping party ⇒ Bill To–Ship To; dispatching party ⇒ Bill From–Dispatch From; both ⇒ Combination. */
export function shipmentPattern(doc: {
  shipTo?: ShipTo | undefined;
  dispatchFrom?: DispatchFrom | undefined;
}): ShipmentPattern {
  const ship = doc.shipTo !== undefined;
  const dispatch = doc.dispatchFrom !== undefined;
  if (ship && dispatch) return "COMBINATION";
  if (ship) return "BILL_TO_SHIP_TO";
  if (dispatch) return "BILL_FROM_DISPATCH_FROM";
  return "REGULAR";
}
