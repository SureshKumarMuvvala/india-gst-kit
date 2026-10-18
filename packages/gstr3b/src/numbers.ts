import { z } from "zod";
import { JsonNumber, isNumberLeaf, parseJsonLossless, unwrapSchema } from "@india-gst-kit/model";
import { D } from "./decimal.js";

// Number leaves are JSON numbers on the wire and decimal strings in memory (spec §2). The leaf registry, JsonNumber and
// the lossless reader come from @india-gst-kit/model; the writer and the converter are kept here, like gstr1's, because
// SV's `itc_inelg` items are a union (`oneOf`) whose number leaves must still be found.

export { markNumber } from "@india-gst-kit/model";

/** The object shape of `schema`; for a union of objects, the merged shapes of its options. */
export function shapeOf(
  schema: z.ZodType | undefined,
): Readonly<Record<string, z.ZodType>> | undefined {
  if (schema === undefined) return undefined;
  const u = unwrapSchema(schema);
  if (u instanceof z.ZodObject) return u.shape;
  if (u instanceof z.ZodUnion) {
    const merged: Record<string, z.ZodType> = {};
    for (const o of u.options as readonly z.ZodType[]) {
      for (const [k, v] of Object.entries(shapeOf(o) ?? {})) merged[k] ??= v;
    }
    return merged;
  }
  return undefined;
}

function elementOf(schema: z.ZodType | undefined): z.ZodType | undefined {
  if (schema === undefined) return undefined;
  const u = unwrapSchema(schema);
  return u instanceof z.ZodArray ? (u.element as z.ZodType) : undefined;
}

const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/**
 * Compact JSON in the insertion order of `value`'s keys. Strings under a number leaf of `schema` are written as raw
 * number literals, never through `Number`.
 * @throws RangeError if a number leaf is not a valid JSON number literal (a programmer error).
 */
export function writeJson(
  value: unknown,
  schema: z.ZodType | undefined,
  path: (string | number)[] = [],
): string {
  if (value === undefined) throw new TypeError(`undefined at ${path.join(".")}`);
  if (typeof value === "string") {
    if (schema !== undefined && isNumberLeaf(schema)) {
      if (!JSON_NUMBER.test(value))
        throw new RangeError(`${path.join(".")}: "${value}" is not a JSON number literal`);
      return value;
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const element = elementOf(schema);
    return `[${value.map((v: unknown, i) => writeJson(v, element, [...path, i])).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const shape = shapeOf(schema);
    return `{${Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${writeJson(record[k], shape?.[k], [...path, k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Stands in for a value of the wrong JSON type so that Zod reports it (as a WRONG_TYPE issue). */
export class WrongType {
  constructor(readonly found: string) {}
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof JsonNumber);
}

/**
 * Number leaves get the source text; a string under a number leaf, or a number under a string leaf, becomes a
 * {@link WrongType} and its path is pushed to `wrong` (reported as WRONG_TYPE).
 */
export function convertWire(
  value: unknown,
  schema: z.ZodType | undefined,
  wrong: (string | number)[][],
  path: (string | number)[] = [],
): unknown {
  const leaf = schema !== undefined && isNumberLeaf(schema);
  if (value instanceof JsonNumber) {
    if (leaf || schema === undefined) return value.source;
    wrong.push(path);
    return new WrongType("a number");
  }
  if (typeof value === "string") {
    if (!leaf) return value;
    wrong.push(path);
    return new WrongType("a string");
  }
  if (Array.isArray(value)) {
    const element = elementOf(schema);
    return value.map((v: unknown, i) => convertWire(v, element, wrong, [...path, i]));
  }
  if (isPlainObject(value)) {
    const shape = shapeOf(schema);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value))
      out[k] = convertWire(v, shape?.[k], wrong, [...path, k]);
    return out;
  }
  return value;
}

/** Parses JSON text keeping exact number text. Returns `undefined` with a message on a JSON syntax error. */
export function readJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: parseJsonLossless(text) };
  } catch (e) {
    if (e instanceof SyntaxError) return { ok: false, message: `invalid JSON: ${e.message}` };
    throw e;
  }
}

/** A wire money check: a JSON number with at most 2 decimals (multipleOf 0.01) within [min, max]. */
const WIRE_NUMBER = /^-?(0|[1-9]\d*)(\.\d{1,2})?$/;
export function wireMoney(min: string, max: string): z.ZodString {
  return z
    .string()
    .check((ctx) => {
      if (!WIRE_NUMBER.test(ctx.value)) {
        ctx.issues.push({
          code: "custom",
          input: ctx.value,
          message: `${ctx.value}: a number with at most 2 decimals (multipleOf 0.01)`,
        });
        return;
      }
      const n = new D(ctx.value);
      if (n.lt(min) || n.gt(max)) {
        ctx.issues.push({
          code: "custom",
          input: ctx.value,
          message: `${ctx.value}: outside ${min} … ${max}`,
        });
      }
    })
    .overwrite((v) => (WIRE_NUMBER.test(v) ? to2dp(v) : v));
}

/** Exactly 2 decimals, "-0" normalised to "0.00". */
export function to2dp(v: string): string {
  const n = new D(v);
  return n.isZero() ? "0.00" : n.toFixed(2);
}

export const MAX = "9999999999999.99";
export const MIN = "-9999999999999.99";
