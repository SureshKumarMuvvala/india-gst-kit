import { z } from "zod";
import type { KeyObject } from "node:crypto";
import type { Envelope, EnvelopeFailure } from "./envelope.js";
import type { GspError, GspResult, System, TransportError } from "./errors.js";
import type { GspIssue } from "./issues.js";
import type { Redactor, SecretInput } from "./secret.js";

export const OPERATION_IDS = [
  "einvoice.auth",
  "einvoice.getGstinDetails",
  "einvoice.syncGstinDetails",
  "einvoice.generateIrn",
  "einvoice.cancelIrn",
  "einvoice.getEinvoiceByIrn",
  "einvoice.getIrnByDocDetails",
  "einvoice.getEwbByIrn",
  "einvoice.generateEwbByIrn",
  "ewaybill.auth",
  "ewaybill.generate",
  "ewaybill.updateVehicle",
  "ewaybill.cancel",
  "ewaybill.extendValidity",
  "ewaybill.consolidated",
  "ewaybill.updateTransporter",
  "ewaybill.reject",
  "ewaybill.getGstinDetails",
] as const;
export type OperationId = (typeof OPERATION_IDS)[number];

export type HttpMethod = "GET" | "POST";

export type EndpointSpec = {
  method: HttpMethod;
  url: string;
  /** EWB `action` value, sent in the body. */
  action?: string;
};

/** Credentials per system and GSTIN, always supplied by the caller (spec §3.2). Never read from the env. */
export type NicCredentials = {
  clientId: string;
  clientSecret: SecretInput;
  username: string;
  password: SecretInput;
  /** The portal's RSA public key: X.509 SubjectPublicKeyInfo PEM, or a KeyObject (G2, G3). */
  publicKey: string | KeyObject;
};

export type CredentialsProvider = (ctx: {
  system: System;
  gstin: string;
}) => NicCredentials | Promise<NicCredentials>;

/** A cached session. Serialisable as is; `authToken` and `sek` are secrets (spec §5.5). */
export type Session = {
  system: System;
  gstin: string;
  username: string;
  authToken: string;
  /** The decrypted SEK, Base64. */
  sek: string;
  obtainedAt: number;
  expiresAt: number;
  expirySource: "response" | "assumed";
};

export const HeaderNameMapSchema = z.strictObject({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  gstin: z.string().min(1),
  username: z.string().min(1).optional(),
  authToken: z.string().min(1),
  supGstin: z.string().min(1).optional(),
});
export type HeaderNameMap = z.infer<typeof HeaderNameMapSchema>;

export type HeaderContext = {
  system: System;
  op: OperationId;
  gstin: string;
  credentials: NicCredentials;
  session?: Session;
  supGstin?: string;
};

export type HttpRequest = {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
};
export type HttpOutcome =
  { ok: true; status: number; text: string } | { ok: false; error: TransportError };

export type LoginData = {
  authToken: string;
  sek: Uint8Array;
  username: string;
  /** From the response (e-invoice `TokenExpiry`), if present and readable. */
  expiresAt?: number;
  warnings: GspIssue[];
};

export type LoginContext = {
  system: System;
  gstin: string;
  credentials: NicCredentials;
  forceRefresh: boolean;
  randomBytes: (n: number) => Uint8Array;
  redactor: Redactor;
  /** POSTs `body` to the system's auth endpoint with auth headers; status 0 comes back as an `api` error. */
  send: (body: Record<string, string>) => Promise<GspResult<Envelope>>;
};

export type AuthStrategy = { login: (ctx: LoginContext) => Promise<GspResult<LoginData>> };

export type DecodedResponse = { json: string | null; warnings: GspIssue[] };

export type PayloadCodec = {
  /** The request body for a POST (string values; serialised with JSON.stringify). */
  encodeRequest: (ctx: {
    system: System;
    op: OperationId;
    action?: string;
    json: string;
    session: Session;
    redactor: Redactor;
  }) => { ok: true; body: Record<string, string> } | { ok: false; error: GspError };
  /** The decrypted response JSON text (or `null` when the envelope carries no data). */
  decodeResponse: (ctx: {
    system: System;
    op: OperationId;
    envelope: Envelope;
    session: Session;
    redactor: Redactor;
  }) => { ok: true; value: DecodedResponse } | { ok: false; error: GspError };
};

export type EnvelopeDecoder = {
  decode: (
    bodyText: string,
  ) => { ok: true; value: Envelope } | { ok: false; error: EnvelopeFailure };
};

export type SessionPolicy = {
  tokenLifetimeMinutes: Record<System, number>;
  /** e-invoice: log in again with ForceRefreshAccessToken in the last 10 minutes (D-G9). */
  proactiveRefresh: boolean;
  /** Whether the system supports a forced refresh (e-invoice yes, EWB no). */
  forceRefresh: Record<System, boolean>;
};

/** The seams a GSP adapter replaces (spec §2.2). The direct-NIC provider implements all of them. */
export type GspProvider = {
  name: string;
  baseUrl: (system: System) => string;
  /** `undefined` when the operation has no path configured. */
  endpoint: (op: OperationId, params: Record<string, string>) => EndpointSpec | undefined;
  buildHeaders: (ctx: HeaderContext) => Record<string, string>;
  auth: AuthStrategy;
  codec: PayloadCodec;
  envelope: EnvelopeDecoder;
  session: SessionPolicy;
};

export function systemOf(op: OperationId): System {
  return op.startsWith("einvoice.") ? "einvoice" : "ewaybill";
}
