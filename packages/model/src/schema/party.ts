import { z } from "zod";
import { GstinSchema, RegistrationTypeSchema, StateCodeSchema } from "../primitives.js";

export const AddressSchema = z.strictObject({
  line1: z.string().trim().min(1).max(100),
  line2: z.string().max(100).optional(),
  city: z.string().trim().min(1).max(50),
  pincode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  stateCode: StateCodeSchema,
  country: z
    .string()
    .regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2")
    .default("IN"),
});

const partyShape = {
  legalName: z.string().trim().min(1).max(200),
  tradeName: z.string().max(200).optional(),
  gstin: GstinSchema.optional(),
  registrationType: RegistrationTypeSchema,
  stateCode: StateCodeSchema,
  address: AddressSchema,
};

interface PartyLike {
  gstin?: string | undefined;
  registrationType: string;
  stateCode: string;
  address: { stateCode: string };
}

interface PartyIssue {
  path: (string | number)[];
  message: string;
}

function partyIssues(p: PartyLike): PartyIssue[] {
  const issues: PartyIssue[] = [];
  const unregistered = p.registrationType === "UNREGISTERED" || p.registrationType === "OVERSEAS";
  if (p.gstin === undefined && !unregistered) {
    issues.push({
      path: ["gstin"],
      message: `gstin is required for registrationType ${p.registrationType}`,
    });
  }
  if (p.gstin !== undefined && unregistered) {
    issues.push({
      path: ["registrationType"],
      message: `${p.registrationType} parties have no GSTIN`,
    });
  }
  if (p.gstin !== undefined && p.gstin.slice(0, 2) !== p.stateCode) {
    issues.push({
      path: ["stateCode"],
      message: "stateCode must equal the first 2 characters of the GSTIN",
    });
  }
  if (p.address.stateCode !== p.stateCode) {
    issues.push({
      path: ["address", "stateCode"],
      message: "address.stateCode must equal stateCode",
    });
  }
  return issues;
}

export const PartySchema = z.strictObject(partyShape).superRefine((p, ctx) => {
  for (const i of partyIssues(p)) ctx.addIssue({ code: "custom", ...i });
});

export const SupplierSchema = z
  .strictObject({
    ...partyShape,
    gstin: GstinSchema,
    registrationType: z.enum(["REGULAR", "COMPOSITION", "SEZ_UNIT", "SEZ_DEVELOPER"]),
  })
  .superRefine((p, ctx) => {
    for (const i of partyIssues(p)) ctx.addIssue({ code: "custom", ...i });
  });

export type Address = z.infer<typeof AddressSchema>;
export type Party = z.infer<typeof PartySchema>;
export type Supplier = z.infer<typeof SupplierSchema>;
