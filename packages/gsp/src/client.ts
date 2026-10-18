import { randomBytes as nodeRandomBytes } from "node:crypto";
import { z } from "zod";
import {
  decodeSignedInvoice,
  decodeSignedQrCode,
  serializeIrnRequest,
  validateIrnRequest,
  type DecodeResult,
  type IrnRequest,
  type SignedInvoiceData,
  type SignedQrData,
  type ValidateOptions,
} from "@india-gst-kit/einvoice";
import {
  parseEwbByIrnResponseData,
  parseEwbResponseData,
  serializeEwbByIrnRequest,
  serializeEwbRequest,
  validateEwbByIrnRequest,
  validateEwbRequest,
  type ByIrnOptions,
  type EwbByIrnRequest,
  type EwbByIrnResponse,
  type EwbRequest,
  type EwbResponse,
  type GenerateOptions,
} from "@india-gst-kit/ewaybill";
import { failResult, okResult, type GspError, type GspResult, type System } from "./errors.js";
import {
  checkGstinArgument,
  normaliseGstinDetails,
  type GstinDetails,
  type GstinDetailsSource,
} from "./gstin-details.js";
import { fromPackageIssue, hasErrorIssues, warning, type GspIssue } from "./issues.js";
import {
  precheckCancelEwb,
  precheckCancelIrn,
  precheckEwbActive,
  precheckExtendValidity,
  precheckIrnLookup,
  precheckRejectEwb,
  type EwbRole,
} from "./precheck.js";
import {
  systemOf,
  type CredentialsProvider,
  type GspProvider,
  type HttpOutcome,
  type HttpRequest,
  type NicCredentials,
  type OperationId,
  type Session,
} from "./provider.js";
import {
  CancelIrnRequestSchema,
  CancelIrnResponseSchema,
  EINVOICE_STATUSES,
  EINVOICE_STATUSES_GET,
  EinvoiceDetailsSchema,
  EwbByIrnDetailsSchema,
  IRN_PATTERN,
  IrnByDocQuerySchema,
  statusWarnings,
  validateCancelIrnRequest,
  type CancelIrnRequest,
  type CancelIrnResponse,
  type EinvoiceDetails,
  type EwbByIrnDetails,
  type IrnByDocQuery,
} from "./schemas/einvoice.js";
import {
  CancelEwbRequestSchema,
  CancelEwbResponseSchema,
  ConsolidatedEwbRequestSchema,
  ConsolidatedEwbResponseSchema,
  ewbDateWarnings,
  ExtendValidityRequestSchema,
  ExtendValidityResponseSchema,
  RejectEwbRequestSchema,
  RejectEwbResponseSchema,
  UpdateTransporterRequestSchema,
  UpdateTransporterResponseSchema,
  UpdateVehicleRequestSchema,
  UpdateVehicleResponseSchema,
  validateCancelEwbRequest,
  validateConsolidatedEwbRequest,
  validateExtendValidityRequest,
  validateRejectEwbRequest,
  validateUpdateTransporterRequest,
  validateUpdateVehicleRequest,
  type CancelEwbRequest,
  type CancelEwbResponse,
  type ConsolidatedEwbRequest,
  type ConsolidatedEwbResponse,
  type ExtendValidityRequest,
  type ExtendValidityResponse,
  type RejectEwbRequest,
  type RejectEwbResponse,
  type UpdateTransporterRequest,
  type UpdateTransporterResponse,
  type UpdateVehicleRequest,
  type UpdateVehicleResponse,
} from "./schemas/ewaybill.js";
import { Redactor, reveal } from "./secret.js";
import { createMemorySessionStore, SessionManager, type SessionStore } from "./session.js";
import type { RequestValidation } from "./validate.js";
import { parseJsonAsStrings, parseResponse, writeWire } from "./wire.js";

export type GspLogEvent =
  | {
      type: "request";
      system: System;
      op: OperationId;
      method: string;
      path: string;
      attempt: number;
    }
  | {
      type: "response";
      system: System;
      op: OperationId;
      httpStatus: number;
      envelopeStatus?: 0 | 1;
      durationMs: number;
    }
  | { type: "login" | "session-reused" | "session-refresh"; system: System; forceRefresh?: boolean }
  | { type: "retry"; system: System; op: OperationId; attempt: number; delayMs: number }
  | { type: "warning"; system: System; op: OperationId; code: string; message: string };

