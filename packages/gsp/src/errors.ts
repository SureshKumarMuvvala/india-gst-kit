import { z } from "zod";
import { GspIssueSchema, type GspIssue } from "./issues.js";

export const SystemSchema = z.enum(["einvoice", "ewaybill"]);
export type System = z.infer<typeof SystemSchema>;

export const ApiErrorEntrySchema = z.strictObject({
  code: z.string(),
  message: z.string().optional(),
});
export type ApiErrorEntry = z.infer<typeof ApiErrorEntrySchema>;

const ValidationErrorSchema = z.strictObject({
  kind: z.literal("validation"),
  issues: z.array(GspIssueSchema),
});
const ApiErrorSchema = z.strictObject({
  kind: z.literal("api"),
  system: SystemSchema,
  op: z.string(),
  errors: z.array(ApiErrorEntrySchema),
  info: z.string().optional(),
  httpStatus: z.number(),
  /** The envelope as received, redacted. */
  raw: z.unknown(),
});
const TransportErrorSchema = z.strictObject({
  kind: z.literal("transport"),
  reason: z.enum(["network", "timeout", "aborted", "http"]),
  httpStatus: z.number().optional(),
  /** `unknown`: the request may have reached the server; reconcile before repeating a POST. */
  outcome: z.enum(["not-sent", "unknown"]),
  message: z.string(),
});
const ProtocolErrorSchema = z.strictObject({
  kind: z.literal("protocol"),
  reason: z.enum([
    "bad-json",
    "bad-envelope",
    "decrypt-failed",
    "bad-response-data",
    "hmac-mismatch",
    "response-schema",
  ]),
  message: z.string(),
  httpStatus: z.number().optional(),
  issues: z.array(GspIssueSchema).optional(),
  raw: z.unknown().optional(),
});
const CryptoErrorSchema = z.strictObject({
  kind: z.literal("crypto"),
  reason: z.enum(["rsa-input-too-large", "bad-public-key", "bad-sek", "bad-key", "decrypt-failed"]),
  message: z.string(),
});
const ConfigErrorSchema = z.strictObject({
  kind: z.literal("config"),
  reason: z.string(),
  message: z.string(),
});

type Inner =
  | z.infer<typeof ValidationErrorSchema>
  | z.infer<typeof ApiErrorSchema>
  | z.infer<typeof TransportErrorSchema>
  | z.infer<typeof ProtocolErrorSchema>
  | z.infer<typeof CryptoErrorSchema>
  | z.infer<typeof ConfigErrorSchema>;

export type AuthError = { kind: "auth"; cause: Inner };
export type GspError = Inner | AuthError;

const InnerErrorSchema = z.discriminatedUnion("kind", [
  ValidationErrorSchema,
  ApiErrorSchema,
  TransportErrorSchema,
  ProtocolErrorSchema,
  CryptoErrorSchema,
  ConfigErrorSchema,
]);

/** Every error the client returns; `auth` wraps the failure of a login. */
export const GspErrorSchema: z.ZodType<GspError> = z.union([
  InnerErrorSchema,
  z.strictObject({ kind: z.literal("auth"), cause: InnerErrorSchema }),
]);

export type CryptoError = z.infer<typeof CryptoErrorSchema>;
export type ProtocolError = z.infer<typeof ProtocolErrorSchema>;
export type TransportError = z.infer<typeof TransportErrorSchema>;

export type GspResult<T> =
  | { ok: true; value: T; info?: string; warnings: GspIssue[]; raw?: unknown }
  | { ok: false; error: GspError; warnings: GspIssue[] };

export function okResult<T>(
  value: T,
  warnings: GspIssue[] = [],
  extra: { info?: string | undefined; raw?: unknown } = {},
): GspResult<T> {
  const r: { ok: true; value: T; info?: string; warnings: GspIssue[]; raw?: unknown } = {
    ok: true,
    value,
    warnings,
  };
  if (extra.info !== undefined) r.info = extra.info;
  if (extra.raw !== undefined) r.raw = extra.raw;
  return r;
}

export function failResult<T>(error: GspError, warnings: GspIssue[] = []): GspResult<T> {
  return { ok: false, error, warnings };
}

/** Wraps a login failure as `auth`, unless it already is one. */
export function asAuthError(error: GspError): GspError {
  return error.kind === "auth" ? error : { kind: "auth", cause: error };
}
