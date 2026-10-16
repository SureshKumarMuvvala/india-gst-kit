// Source: https://einvoice1.gst.gov.in/Documents/SampleJson.json — sources/einvoice/sample-signed-einvoice.json
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
//
// Decode-only handling of the signed invoice and signed QR JWTs (docs/specs/einvoice.md §8). The signature is NOT
// verified: that needs NIC's public signing certificate, which is not in sources/ (§8.4). Results always carry
// `signatureVerified: false`.
import { z } from "zod";
import { toIrnIssues } from "./json.js";
import { markNumber, parseJsonLossless, parseLenient, pathStartsWith } from "@india-gst-kit/model";
import { convertIrnNumbers } from "./numbers.js";
import { IRN_INT_PATTERN, IrnRequestSchema, ItemSchema } from "./schema.js";
import { hasErrors, issue, type IrnIssue } from "./types.js";

export type DecodeResult<T> = {
  ok: boolean;
  value?: T;
  /** The decoded JSON as published (plain `JSON.parse`), always returned when decoding got that far. */
  raw: unknown;
  issues: IrnIssue[];
  signatureVerified: false;
};

export const JwtHeaderSchema = z.strictObject({
  alg: z.literal("RS256"),
  kid: z.string().min(1),
  typ: z.literal("JWT"),
  x5t: z.string().min(1),
});
export const JwtClaimsSchema = z.strictObject({ data: z.string(), iss: z.string() });

const intLeaf = (max: string) =>
  markNumber(
    z
      .string()
      .regex(IRN_INT_PATTERN)
      .refine(
        (s) => !IRN_INT_PATTERN.test(s) || BigInt(s) <= BigInt(max),
        `must be at most ${max}`,
      ),
  );

export const SignedInvoiceDataSchema = IrnRequestSchema.extend({
  AckNo: intLeaf("999999999999999999"),
  AckDt: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
  Irn: z.string().regex(/^[0-9a-f]{64}$/),
  ItemList: z.array(ItemSchema.extend({ ItemNo: intLeaf("999999") })),
});
export type SignedInvoiceData = z.infer<typeof SignedInvoiceDataSchema>;

export const SignedQrDataSchema = z.strictObject({
  SellerGstin: z.string().regex(/^[0-9]{2}[0-9A-Z]{13}$/),
  BuyerGstin: z.string().regex(/^(([0-9]{2}[0-9A-Z]{13})|URP)$/),
  DocNo: z.string().regex(/^([a-zA-Z1-9]{1}[a-zA-Z0-9/-]{0,15})$/),
  DocTyp: z.enum(["INV", "CRN", "DBN"]),
  DocDt: z.string().regex(/^[0-3][0-9]\/[0-1][0-9]\/[2][0][1-2][0-9]$/),
  TotInvVal: markNumber(z.string().regex(/^-?(0|[1-9]\d*)(\.\d+)?$/)),
  ItemCnt: intLeaf("1000"),
  MainHsnCode: z.string().regex(/^(?!0+$)([0-9]{4}|[0-9]{6}|[0-9]{8})$/),
  Irn: z.string().regex(/^[0-9a-f]{64}$/),
});
export type SignedQrData = z.infer<typeof SignedQrDataSchema>;

const B64URL = /^[A-Za-z0-9_-]*$/;

/** Decodes one base64url segment to a UTF-8 string, or reports why not. */
function decodeSegment(segment: string, path: string[], issues: IrnIssue[]): string | undefined {
  if (!B64URL.test(segment) || segment.length % 4 === 1) {
    issues.push(issue(path, "BAD_BASE64URL", "J-BASE64URL", "not valid unpadded base64url"));
    return undefined;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(segment, "base64url"));
  } catch {
    issues.push(issue(path, "BAD_JSON", "J-UTF8", "not valid UTF-8"));
    return undefined;
  }
}

interface JsonPart {
  raw: unknown;
  lossless: unknown;
}

function parseJsonText(text: string, path: string[], issues: IrnIssue[]): JsonPart | undefined {
  try {
    return { raw: JSON.parse(text) as unknown, lossless: parseJsonLossless(text) };
  } catch (e) {
    if (e instanceof SyntaxError) {
      issues.push(issue(path, "BAD_JSON", "J-JSON", e.message));
      return undefined;
    }
    throw e;
  }
}