export type GspClientConfig = {
  provider: GspProvider;
  credentials: CredentialsProvider;
  fetch?: typeof globalThis.fetch;
  clock?: { now: () => number };
  sleep?: (ms: number) => Promise<void>;
  randomBytes?: (n: number) => Uint8Array;
  sessionStore?: SessionStore;
  logger?: (event: GspLogEvent) => void;
  timeoutMs?: number;
  getRetries?: number;
  authErrorCodes?: Partial<Record<System, readonly string[]>>;
  expirySkewSeconds?: number;
};

const fn = <T>(name: string) =>
  z.custom<T>((v) => typeof v === "function", `${name} must be a function`);

const ConfigSchema = z.strictObject({
  provider: z.custom<GspProvider>(
    (v) =>
      typeof v === "object" &&
      v !== null &&
      typeof (v as { endpoint?: unknown }).endpoint === "function",
    "provider must be a GspProvider",
  ),
  credentials: fn<CredentialsProvider>("credentials"),
  fetch: fn<typeof globalThis.fetch>("fetch").optional(),
  clock: z
    .custom<{ now: () => number }>(
      (v) => typeof (v as { now?: unknown } | null)?.now === "function",
    )
    .optional(),
  sleep: fn<(ms: number) => Promise<void>>("sleep").optional(),
  randomBytes: fn<(n: number) => Uint8Array>("randomBytes").optional(),
  sessionStore: z
    .custom<SessionStore>((v) =>
      ["get", "set", "delete"].every(
        (k) => typeof (v as Record<string, unknown> | null)?.[k] === "function",
      ),
    )
    .optional(),
  logger: fn<(e: GspLogEvent) => void>("logger").optional(),
  timeoutMs: z.number().int().positive().optional(),
  getRetries: z.number().int().min(0).max(5).optional(),
  authErrorCodes: z
    .strictObject({
      einvoice: z.array(z.string()).optional(),
      ewaybill: z.array(z.string()).optional(),
    })
    .optional(),
  expirySkewSeconds: z.number().min(0).max(600).optional(),
});

type Common = { gstin: string; signal?: AbortSignal };
type Skip = { skipLocalValidation?: boolean };
export type SignedEinvoice = {
  details: EinvoiceDetails;
  signedInvoice: DecodeResult<SignedInvoiceData>;
  signedQrCode: DecodeResult<SignedQrData>;
};
export type LoginInfo = {
  expiresAt: number;
  expirySource: Session["expirySource"];
  reused: boolean;
};

type Parsed<T> =
  | { ok: true; value: T; warnings: GspIssue[]; raw?: unknown; info?: string }
  | { ok: false; error: GspError; warnings?: GspIssue[] };

type CallSpec<T> = {
  op: OperationId;
  gstin: string;
  supGstin?: string | undefined;
  params?: Record<string, string>;
  json?: string;
  signal?: AbortSignal | undefined;
  warnings: GspIssue[];
  parse: (json: string | null) => Parsed<T>;
};

const isAborted = (s: AbortSignal | undefined): boolean => s?.aborted === true;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const BACKOFF_MS = 250;

function responseSchemaError(issues: GspIssue[], raw: unknown): GspError {
  return {
    kind: "protocol",
    reason: "response-schema",
    message: "response data does not match the schema",
    issues,
    raw,
  };
}

function needJson(json: string | null): json is string {
  return json !== null;
}

const noData: GspError = {
  kind: "protocol",
  reason: "bad-response-data",
  message: "success response carries no data",
};

/** Parses with a response schema; warnings for unknown keys and `extra` checks. */
function parseWith<S extends z.ZodType>(
  schema: S,
  extra: (v: z.output<S>) => GspIssue[] = () => [],
) {
  return (json: string | null): Parsed<z.output<S>> => {
    if (!needJson(json)) return { ok: false, error: noData };
    const r = parseResponse(json, schema);
    if (!r.ok) return { ok: false, error: responseSchemaError(r.issues, r.raw) };
    let info: string | undefined;
    const value = r.value as unknown;
    if (typeof value === "object" && value !== null && "alert" in value) {
      const a = (value as { alert?: unknown }).alert;
      if (typeof a === "string" && a !== "") info = a;
    }
    const out: Parsed<z.output<S>> = {
      ok: true,
      value: r.value,
      warnings: [...r.warnings, ...extra(r.value)],
      raw: r.raw,
    };
    if (info !== undefined) out.info = info;
    return out;
  };
}

