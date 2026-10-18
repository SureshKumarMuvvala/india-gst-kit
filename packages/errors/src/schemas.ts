import { z } from "zod";

/** The two NIC systems; the literals equal `@india-gst-kit/gsp`'s `SystemSchema` (spec §2, T-I3). */
export const ErrorSystemSchema = z.enum(["einvoice", "ewaybill"]);
export type ErrorSystem = z.infer<typeof ErrorSystemSchema>;

/** A list within a system: the e-invoice portal's path segments, or `API` for the e-way bill system (spec §4.1). */
export const ErrorListIdSchema = z.enum(["VITAL", "INV", "EWB", "API"]);
export type ErrorListId = z.infer<typeof ErrorListIdSchema>;

/** `system/list`: the only valid pairs (X2). */
export const ErrorListKeySchema = z.enum([
  "einvoice/VITAL",
  "einvoice/INV",
  "einvoice/EWB",
  "ewaybill/API",
]);
export type ErrorListKey = z.infer<typeof ErrorListKeySchema>;

export const LIST_IDS_BY_SYSTEM: Readonly<Record<ErrorSystem, readonly ErrorListId[]>> = {
  einvoice: ["VITAL", "INV", "EWB"],
  ewaybill: ["API"],
};

/**
 * Library classification — NOT official (spec §6.1, D-E2). In this order; `outcome-unknown` is assigned to no
 * official code and is reserved for clients (a request may have reached the portal but no answer came back).
 */
export const ERROR_CATEGORIES = [
  "fix-data",
  "gstin-status",
  "not-allowed",
  "already-done",
  "not-found",
  "auth",
  "throttled",
  "retry-later",
  "contact-helpdesk",
  "integration",
  "unknown",
  "outcome-unknown",
] as const;
export const ErrorCategorySchema = z.enum(ERROR_CATEGORIES);
export type ErrorCategory = z.infer<typeof ErrorCategorySchema>;

export const ErrorNoteSchema = z.enum([
  "X1-in-other-lists",
  "X3-underscore-code",
  "X7-not-a-rate-list",
  "X8-malformed-placeholder",
  "missing-params",
  "list-guessed",
]);
export type ErrorNote = z.infer<typeof ErrorNoteSchema>;

/** One row of an official list, verbatim; an empty cell is an absent key (spec §4.2). */
export const OfficialErrorRowSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  reason: z.string().min(1).optional(),
  resolution: z.string().min(1).optional(),
});
export type OfficialErrorRow = z.infer<typeof OfficialErrorRowSchema>;

export const ErrorListSourceSchema = z.strictObject({
  url: z.string(),
  file: z.string(),
  retrieved: z.string(),
  sha256: z.string(),
  status: z.string(),
});
export type ErrorListSource = z.infer<typeof ErrorListSourceSchema>;

/** The result of `describeError` (spec §5.1). */
export const ErrorDescriptionSchema = z.strictObject({
  system: ErrorSystemSchema,
  list: ErrorListIdSchema.nullable(),
  code: z.string(),
  known: z.boolean(),
  category: ErrorCategorySchema,
  officialMessage: z.string().nullable(),
  officialMessageTemplate: z.string().nullable(),
  officialReason: z.string().nullable(),
  officialResolution: z.string().nullable(),
  returnedMessage: z.string().nullable(),
  userMessage: z.string(),
  userMessageSource: z.enum(["category", "code"]),
  otherLists: z.array(z.strictObject({ list: ErrorListIdSchema, officialMessage: z.string() })),
  notes: z.array(ErrorNoteSchema),
  source: z.strictObject({ url: z.string(), retrieved: z.string(), status: z.string() }).nullable(),
});
export type ErrorDescription = z.infer<typeof ErrorDescriptionSchema>;
