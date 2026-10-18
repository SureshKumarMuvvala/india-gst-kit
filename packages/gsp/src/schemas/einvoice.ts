// Source: https://einv-apisandbox.nic.in/version1.03/cancel-irn.html, get-eInvoicedetails.html,
//         Get_IRNdetailsbyDocDetails.html, get-ewaybill-details-by-irn.html, generate-irn.html —
//         sources/einvoice/api/v1.03-*.txt
// Retrieved: 2026-10-18
// Status: UNVERIFIED — needs CA
//
// Hand-transcribed (spec §8.1, G7). Requests are strict; responses are parsed leniently (unknown keys warn).
import { z } from "zod";
import { EINVOICE_CANCEL_REASON_CODES } from "../codes/einvoice-cancel-reasons.js";
import type { GspIssue } from "../issues.js";
import { validateWith, type RequestValidation } from "../validate.js";

const Int = z.string().regex(/^\d+$/);
const PORTAL_DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Cancel IRN request. The source puts `required` inside `properties` (so nothing is required under draft-04);
 * the evident intent — `Irn` and `CnlRsn` required — is applied (D-G17).
 */
export const CancelIrnRequestSchema = z.strictObject({
  Irn: z.string().length(64),
  CnlRsn: z.enum(EINVOICE_CANCEL_REASON_CODES),
  CnlRem: z.string().max(100).optional(),
});
export type CancelIrnRequest = z.infer<typeof CancelIrnRequestSchema>;

export function validateCancelIrnRequest(input: unknown): RequestValidation<CancelIrnRequest> {
  return validateWith(CancelIrnRequestSchema, input);
}

export const CancelIrnResponseSchema = z.strictObject({ Irn: z.string(), CancelDate: z.string() });
export type CancelIrnResponse = z.infer<typeof CancelIrnResponseSchema>;

/** Get e-invoice by IRN / IRN by document details / Generate IRN response `Data` (EI-GET, EI-DOC, EI-GEN). */
export const EinvoiceDetailsSchema = z.strictObject({
  AckNo: Int,
  AckDt: z.string().regex(PORTAL_DATE),
  Irn: z.string(),
  SignedInvoice: z.string(),
  SignedQRCode: z.string(),
  Status: z.string(),
  EwbNo: Int.nullable().optional(),
  EwbDt: z.string().nullable().optional(),
  EwbValidTill: z.string().nullable().optional(),
  Remarks: z.string().nullable().optional(),
});
export type EinvoiceDetails = z.infer<typeof EinvoiceDetailsSchema>;

/** Generate IRN response (EI-GEN): the same fields; `Remarks` is in the sample, not in the table (GD27). */
export const GenerateIrnResponseSchema = EinvoiceDetailsSchema;
export type GenerateIrnResponse = EinvoiceDetails;

export const EINVOICE_STATUSES_GET = ["ACT", "CNL", "REJ"] as const;
export const EINVOICE_STATUSES = ["ACT", "CNL"] as const;

export function statusWarnings(status: string, allowed: readonly string[]): GspIssue[] {
  return allowed.includes(status)
    ? []
    : [
        {
          code: "UNKNOWN_STATUS",
          severity: "warning",
          message: `status "${status}" is not documented`,
          path: ["Status"],
        },
      ];
}

/** Get e-way bill details by IRN (EI-EWBGET). */
export const EwbByIrnDetailsSchema = z.strictObject({
  EwbNo: Int,
  Status: z.string(),
  GenGstin: z.string(),
  EwbDt: z.string(),
  EwbValidTill: z.string().nullable(),
});
export type EwbByIrnDetails = z.infer<typeof EwbByIrnDetailsSchema>;

/** Query of Get IRN by document details (EI-DOC). `docDate` as in source C, `DD/MM/YYYY` (§15 V13). */
export const IrnByDocQuerySchema = z.strictObject({
  docType: z.enum(["INV", "CRN", "DBN"]),
  docNum: z.string().regex(/^[a-zA-Z1-9][a-zA-Z0-9/-]{0,15}$/),
  docDate: z.string().regex(/^[0-3][0-9]\/[0-1][0-9]\/\d{4}$/),
});
export type IrnByDocQuery = z.infer<typeof IrnByDocQuerySchema>;

export const IRN_PATTERN = /^[0-9a-fA-F]{64}$/;