function parseSigned(statuses: readonly string[]) {
  const base = parseWith(EinvoiceDetailsSchema, (v) => statusWarnings(v.Status, statuses));
  return (json: string | null): Parsed<SignedEinvoice> => {
    const r = base(json);
    if (!r.ok) return r;
    return {
      ...r,
      value: {
        details: r.value,
        signedInvoice: decodeSignedInvoice(r.value.SignedInvoice),
        signedQrCode: decodeSignedQrCode(r.value.SignedQRCode),
      },
    };
  };
}

function parseGstin(source: GstinDetailsSource) {
  return (json: string | null): Parsed<GstinDetails> => {
    if (!needJson(json)) return { ok: false, error: noData };
    const raw = parseJsonAsStrings(json);
    if (!raw.ok)
      return {
        ok: false,
        error: responseSchemaError(
          [{ code: "BAD_JSON", severity: "error", message: "not JSON" }],
          json,
        ),
      };
    const r = normaliseGstinDetails(raw.value, source);
    if (!r.ok) {
      return {
        ok: false,
        error: responseSchemaError(
          [{ code: "SCHEMA", severity: "error", message: r.message }],
          raw.value,
        ),
      };
    }
    return { ok: true, value: r.value, warnings: r.warnings, raw: raw.value };
  };
}

function parseEwbPackage<T>(
  decode: (text: string) => {
    ok: boolean;
    value?: T;
    raw: unknown;
    issues: {
      path: (string | number)[];
      code: string;
      rule: string;
      message: string;
      severity: "error" | "warning";
    }[];
  },
) {
  return (json: string | null): Parsed<T> => {
    if (!needJson(json)) return { ok: false, error: noData };
    const r = decode(json);
    const issues = r.issues.map(fromPackageIssue);
    if (!r.ok || r.value === undefined)
      return { ok: false, error: responseSchemaError(issues, r.raw) };
    return { ok: true, value: r.value, warnings: issues, raw: r.raw };
  };
}

/**
 * Local validation (D-G16): errors block unless `skip`, which downgrades them to warnings and adds
 * LOCAL_VALIDATION_SKIPPED. Returns the JSON to send, or the validation error.
 */
function prepare<T>(
  validation: RequestValidation<T>,
  request: unknown,
  serialize: (value: T) => string,
  skip: boolean | undefined,
): { ok: true; json: string; warnings: GspIssue[] } | { ok: false; error: GspError } {
  const blocking = hasErrorIssues(validation.issues);
  const warnings = validation.issues.filter((i) => i.severity === "warning");
  if (blocking && skip !== true)
    return { ok: false, error: { kind: "validation", issues: validation.issues } };
  if (blocking) {
    warnings.push(
      warning("LOCAL_VALIDATION_SKIPPED", "local validation failed and was skipped by the caller"),
    );
    for (const i of validation.issues)
      if (i.severity === "error") warnings.push({ ...i, severity: "warning" });
  }
  try {
    return { ok: true, json: serialize((validation.value ?? request) as T), warnings };
  } catch (e) {
    if (e instanceof RangeError || e instanceof TypeError) {
      return {
        ok: false,
        error: {
          kind: "validation",
          issues: [{ code: "SERIALIZE", severity: "error", message: e.message }],
        },
      };
    }
    throw e;
  }
}

const packageValidation = <T>(r: {
  ok: boolean;
  value?: T;
  issues: Parameters<typeof fromPackageIssue>[0][];
}): RequestValidation<T> => {
  const out: RequestValidation<T> = { ok: r.ok, issues: r.issues.map(fromPackageIssue) };
  if (r.value !== undefined) out.value = r.value;
  return out;
};

export type GspClient = ReturnType<typeof createGspClient>;

/**
 * The client (spec §3). Throws only on an invalid config (programmer error); every operation returns a
 * `GspResult` and never throws on data, API or transport failures.
 */
