import { z } from "zod";
import { AddressSchema, IsoDateSchema } from "@india-gst-kit/model";

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
 * rules run on the mapped payload, so payloads built elsewhere get the same checks. `shipTo` has no name or
 * GSTIN: the Ship-To GSTIN change is on hold (release notes, 30/07/2026; decision D-Q7).
 */
export const EwbMovementSchema = z.strictObject({
  transport: EwbTransportSchema,
  dispatchFrom: z.strictObject({ name: z.string(), address: AddressSchema }).optional(),
  shipTo: z.strictObject({ address: AddressSchema }).optional(),
});

export type EwbMovement = z.output<typeof EwbMovementSchema>;
export type EwbMovementInput = z.input<typeof EwbMovementSchema>;
