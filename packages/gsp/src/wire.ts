import { z } from "zod";
import {
  arrayElement,
  isNumberLeaf,
  JsonNumber,
  objectShape,
  parseJsonLossless,
  parseLenient,
  zodPath,
} from "@india-gst-kit/model";
import { warning, type GspIssue } from "./issues.js";

const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/** Integer strings may carry leading zeros in memory ("08"); JSON number literals may not. */
function numberLiteral(value: string, path: (string | number)[]): string {
  const v = /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/, "") : value;
  if (!JSON_NUMBER.test(v))
    throw new RangeError(`${path.join(".")}: "${value}" is not a JSON number literal`);
  return v;
}

function write(value: unknown, schema: z.ZodType | undefined, path: (string | number)[]): string {
  if (value === undefined) throw new TypeError(`undefined at ${path.join(".")}`);
  if (typeof value === "string") {
    return schema !== undefined && isNumberLeaf(schema)
      ? numberLiteral(value, path)
      : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const element = schema === undefined ? undefined : arrayElement(schema);
    return `[${value.map((v: unknown, i) => write(v, element, [...path, i])).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const shape = schema === undefined ? undefined : objectShape(schema);
    const known =
      shape === undefined ? [] : Object.keys(shape).filter((k) => record[k] !== undefined);
    const extra = Object.keys(record).filter((k) => !known.includes(k) && record[k] !== undefined);
    return `{${[...known, ...extra]
      .map((k) => `${JSON.stringify(k)}:${write(record[k], shape?.[k], [...path, k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Compact JSON in the schema's key order; number leaves (strings in memory) are written as raw JSON number
 * literals, never through `Number` (D-G18).
 * @throws RangeError if a number leaf is not a number literal (a programmer error, or skipped validation).
 */
export function writeWire(value: unknown, schema: z.ZodType): string {
  return write(value, schema, []);
}

/** Every JSON number becomes its source text: responses accept numbers or strings and return strings. */
export function numbersToStrings(value: unknown): unknown {
  if (value instanceof JsonNumber) return value.source;
  if (Array.isArray(value)) return value.map(numbersToStrings);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = numbersToStrings(v);
    return out;
  }
  return value;
}

/** Lossless parse with numbers as strings; `undefined` if the text is not JSON. */
export function parseJsonAsStrings(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: numbersToStrings(parseJsonLossless(text)) };
  } catch (e) {
    if (e instanceof SyntaxError) return { ok: false };
    throw e;
  }
}

export type LenientParse<T> =
  | { ok: true; value: T; warnings: GspIssue[]; raw: unknown }
  | { ok: false; issues: GspIssue[]; raw: unknown };

/**
 * Parses a decrypted response: lossless numbers as strings, unknown keys dropped as `UNEXPECTED_KEY` warnings,
 * anything else wrong is an error issue (the caller turns it into `protocol/response-schema`).
 */
export function parseResponse<S extends z.ZodType>(
  json: string,
  schema: S,
): LenientParse<z.output<S>> {
  const parsed = parseJsonAsStrings(json);
  if (!parsed.ok) {
    return {
      ok: false,
      issues: [{ code: "BAD_JSON", severity: "error", message: "not JSON" }],
      raw: json,
    };
  }
  const raw = parsed.value;
  const r = parseLenient(schema, raw);
  const warnings = r.unknown.map((p) =>
    warning("UNEXPECTED_KEY", `unknown key "${String(p.at(-1))}"`, p),
  );
  if (r.issues.length > 0) {
    return {
      ok: false,
      issues: [
        ...warnings,
        ...r.issues.map((i): GspIssue => ({
          code: "SCHEMA",
          severity: "error",
          message: i.message,
          path: zodPath(i.path),
        })),
      ],
      raw,
    };
  }
  return { ok: true, value: r.data as z.output<S>, warnings, raw };
}
