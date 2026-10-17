import { z } from "zod";
import { GstinSchema } from "../primitives.js";
import { isGstinStateCode } from "../states.js";
import { AddressSchema } from "./party.js";

// Ship-to / dispatch-from parties (spec §5.7). Sources: e-invoice schema `DispDtls` / `ShipDtls` and
// validations lines 29–32 (sources/einvoice/); EWB validations lines 49–50 and the EWB-by-IRN
// `DispDtls` / `ExpShipDtls` blocks (sources/ewaybill/).

/**
 * An address goods are shipped to or dispatched from: PIN required, in India (state not 96/99,
 * country IN). Every target block needs a 6-digit PIN; for exports the ship-to is the port in India
 * (decision D-S3, needs CA). A PIN outside the state's range is a warning only (§6.7).
 */
export const ShipAddressSchema = AddressSchema.superRefine((a, ctx) => {
  if (a.pincode === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["pincode"],
      message: "pincode is required for a ship-to / dispatch-from address",
    });
  }
  if (!isGstinStateCode(a.stateCode)) {
    ctx.addIssue({
      code: "custom",
      path: ["stateCode"],
      message: "a ship-to / dispatch-from address must be in India (not state 96 or 99)",
    });
  }
  if (a.country !== "IN") {
    ctx.addIssue({
      code: "custom",
      path: ["country"],
      message: 'a ship-to / dispatch-from address must have country "IN"',
    });
  }
});

/** "Bill To – Ship To": the consignee. `gstin` absent = unregistered or a port (never `URP`, D-S4). */
export const ShipToSchema = z.strictObject({
  legalName: z.string().trim().min(1).max(200),
  tradeName: z.string().max(200).optional(),
  gstin: GstinSchema.optional(),
  address: ShipAddressSchema,
});

/** "Bill From – Dispatch From". No GSTIN or trade name: no source field carries them (D-S2). */
export const DispatchFromSchema = z.strictObject({
  legalName: z.string().trim().min(1).max(200),
  address: ShipAddressSchema,
});

export type ShipAddress = z.infer<typeof ShipAddressSchema>;
export type ShipTo = z.infer<typeof ShipToSchema>;
export type DispatchFrom = z.infer<typeof DispatchFromSchema>;
