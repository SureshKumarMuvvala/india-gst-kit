// Source: the URL, header and payload sections of every page in sources/einvoice/api/ and sources/ewaybill/api/,
//         sources/ewaybill/{generate-ewaybill,ewb-by-irn}-overview.txt; Java excerpts —
//         sources/einvoice/api/java-sample-excerpts.md
// Retrieved: 2026-10-18 (API pages), 2026-10-16 (H, I overviews)
// Status: UNVERIFIED — documented defaults, settle on the first live call (spec §15 V1–V5, V9, V17)
//
// The direct-to-NIC provider (spec §2, §3.3). There is no default base URL: none is in sources/ (D-G4, F3).
import { z } from "zod";
import {
  decodePayload,
  decodeRekResponse,
  decryptSek,
  encodePayload,
  generateAppKey,
  rsaEncryptLogin,
  decodeBase64,
  type PayloadForm,
} from "./crypto.js";
import { parsePortalDateTime } from "./datetime.js";
import { decodeNicEnvelope } from "./envelope.js";
import { failResult, okResult, type GspError, type GspResult, type System } from "./errors.js";
import { warning, type GspIssue } from "./issues.js";
import {
  systemOf,
  type AuthStrategy,
  type EnvelopeDecoder,
  type GspProvider,
  HeaderNameMapSchema,
  type HeaderNameMap,
  type LoginData,
  type NicCredentials,
  type OperationId,
  type PayloadCodec,
} from "./provider.js";
import { reveal } from "./secret.js";

type PathEntry = { method: "GET" | "POST"; path: string; action?: string };

/** Each source's `URL` row, transcribed literally (`<URL>` = the caller's base URL). */
export const NIC_DEFAULT_PATHS: Readonly<Record<OperationId, PathEntry>> = {
  "einvoice.auth": { method: "POST", path: "/v1.04/auth" },
  "einvoice.getGstinDetails": { method: "GET", path: "/eivital/v1.04/Master/gstin/{gstin}" },
  "einvoice.syncGstinDetails": { method: "GET", path: "/eivital/v1.04/Master/syncgstin/{gstin}" },
  "einvoice.generateIrn": { method: "POST", path: "/api/Invoice" },
  "einvoice.cancelIrn": { method: "POST", path: "/api/Cancel" },
  "einvoice.getEinvoiceByIrn": { method: "GET", path: "/api/Invoice/irn/{irn}" },
  // The source has a stray "/" after "doctype=" (GD14); dropped.
  "einvoice.getIrnByDocDetails": {
    method: "GET",
    path: "/irnbydocdetails?doctype={docType}&docnum={docNum}&docdate={docDate}",
  },
  "einvoice.getEwbByIrn": { method: "GET", path: "/eiewb/v1.03/ewaybill/irn/{irn}" },
  // The source writes "<URL>api/einvewb/ewaybill" (no "/").
  "einvoice.generateEwbByIrn": { method: "POST", path: "/api/einvewb/ewaybill" },
  "ewaybill.auth": { method: "POST", path: "/auth/" },
  "ewaybill.generate": { method: "POST", path: "/ewayapi/", action: "GENEWAYBILL" },
  "ewaybill.updateVehicle": { method: "POST", path: "/ewayapi/", action: "VEHEWB" },
  "ewaybill.cancel": { method: "POST", path: "/ewayapi/", action: "CANEWB" },
  "ewaybill.extendValidity": { method: "POST", path: "/ewayapi/", action: "EXTENDVALIDITY" },
  "ewaybill.consolidated": { method: "POST", path: "/ewayapi/", action: "GENCEWB" },
  "ewaybill.updateTransporter": { method: "POST", path: "/ewayapi/", action: "UPDATETRANSPORTER" },
  "ewaybill.reject": { method: "POST", path: "/ewayapi/", action: "REJEWB" },
  // "URL Parameters: GSTIN"; reading it as a query parameter named GSTIN is ours (§15 V12).
  "ewaybill.getGstinDetails": { method: "GET", path: "/Master/GetGSTINDetails?GSTIN={gstin}" },
};

