import { z } from "zod";
import { DispatchFromSchema, IsoDateSchema, ShipAddressSchema } from "@india-gst-kit/model";

export const EwbTransportSchema = z.strictObject({
  /** Integer km; "0" lets the portal compute it. */
  distanceKm: z.string().regex(/^(0|[1-9]\d{0,3})$/),
  /** Absent = Part-A only. */
  mode: z.enum(["ROAD", "RAIL", "AIR", "SHIP"]).optional(),
  /** No normalisation: lower case or spaces are rejected. */
  vehicleNo: z
    .string()
    .regex(/^[A-Z0-9]{4,20}$/)
    .optional(),
  vehicleType: z.enum(["REGULAR", "ODC"]).optional(),
  transportDocNo: z.string().optional(),
  transportDocDate: IsoDateSchema.optional(),
  /** GSTIN or TRANSIN, 15 characters. */
  transporterId: z.string().optional(),
  transporterName: z.string().optional(),
});

/**
 * Movement details the document model does not carry (spec §3). Only the shape is checked here; the transport
 * rules run on the mapped payload, so payloads built elsewhere get the same checks.
 *
 * `dispatchFrom` / `shipTo` are for EWB-by-IRN only (I validations lines 16–17: addresses not sent with the IRN, or
 * the export port, can be sent there; decision D-S11). On the Generate route they come from the document, and a
 * movement carrying them is the error `ADDRESS_IN_MOVEMENT`. `shipTo` has no name or GSTIN: I's `ExpShipDtls` has
 * neither (decision D-Q7, still deferred).
 */
export const EwbMovementSchema = z.strictObject({
  transport: EwbTransportSchema,
  dispatchFrom: DispatchFromSchema.optional(),
  shipTo: z.strictObject({ address: ShipAddressSchema }).optional(),
});

export type EwbMovement = z.output<typeof EwbMovementSchema>;
export type EwbMovementInput = z.input<typeof EwbMovementSchema>;