/** Validates `lossless` against `schema`; unknown keys are warnings, everything else an error. */
function validatePart<S extends z.ZodType>(
  schema: S,
  part: JsonPart,
  prefix: string[],
  rule: string,
  issues: IrnIssue[],
): z.output<S> | undefined {
  const typeIssues: IrnIssue[] = [];
  const converted = convertIrnNumbers(part.lossless, schema, typeIssues, prefix, "J-TYPE");
  const r = parseLenient(schema, converted);
  issues.push(...typeIssues);
  for (const p of r.unknown) {
    issues.push(
      issue(
        [...prefix, ...p],
        "UNEXPECTED_KEY",
        "J-UNKNOWN-KEY",
        `unknown key "${String(p[p.length - 1])}"`,
        "warning",
      ),
    );
  }
  const schemaIssues = toIrnIssues(r.issues, converted, { prefix, rule }).filter(
    (i) => !typeIssues.some((t) => pathStartsWith(i.path, t.path)),
  );
  for (const i of schemaIssues) {
    if (i.path.join(".") === "header.alg" && rule === "J-HEADER") {
      issues.push({
        ...i,
        code: "UNSUPPORTED_ALG",
        rule: "J-ALG",
        message: 'only alg "RS256" is supported',
      });
    } else {
      issues.push(i);
    }
  }
  return r.issues.length === 0 && typeIssues.length === 0 ? (r.data as z.output<S>) : undefined;
}

export interface JwtParts {
  header: z.infer<typeof JwtHeaderSchema>;
  claims: z.infer<typeof JwtClaimsSchema>;
  signature: string;
  signingInput: string;
}

/** Decodes a compact JWS. Does not verify the signature. */
export function decodeJwt(token: string): DecodeResult<JwtParts> {
  if (typeof token !== "string") throw new TypeError("decodeJwt() expects a string");
  const issues: IrnIssue[] = [];
  const fail = (raw?: unknown): DecodeResult<JwtParts> => ({
    ok: false,
    raw,
    issues,
    signatureVerified: false,
  });
  const segments = token.split(".");
  const [h, c, sig] = segments;
  if (segments.length !== 3 || h === undefined || c === undefined || sig === undefined) {
    issues.push(
      issue([], "MALFORMED_JWT", "J-FORMAT", "a JWT has exactly 3 dot-separated segments"),
    );
    return fail();
  }
  const headerText = decodeSegment(h, ["header"], issues);
  const claimsText = decodeSegment(c, ["claims"], issues);
  if (!B64URL.test(sig) || sig.length % 4 === 1) {
    issues.push(
      issue(["signature"], "BAD_BASE64URL", "J-BASE64URL", "not valid unpadded base64url"),
    );
  }
  const headerPart =
    headerText === undefined ? undefined : parseJsonText(headerText, ["header"], issues);
  const claimsPart =
    claimsText === undefined ? undefined : parseJsonText(claimsText, ["claims"], issues);
  const raw = { header: headerPart?.raw, claims: claimsPart?.raw };
  if (headerPart === undefined || claimsPart === undefined) return fail(raw);
  const header = validatePart(JwtHeaderSchema, headerPart, ["header"], "J-HEADER", issues);
  const claims = validatePart(JwtClaimsSchema, claimsPart, ["claims"], "J-CLAIMS", issues);
  if (header === undefined || claims === undefined || hasErrors(issues)) return fail(raw);
  return {
    ok: true,
    value: { header, claims, signature: sig, signingInput: `${h}.${c}` },
    raw,
    issues,
    signatureVerified: false,
  };
}

function decodeData<S extends z.ZodType>(
  token: string,
  schema: S,
  rule: string,
): DecodeResult<z.output<S>> {
  const jwt = decodeJwt(token);
  const issues = [...jwt.issues];
  const rawJwt = jwt.raw as { header?: unknown; claims?: unknown } | undefined;
  if (jwt.value === undefined) {
    return { ok: false, raw: rawJwt, issues, signatureVerified: false };
  }
  const part = parseJsonText(jwt.value.claims.data, ["data"], issues);
  const raw = { header: rawJwt?.header, claims: rawJwt?.claims, data: part?.raw };
  if (part === undefined) return { ok: false, raw, issues, signatureVerified: false };
  const value = validatePart(schema, part, ["data"], rule, issues);
  const ok = !hasErrors(issues);
  return {
    ok,
    ...(ok && value !== undefined ? { value } : {}),
    raw,
    issues,
    signatureVerified: false,
  };
}

/** Decodes the `SignedInvoice` JWT of an IRN response (decode only, no signature check). */
export function decodeSignedInvoice(jwt: string): DecodeResult<SignedInvoiceData> {
  return decodeData(jwt, SignedInvoiceDataSchema, "J-DATA");
}

/** Decodes the `SignedQRCode` JWT of an IRN response (decode only, no signature check). */
export function decodeSignedQrCode(jwt: string): DecodeResult<SignedQrData> {
  return decodeData(jwt, SignedQrDataSchema, "J-QR");
}