/** Header names documented on the e-invoice pages (G4). */
export const NIC_EINVOICE_HEADERS: Readonly<HeaderNameMap> = {
  clientId: "client_id",
  clientSecret: "client_secret",
  gstin: "Gstin",
  username: "user_name",
  authToken: "AuthToken",
  supGstin: "sup_gstin",
};

/** Header names documented on the e-way bill pages (G4). */
export const NIC_EWAYBILL_HEADERS: Readonly<HeaderNameMap> = {
  clientId: "client-id",
  clientSecret: "client-secret",
  gstin: "Gstin",
  authToken: "authtoken",
};

/**
 * The e-invoice Java sample's auth headers (JAVA lines 51–53, GD26). The sample shows only the auth call, so the
 * other names stay as documented.
 */
export const NIC_EINVOICE_HEADERS_JAVA_SAMPLE: Readonly<HeaderNameMap> = {
  ...NIC_EINVOICE_HEADERS,
  clientId: "client-id",
  clientSecret: "client-secret",
  gstin: "gstin",
};

const DEFAULT_LIFETIME_MINUTES = 360;

const Form = z.enum(["json", "base64-json"]);

export const NicDirectOptionsSchema = z.strictObject({
  baseUrls: z.strictObject({ einvoice: z.url(), ewaybill: z.url() }),
  paths: z
    .partialRecord(
      z.enum(Object.keys(NIC_DEFAULT_PATHS) as [OperationId, ...OperationId[]]),
      z.string(),
    )
    .optional(),
  headerNames: z
    .strictObject({
      einvoice: HeaderNameMapSchema.optional(),
      ewaybill: HeaderNameMapSchema.optional(),
    })
    .optional(),
  payloadPlaintext: z
    .strictObject({ einvoice: Form.optional(), ewaybill: Form.optional() })
    .optional(),
  authPlaintext: Form.optional(),
  appKeyBytes: z.union([z.literal(16), z.literal(32)]).optional(),
  tokenLifetimeMinutes: z
    .strictObject({
      einvoice: z.number().positive().optional(),
      ewaybill: z.number().positive().optional(),
    })
    .optional(),
  proactiveRefresh: z.boolean().optional(),
  verifyHmac: z.boolean().optional(),
});
export type NicDirectOptions = z.input<typeof NicDirectOptionsSchema>;

/** The login JSON for each system (EI-AUTH, EW-AUTH), Base64-encoded unless `form` is `json` (D-G6). */
export function buildLoginPlaintext(
  system: System,
  creds: Pick<NicCredentials, "username" | "password">,
  appKeyBase64: string,
  forceRefresh: boolean,
  form: PayloadForm = "base64-json",
): string {
  const json =
    system === "einvoice"
      ? JSON.stringify({
          UserName: creds.username,
          Password: reveal(creds.password),
          AppKey: appKeyBase64,
          ForceRefreshAccessToken: forceRefresh,
        })
      : JSON.stringify({
          action: "ACCESSTOKEN",
          username: creds.username,
          password: reveal(creds.password),
          app_key: appKeyBase64,
        });
  return form === "json" ? json : Buffer.from(json, "utf8").toString("base64");
}