export function createGspClient(config: GspClientConfig) {
  const parsed = ConfigSchema.safeParse(config);
  if (!parsed.success) throw new TypeError(`createGspClient(): ${z.prettifyError(parsed.error)}`);
  const provider = config.provider;
  const fetchFn = config.fetch ?? globalThis.fetch.bind(globalThis);
  const now = config.clock === undefined ? Date.now : () => config.clock?.now() ?? Date.now();
  const sleep = config.sleep ?? defaultSleep;
  const random = config.randomBytes ?? ((n: number) => new Uint8Array(nodeRandomBytes(n)));
  const timeoutMs = config.timeoutMs ?? 30_000;
  const getRetries = config.getRetries ?? 0;
  const authCodes = config.authErrorCodes ?? {};
  const redactor = new Redactor();
  const log = (e: GspLogEvent) => {
    if (config.logger !== undefined) config.logger(redactor.deep(e) as GspLogEvent);
  };

  async function credentialsFor(system: System, gstin: string): Promise<NicCredentials> {
    const c = await config.credentials({ system, gstin });
    redactor.add(reveal(c.clientSecret), reveal(c.password));
    return c;
  }

  function logPath(url: string): string {
    const u = new URL(url);
    const g = u.searchParams.get("GSTIN");
    return g === null ? u.pathname : `${u.pathname}?GSTIN=${g}`;
  }

  async function sendOnce(
    req: HttpRequest,
    system: System,
    op: OperationId,
    attempt: number,
    signal: AbortSignal | undefined,
  ): Promise<HttpOutcome> {
    if (signal?.aborted === true) {
      return {
        ok: false,
        error: {
          kind: "transport",
          reason: "aborted",
          outcome: "not-sent",
          message: "aborted before sending",
        },
      };
    }
    log({ type: "request", system, op, method: req.method, path: logPath(req.url), attempt });
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal === undefined ? timeout : AbortSignal.any([timeout, signal]);
    const started = now();
    try {
      const init: RequestInit = { method: req.method, headers: req.headers, signal: combined };
      if (req.body !== undefined) init.body = req.body;
      const res = await fetchFn(req.url, init);
      const text = await res.text();
      log({ type: "response", system, op, httpStatus: res.status, durationMs: now() - started });
      return { ok: true, status: res.status, text };
    } catch {
      const reason = isAborted(signal) ? "aborted" : timeout.aborted ? "timeout" : "network";
      return {
        ok: false,
        error: {
          kind: "transport",
          reason,
          outcome: "unknown",
          message: `request failed: ${reason}`,
        },
      };
    }
  }

  type Decoded =
    | { ok: true; envelope: import("./envelope.js").Envelope; httpStatus: number }
    | { ok: false; error: GspError; retryable: boolean };

  /** Sends with GET retries (spec §6.3) and decodes the envelope. */
  async function exchange(
    req: HttpRequest,
    system: System,
    op: OperationId,
    signal: AbortSignal | undefined,
  ): Promise<Decoded> {
    const retries = req.method === "GET" ? getRetries : 0;
    let last: Decoded | undefined;
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      if (attempt > 1) {
        const delayMs = BACKOFF_MS * 2 ** (attempt - 2);
        log({ type: "retry", system, op, attempt, delayMs });
        await sleep(delayMs);
      }
      const out = await sendOnce(req, system, op, attempt, signal);
      if (!out.ok) {
        last = { ok: false, error: out.error, retryable: out.error.reason !== "aborted" };
      } else {
        const env = provider.envelope.decode(out.text);
        if (env.ok) return { ok: true, envelope: env.value, httpStatus: out.status };
        if (out.status < 200 || out.status > 299) {
          last = {
            ok: false,
            retryable: out.status >= 500,
            error: {
              kind: "transport",
              reason: "http",
              httpStatus: out.status,
              outcome: "unknown",
              message: `HTTP ${out.status} without a NIC envelope`,
            },
          };
        } else {
          return {
            ok: false,
            retryable: false,
            error: {
              kind: "protocol",
              reason: env.error.reason,
              message: env.error.message,
              httpStatus: out.status,
              raw: out.text.slice(0, 200),
            },
          };
        }
      }
      if (!last.retryable) break;
    }
    return (
      last ?? {
        ok: false,
        retryable: false,
        error: {
          kind: "transport",
          reason: "network",
          outcome: "unknown",
          message: "no attempt made",
        },
      }
    );
  }

  const sessions = new SessionManager({
    provider,
    store: config.sessionStore ?? createMemorySessionStore(),
    now,
    sleep,
    skewMs: (config.expirySkewSeconds ?? 60) * 1000,
    onEvent: (e) => {
      log(e);
    },
    login: async (system, gstin, forceRefresh) => {
      const credentials = await credentialsFor(system, gstin);
      const op: OperationId = `${system}.auth`;
      return provider.auth.login({
        system,
        gstin,
        credentials,
        forceRefresh,
        randomBytes: random,
        redactor,
        send: async (body) => {
          const endpoint = provider.endpoint(op, {});
          if (endpoint === undefined)
            return failResult({
              kind: "config",
              reason: "no-path",
              message: `no path configured for ${op}`,
            });
          const headers = provider.buildHeaders({ system, op, gstin, credentials });
          const r = await exchange(
            { method: "POST", url: endpoint.url, headers, body: JSON.stringify(body) },
            system,
            op,
            undefined,
          );
          if (!r.ok) return failResult(r.error);
          const env = r.envelope;
          if (env.status === 0) {
            const err: GspError = {
              kind: "api",
              system,
              op,
              errors: env.errors,
              httpStatus: r.httpStatus,
              raw: env.raw,
            };
            if (env.info !== undefined) err.info = env.info;
            return failResult(err, env.warnings);
          }
          return okResult(env, []);
        },
      });
    },
  });

  function finish<T>(result: GspResult<T>, system: System, op: OperationId): GspResult<T> {
    const warnings = redactor.deep(result.warnings) as GspIssue[];
    for (const w of warnings)
      log({ type: "warning", system, op, code: w.code, message: w.message });
    if (result.ok) return { ...result, warnings };
    return { ok: false, error: redactor.deep(result.error) as GspError, warnings };
  }

  async function call<T>(spec: CallSpec<T>): Promise<GspResult<T>> {
    const system = systemOf(spec.op);
    const result = await callInner(spec, system);
    return finish(result, system, spec.op);
  }

  async function callInner<T>(spec: CallSpec<T>, system: System): Promise<GspResult<T>> {
    const warnings = [...spec.warnings];
    const g = checkGstinArgument(spec.gstin, "gstin");
    if (!g.ok) return failResult({ kind: "validation", issues: [g.issue] }, warnings);
    warnings.push(...g.warnings);
    const endpoint = provider.endpoint(spec.op, spec.params ?? {});
    if (endpoint === undefined) {
      return failResult(
        { kind: "config", reason: "no-path", message: `no path configured for ${spec.op}` },
        warnings,
      );
    }
    const credentials = await credentialsFor(system, spec.gstin);
    for (let round = 1; round <= 2; round++) {
      const s = await sessions.get(system, spec.gstin, credentials.username);
      if (!s.ok) return failResult(s.error, [...warnings, ...s.warnings]);
      warnings.push(...s.warnings);
      const session = s.value.session;
      const req: HttpRequest = {
        method: endpoint.method,
        url: endpoint.url,
        headers: provider.buildHeaders({
          system,
          op: spec.op,
          gstin: spec.gstin,
          credentials,
          session,
          ...(spec.supGstin === undefined ? {} : { supGstin: spec.supGstin }),
        }),
      };
      if (endpoint.method === "POST") {
        const body = provider.codec.encodeRequest({
          system,
          op: spec.op,
          json: spec.json ?? "{}",
          session,
          redactor,
          ...(endpoint.action === undefined ? {} : { action: endpoint.action }),
        });
        if (!body.ok) return failResult(body.error, warnings);
        req.body = JSON.stringify(body.body);
      }
      const r = await exchange(req, system, spec.op, spec.signal);
      if (!r.ok) return failResult(r.error, warnings);
      const env = r.envelope;
      warnings.push(...env.warnings);
      if (env.status === 0) {
        const codes = authCodes[system] ?? [];
        if (env.errors.some((e) => codes.includes(e.code))) {
          await sessions.invalidate(system, spec.gstin, credentials.username);
          if (endpoint.method === "GET" && round === 1) {
            warnings.push(
              warning(
                "SESSION_RENEWED",
                "the portal rejected the token; logged in again and retried once",
              ),
            );
            continue;
          }
        }
        const err: GspError = {
          kind: "api",
          system,
          op: spec.op,
          errors: env.errors,
          httpStatus: r.httpStatus,
          raw: env.raw,
        };
        if (env.info !== undefined) err.info = env.info;
        return failResult(err, warnings);
      }
      const decoded = provider.codec.decodeResponse({
        system,
        op: spec.op,
        envelope: env,
        session,
        redactor,
      });
      if (!decoded.ok) return failResult(decoded.error, warnings);
      warnings.push(...decoded.value.warnings);
      const parsedData = spec.parse(decoded.value.json);
      if (!parsedData.ok)
        return failResult(parsedData.error, [...warnings, ...(parsedData.warnings ?? [])]);
      return okResult(parsedData.value, [...warnings, ...parsedData.warnings], {
        info: env.info ?? parsedData.info,
        raw: parsedData.raw,
      });
    }
    /* c8 ignore next */
    return failResult({ kind: "config", reason: "unreachable", message: "unreachable" }, warnings);
  }

  /** A request built with one of our schemas: validate, pre-check, send. */
  function own<Req, Res>(
    op: OperationId,
    args: Common & Skip & { request: Req; supGstin?: string },
    validate: (r: unknown) => RequestValidation<Req>,
    wireSchema: z.ZodType,
    parse: (json: string | null) => Parsed<Res>,
    prechecks: GspIssue[],
  ): Promise<GspResult<Res>> {
    const prep = prepare(
      validate(args.request),
      args.request,
      (v) => writeWire(v, wireSchema),
      args.skipLocalValidation,
    );
    if (!prep.ok)
      return Promise.resolve(finish(failResult(prep.error, prechecks), systemOf(op), op));
    return call({
      op,
      gstin: args.gstin,
      supGstin: args.supGstin,
      json: prep.json,
      signal: args.signal,
      warnings: [...prep.warnings, ...prechecks],
      parse,
    });
  }

  function target(
    op: OperationId,
    args: Common & { target: string },
    source: GstinDetailsSource,
  ): Promise<GspResult<GstinDetails>> {
    const t = checkGstinArgument(args.target, "target");
    if (!t.ok)
      return Promise.resolve(
        finish(failResult({ kind: "validation", issues: [t.issue] }), systemOf(op), op),
      );
    return call({
      op,
      gstin: args.gstin,
      params: { gstin: args.target },
      signal: args.signal,
      warnings: t.warnings,
      parse: parseGstin(source),
    });
  }

  function irnArg(op: OperationId, irn: string): GspResult<never> | undefined {
    return IRN_PATTERN.test(irn)
      ? undefined
      : finish(
          failResult({
            kind: "validation",
            issues: [
              {
                code: "BAD_IRN",
                severity: "error",
                message: "IRN must be 64 hexadecimal characters",
                path: ["irn"],
              },
            ],
          }),
          systemOf(op),
          op,
        );
  }

  async function login(system: System, args: { gstin: string }): Promise<GspResult<LoginInfo>> {
    const op: OperationId = `${system}.auth`;
    const g = checkGstinArgument(args.gstin, "gstin");
    if (!g.ok) return finish(failResult({ kind: "validation", issues: [g.issue] }), system, op);
    const c = await credentialsFor(system, args.gstin);
    const s = await sessions.get(system, args.gstin, c.username);
    if (!s.ok) return finish(s, system, op);
    const { session, reused } = s.value;
    return finish(
      okResult({ expiresAt: session.expiresAt, expirySource: session.expirySource, reused }, [
        ...g.warnings,
        ...s.warnings,
      ]),
      system,
      op,
    );
  }

  const einvoice = {
    login: (args: { gstin: string }) => login("einvoice", args),
    getGstinDetails: (args: Common & { target: string }) =>
      target("einvoice.getGstinDetails", args, "einvoice"),
    syncGstinDetails: (args: Common & { target: string }) =>
      target("einvoice.syncGstinDetails", args, "einvoice-sync"),

    generateIrn(
      args: Common & Skip & { request: IrnRequest; validateOptions?: ValidateOptions },
    ): Promise<GspResult<SignedEinvoice>> {
      const v = packageValidation(validateIrnRequest(args.request, args.validateOptions ?? {}));
      const prep = prepare(v, args.request, serializeIrnRequest, args.skipLocalValidation);
      if (!prep.ok)
        return Promise.resolve(finish(failResult(prep.error), "einvoice", "einvoice.generateIrn"));
      return call({
        op: "einvoice.generateIrn",
        gstin: args.gstin,
        json: prep.json,
        signal: args.signal,
        warnings: prep.warnings,
        parse: parseSigned(EINVOICE_STATUSES),
      });
    },

    cancelIrn(
      args: Common &
        Skip & {
          request: CancelIrnRequest;
          supGstin?: string;
          context?: { ackDt?: string; activeEwbExists?: boolean };
        },
    ): Promise<GspResult<CancelIrnResponse>> {
      return own(
        "einvoice.cancelIrn",
        args,
        validateCancelIrnRequest,
        CancelIrnRequestSchema,
        parseWith(CancelIrnResponseSchema),
        precheckCancelIrn(args.context ?? {}, now()),
      );
    },

    getEinvoiceByIrn(
      args: Common & { irn: string; supGstin?: string; context?: { ackDt?: string } },
    ): Promise<GspResult<SignedEinvoice>> {
      const bad = irnArg("einvoice.getEinvoiceByIrn", args.irn);
      if (bad !== undefined) return Promise.resolve(bad);
      return call({
        op: "einvoice.getEinvoiceByIrn",
        gstin: args.gstin,
        supGstin: args.supGstin,
        params: { irn: args.irn },
        signal: args.signal,
        warnings: precheckIrnLookup(args.context ?? {}, now()),
        parse: parseSigned(EINVOICE_STATUSES_GET),
      });
    },

    getIrnByDocDetails(
      args: Common & IrnByDocQuery & { supGstin?: string; context?: { ackDt?: string } },
    ): Promise<GspResult<SignedEinvoice>> {
      const q = IrnByDocQuerySchema.safeParse({
        docType: args.docType,
        docNum: args.docNum,
        docDate: args.docDate,
      });
      if (!q.success) {
        const issues = q.error.issues.map((i): GspIssue => ({
          code: "SCHEMA",
          severity: "error",
          message: i.message,
          path: i.path.map(String),
        }));
        return Promise.resolve(
          finish(
            failResult({ kind: "validation", issues }),
            "einvoice",
            "einvoice.getIrnByDocDetails",
          ),
        );
      }
      return call({
        op: "einvoice.getIrnByDocDetails",
        gstin: args.gstin,
        supGstin: args.supGstin,
        params: q.data,
        signal: args.signal,
        warnings: precheckIrnLookup(args.context ?? {}, now()),
        parse: parseSigned(EINVOICE_STATUSES),
      });
    },

    getEwbByIrn(
      args: Common & { irn: string; supGstin?: string },
    ): Promise<GspResult<EwbByIrnDetails>> {
      const bad = irnArg("einvoice.getEwbByIrn", args.irn);
      if (bad !== undefined) return Promise.resolve(bad);
      return call({
        op: "einvoice.getEwbByIrn",
        gstin: args.gstin,
        supGstin: args.supGstin,
        params: { irn: args.irn },
        signal: args.signal,
        warnings: [],
        parse: parseWith(EwbByIrnDetailsSchema, (v) => statusWarnings(v.Status, EINVOICE_STATUSES)),
      });
    },

    generateEwbByIrn(
      args: Common &
        Skip & { request: EwbByIrnRequest; supGstin?: string; validateOptions?: ByIrnOptions },
    ): Promise<GspResult<EwbByIrnResponse>> {
      const v = packageValidation(
        validateEwbByIrnRequest(args.request, args.validateOptions ?? {}),
      );
      const prep = prepare(v, args.request, serializeEwbByIrnRequest, args.skipLocalValidation);
      if (!prep.ok)
        return Promise.resolve(
          finish(failResult(prep.error), "einvoice", "einvoice.generateEwbByIrn"),
        );
      return call({
        op: "einvoice.generateEwbByIrn",
        gstin: args.gstin,
        supGstin: args.supGstin,
        json: prep.json,
        signal: args.signal,
        warnings: prep.warnings,
        parse: parseEwbPackage(parseEwbByIrnResponseData),
      });
    },
  };

  type EwbCtx = { validUpto?: string; status?: string };
  const ewaybill = {
    login: (args: { gstin: string }) => login("ewaybill", args),

    generate(
      args: Common & Skip & { request: EwbRequest; validateOptions?: GenerateOptions },
    ): Promise<GspResult<EwbResponse>> {
      const v = packageValidation(validateEwbRequest(args.request, args.validateOptions ?? {}));
      const prep = prepare(v, args.request, serializeEwbRequest, args.skipLocalValidation);
      if (!prep.ok)
        return Promise.resolve(finish(failResult(prep.error), "ewaybill", "ewaybill.generate"));
      return call({
        op: "ewaybill.generate",
        gstin: args.gstin,
        json: prep.json,
        signal: args.signal,
        warnings: prep.warnings,
        parse: parseEwbPackage(parseEwbResponseData),
      });
    },

    updateVehicle(
      args: Common & Skip & { request: UpdateVehicleRequest; context?: EwbCtx },
    ): Promise<GspResult<UpdateVehicleResponse>> {
      return own(
        "ewaybill.updateVehicle",
        args,
        validateUpdateVehicleRequest,
        UpdateVehicleRequestSchema,
        parseWith(UpdateVehicleResponseSchema, (v) =>
          ewbDateWarnings(v, ["vehUpdDate", "validUpto"]),
        ),
        precheckEwbActive(args.context ?? {}, now()),
      );
    },

    cancel(
      args: Common &
        Skip & { request: CancelEwbRequest; context?: { ewbDate?: string; role?: EwbRole } },
    ): Promise<GspResult<CancelEwbResponse>> {
      return own(
        "ewaybill.cancel",
        args,
        validateCancelEwbRequest,
        CancelEwbRequestSchema,
        parseWith(CancelEwbResponseSchema, (v) => ewbDateWarnings(v, ["cancelDate"])),
        precheckCancelEwb(args.context ?? {}, now()),
      );
    },

    extendValidity(
      args: Common &
        Skip & {
          request: ExtendValidityRequest;
          context?: { validUpto?: string; ewbDate?: string; role?: EwbRole };
        },
    ): Promise<GspResult<ExtendValidityResponse>> {
      return own(
        "ewaybill.extendValidity",
        args,
        validateExtendValidityRequest,
        ExtendValidityRequestSchema,
        parseWith(ExtendValidityResponseSchema, (v) =>
          ewbDateWarnings(v, ["updatedDate", "validUpto"]),
        ),
        precheckExtendValidity(args.context ?? {}, now()),
      );
    },

    consolidated(
      args: Common & Skip & { request: ConsolidatedEwbRequest; context?: { ewbs?: EwbCtx[] } },
    ): Promise<GspResult<ConsolidatedEwbResponse>> {
      const t = now();
      const pre = (args.context?.ewbs ?? []).flatMap((c, i) =>
        precheckEwbActive(c, t).map((w) => ({ ...w, path: ["tripSheetEwbBills", i] })),
      );
      return own(
        "ewaybill.consolidated",
        args,
        validateConsolidatedEwbRequest,
        ConsolidatedEwbRequestSchema,
        parseWith(ConsolidatedEwbResponseSchema, (v) => ewbDateWarnings(v, ["cEWBDate"])),
        pre,
      );
    },

    updateTransporter(
      args: Common & Skip & { request: UpdateTransporterRequest; context?: EwbCtx },
    ): Promise<GspResult<UpdateTransporterResponse>> {
      return own(
        "ewaybill.updateTransporter",
        args,
        validateUpdateTransporterRequest,
        UpdateTransporterRequestSchema,
        parseWith(UpdateTransporterResponseSchema, (v) => ewbDateWarnings(v, ["transUpdateDate"])),
        precheckEwbActive(args.context ?? {}, now()),
      );
    },

    reject(
      args: Common &
        Skip & { request: RejectEwbRequest; context?: { ewbDate?: string; role?: EwbRole } },
    ): Promise<GspResult<RejectEwbResponse>> {
      return own(
        "ewaybill.reject",
        args,
        validateRejectEwbRequest,
        RejectEwbRequestSchema,
        parseWith(RejectEwbResponseSchema, (v) => ewbDateWarnings(v, ["ewbRejectedDate"])),
        precheckRejectEwb(args.context ?? {}, now()),
      );
    },

    getGstinDetails: (args: Common & { target: string }) =>
      target("ewaybill.getGstinDetails", args, "ewaybill"),
  };

  return {
    einvoice,
    ewaybill,
    async invalidateSession(system: System, gstin: string): Promise<void> {
      const c = await credentialsFor(system, gstin);
      await sessions.invalidate(system, gstin, c.username);
    },
  };
}
