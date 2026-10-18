// Source: response payload sections of every page in sources/einvoice/api/ and sources/ewaybill/api/
// Retrieved: 2026-10-18
// Status: UNVERIFIED — §15 V10
//
// The pages disagree on key case, status type, the info field's name and the error shape (§13 GD3–GD5), so the
// NIC envelope is decoded tolerantly (spec §7.1–7.2).
import { decodeBase64 } from "./crypto.js";
import type { ApiErrorEntry } from "./errors.js";
import { warning, type GspIssue } from "./issues.js";

export type Envelope = {
  status: 0 | 1;
  /** The `data` / `Data` value as received (string, object or null). */
  data: unknown;
  errors: ApiErrorEntry[];
  info?: string;
  /** Other documented keys, by lower-case name: `rek`, `hmac`, `authtoken`, `sek`. */
  extra: Record<string, unknown>;
  /** The whole envelope as parsed (not yet redacted). */
  raw: Record<string, unknown>;
  warnings: GspIssue[];
};

export type EnvelopeFailure = { reason: "bad-json" | "bad-envelope"; message: string };

const KNOWN = new Set([
  "status",
  "data",
  "errordetails",
  "infodtls",
  "error",
  "alert",
  "info",
  "rek",
  "hmac",
  "authtoken",
  "sek",
]);

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A JSON value, a JSON string, or Base64 of JSON → the JSON value; otherwise `undefined`. */
function unwrap(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const asJson = tryJson(value);
  if (asJson !== undefined) return asJson;
  const bytes = decodeBase64(value);
  return bytes === undefined ? undefined : tryJson(Buffer.from(bytes).toString("utf8"));
}

function asText(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

function lowerKeys(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
}

/** e-invoice `ErrorDetails`: array, object, JSON string or Base64 JSON of `{ ErrorCode, ErrorMessage }`. */
export function parseEinvoiceErrors(value: unknown): ApiErrorEntry[] | undefined {
  const v = unwrap(value);
  const list: unknown[] | undefined = Array.isArray(v)
    ? v
    : typeof v === "object" && v !== null
      ? [v]
      : undefined;
  if (list === undefined) return undefined;
  const out: ApiErrorEntry[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) return undefined;
    const l = lowerKeys(item as Record<string, unknown>);
    const code = asText(l.errorcode);
    if (code === undefined) return undefined;
    const message = asText(l.errormessage);
    out.push(message === undefined ? { code } : { code, message });
  }
  return out;
}

/** e-way bill `error`: `{ errorCodes: 240 }`, `"240,241"`, or Base64 / JSON-string of that. */
export function parseEwbErrors(value: unknown): ApiErrorEntry[] | undefined {
  const v = unwrap(value);
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const codes = asText(lowerKeys(v as Record<string, unknown>).errorcodes);
  if (codes === undefined) return undefined;
  const list = codes
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c !== "")
    .map((code) => ({ code }));
  return list.length > 0 ? list : undefined;
}

function infoText(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") return v === "" ? undefined : v;
  return JSON.stringify(v);
}

export function decodeNicEnvelope(
  bodyText: string,
): { ok: true; value: Envelope } | { ok: false; error: EnvelopeFailure } {
  const parsed = tryJson(bodyText);
  if (parsed === undefined)
    return { ok: false, error: { reason: "bad-json", message: "response body is not JSON" } };
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      error: { reason: "bad-envelope", message: "response body is not a JSON object" },
    };
  }
  const raw = parsed as Record<string, unknown>;
  const warnings: GspIssue[] = [];
  const l: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const lk = k.toLowerCase();
    if (!KNOWN.has(lk))
      warnings.push(warning("UNEXPECTED_KEY", `unknown envelope key "${k}"`, [k]));
    l[lk] = v;
  }
  const s = asText(l.status)?.trim();
  if (s !== "0" && s !== "1") {
    return {
      ok: false,
      error: { reason: "bad-envelope", message: `envelope status is ${JSON.stringify(l.status)}` },
    };
  }
  const status = s === "1" ? 1 : 0;
  let errors: ApiErrorEntry[] = [];
  if (status === 0) {
    const parsedErrors =
      (l.errordetails !== undefined && l.errordetails !== null
        ? parseEinvoiceErrors(l.errordetails)
        : undefined) ??
      (l.error !== undefined && l.error !== null ? parseEwbErrors(l.error) : undefined);
    errors = parsedErrors ?? [{ code: "UNKNOWN" }];
  }
  const info = infoText(l.infodtls) ?? infoText(l.alert) ?? infoText(l.info);
  const extra: Record<string, unknown> = {};
  for (const k of ["rek", "hmac", "authtoken", "sek"]) if (l[k] !== undefined) extra[k] = l[k];
  const value: Envelope = { status, data: l.data ?? null, errors, extra, raw, warnings };
  if (info !== undefined) value.info = info;
  return { ok: true, value };
}