function lowerKeys(o: unknown): Record<string, unknown> | undefined {
  if (typeof o === "string") {
    try {
      return lowerKeys(JSON.parse(o));
    } catch {
      return undefined;
    }
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return undefined;
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
}

const protocol = (
  reason: "bad-envelope" | "bad-response-data" | "decrypt-failed" | "hmac-mismatch",
  message: string,
): GspError => ({
  kind: "protocol",
  reason,
  message,
});

/** NIC login: AppKey, RSA-encrypted credentials, SEK decrypted with the AppKey (spec §4, §5). */
export function nicAuthStrategy(
  options: { authPlaintext?: PayloadForm; appKeyBytes?: 16 | 32 } = {},
): AuthStrategy {
  return {
    async login(ctx): Promise<GspResult<LoginData>> {
      const { system, credentials, redactor } = ctx;
      redactor.add(reveal(credentials.clientSecret), reveal(credentials.password));
      const appKey = generateAppKey(ctx.randomBytes, options.appKeyBytes ?? 32);
      redactor.addBytes(appKey.bytes);
      const plain = buildLoginPlaintext(
        system,
        credentials,
        appKey.base64,
        ctx.forceRefresh,
        options.authPlaintext,
      );
      redactor.add(plain);
      const encrypted = rsaEncryptLogin(plain, credentials.publicKey);
      if (!encrypted.ok) return failResult(encrypted.error);
      redactor.add(encrypted.value);
      const sent = await ctx.send({ Data: encrypted.value });
      if (!sent.ok) return sent;
      const env = sent.value;
      // e-invoice: Data = { ClientId, UserName, AuthToken, Sek, TokenExpiry } (only Sek encrypted).
      // EWB: flat { status, authtoken, sek }.
      const fields =
        system === "einvoice" ? lowerKeys(env.data) : { ...lowerKeys(env.data), ...env.extra };
      const token = fields?.authtoken;
      const sekText = fields?.sek;
      if (typeof token !== "string" || token === "" || typeof sekText !== "string") {
        return failResult(
          protocol("bad-envelope", "login response has no auth token or SEK"),
          env.warnings,
        );
      }
      redactor.add(token, sekText);
      const sek = decryptSek(sekText, appKey.bytes);
      if (!sek.ok) return failResult(sek.error, env.warnings);
      redactor.addBytes(sek.value);
      const warnings: GspIssue[] = [...env.warnings];
      const data: LoginData = {
        authToken: token,
        sek: sek.value,
        username: typeof fields?.username === "string" ? fields.username : credentials.username,
        warnings,
      };
      if (system === "einvoice") {
        const expiry =
          typeof fields?.tokenexpiry === "string"
            ? parsePortalDateTime(fields.tokenexpiry)
            : undefined;
        if (expiry === undefined)
          warnings.push(
            warning("TOKEN_EXPIRY_ASSUMED", "TokenExpiry missing or unreadable; lifetime assumed"),
          );
        else data.expiresAt = expiry;
      }
      return okResult(data, warnings);
    },
  };
}

/** AES-ECB with the SEK; the EWB GetGSTINDetails `rek`/`hmac` path (spec §4). */
export function nicPayloadCodec(
  options: { payloadPlaintext?: Partial<Record<System, PayloadForm>>; verifyHmac?: boolean } = {},
): PayloadCodec {
  const formOf = (s: System): PayloadForm =>
    options.payloadPlaintext?.[s] ?? (s === "ewaybill" ? "base64-json" : "json");
  return {
    encodeRequest({ system, action, json, session }) {
      const sek = decodeBase64(session.sek);
      if (sek === undefined)
        return {
          ok: false,
          error: { kind: "crypto", reason: "bad-sek", message: "cached SEK is not Base64" },
        };
      const enc = encodePayload(json, sek, formOf(system));
      if (!enc.ok) return { ok: false, error: enc.error };
      return {
        ok: true,
        body:
          system === "einvoice"
            ? { Data: enc.value }
            : { action: (action ?? "").trim(), data: enc.value },
      };
    },
    decodeResponse({ system, envelope, session, redactor }) {
      const sek = decodeBase64(session.sek);
      if (sek === undefined)
        return {
          ok: false,
          error: { kind: "crypto", reason: "bad-sek", message: "cached SEK is not Base64" },
        };
      const { data, extra } = envelope;
      if (data === null || data === undefined)
        return { ok: true, value: { json: null, warnings: [] } };
      if (typeof data !== "string")
        return { ok: false, error: protocol("bad-response-data", "response data is not a string") };
      const rek = extra.rek;
      const hmac = extra.hmac;
      if (system === "ewaybill" && typeof rek === "string" && typeof hmac === "string") {
        redactor.add(rek);
        const verify = options.verifyHmac ?? true;
        const r = decodeRekResponse({ data, rek, hmac }, sek, verify);
        if (!r.ok)
          return {
            ok: false,
            error: protocol(r.reason === "bad-key" ? "decrypt-failed" : r.reason, r.message),
          };
        redactor.addBytes(r.value.rek);
        const warnings = verify
          ? []
          : [warning("HMAC_NOT_VERIFIED", "verifyHmac is off: response integrity not checked")];
        return { ok: true, value: { json: r.value.json, warnings } };
      }
      const r = decodePayload(data, sek);
      if (!r.ok)
        return {
          ok: false,
          error: protocol(r.reason === "bad-key" ? "decrypt-failed" : r.reason, r.message),
        };
      return { ok: true, value: { json: r.value.json, warnings: [] } };
    },
  };
}

export const nicEnvelopeDecoder: EnvelopeDecoder = { decode: decodeNicEnvelope };

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** Throws (programmer error) on invalid options. */
export function createNicDirectProvider(options: NicDirectOptions): GspProvider {
  const parsed = NicDirectOptionsSchema.safeParse(options);
  if (!parsed.success)
    throw new TypeError(`createNicDirectProvider(): ${z.prettifyError(parsed.error)}`);
  const o = parsed.data;
  const names: Record<System, HeaderNameMap> = {
    einvoice: o.headerNames?.einvoice ?? NIC_EINVOICE_HEADERS,
    ewaybill: o.headerNames?.ewaybill ?? NIC_EWAYBILL_HEADERS,
  };
  const codecOptions: {
    payloadPlaintext?: Partial<Record<System, PayloadForm>>;
    verifyHmac?: boolean;
  } = {};
  if (o.payloadPlaintext !== undefined) {
    codecOptions.payloadPlaintext = Object.fromEntries(
      Object.entries(o.payloadPlaintext).filter(([, v]) => v !== undefined),
    );
  }
  if (o.verifyHmac !== undefined) codecOptions.verifyHmac = o.verifyHmac;
  const authOptions: { authPlaintext?: PayloadForm; appKeyBytes?: 16 | 32 } = {};
  if (o.authPlaintext !== undefined) authOptions.authPlaintext = o.authPlaintext;
  if (o.appKeyBytes !== undefined) authOptions.appKeyBytes = o.appKeyBytes;

  return {
    name: "nic-direct",
    baseUrl: (system) => o.baseUrls[system],
    endpoint(op, params) {
      const entry = NIC_DEFAULT_PATHS[op];
      const path = o.paths?.[op] ?? entry.path;
      if (path.trim() === "") return undefined;
      const filled = path.replace(/\{(\w+)\}/g, (_m, name: string) =>
        encodeURIComponent(params[name] ?? ""),
      );
      const spec: { method: "GET" | "POST"; url: string; action?: string } = {
        method: entry.method,
        url: joinUrl(o.baseUrls[systemOf(op)], filled),
      };
      if (entry.action !== undefined) spec.action = entry.action;
      return spec;
    },
    buildHeaders({ system, op, gstin, credentials, session, supGstin }) {
      const n = names[system];
      const h: Record<string, string> = {
        "Content-Type": "application/json",
        [n.clientId]: credentials.clientId,
        [n.clientSecret]: reveal(credentials.clientSecret),
        [n.gstin]: gstin,
      };
      if (!op.endsWith(".auth") && session !== undefined) {
        if (n.username !== undefined) h[n.username] = session.username;
        h[n.authToken] = session.authToken;
        if (supGstin !== undefined && n.supGstin !== undefined) h[n.supGstin] = supGstin;
      }
      return h;
    },
    auth: nicAuthStrategy(authOptions),
    codec: nicPayloadCodec(codecOptions),
    envelope: nicEnvelopeDecoder,
    session: {
      tokenLifetimeMinutes: {
        einvoice: o.tokenLifetimeMinutes?.einvoice ?? DEFAULT_LIFETIME_MINUTES,
        ewaybill: o.tokenLifetimeMinutes?.ewaybill ?? DEFAULT_LIFETIME_MINUTES,
      },
      proactiveRefresh: o.proactiveRefresh ?? true,
      forceRefresh: { einvoice: true, ewaybill: false },
    },
  };
}
