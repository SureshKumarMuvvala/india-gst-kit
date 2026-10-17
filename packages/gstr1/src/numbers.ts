import { z } from "zod";
import {
  JsonNumber,
  arrayElement,
  isNumberLeaf,
  objectShape,
  parseJsonLossless,
} from "@india-gst-kit/model";

// Number leaves are JSON numbers on the wire but decimal strings in memory. The leaf registry, `JsonNumber` and the
// lossless reader come from `@india-gst-kit/model` (model spec §6.8): one registry for every package. Kept here: the
// writer (insertion key order; model decision D-S14) and the converter, because gstr1's plain `z.number()` count
// fields must become doubles and a string under a number leaf must surface as a Zod type error (decision D-S13).

export { markNumber } from "@india-gst-kit/model";

const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/**
 * Compact JSON in the insertion order of `value`'s keys. Strings under a number leaf of `schema` are written
 * as raw number literals, never through `Number`.
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
      if (!JSON_NUMBER.test(value)) {
        throw new RangeError(`${path.join(".")}: "${value}" is not a JSON number literal`);
      }
      return value;
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const element = schema === undefined ? undefined : arrayElement(schema);
    return `[${value.map((v: unknown, i) => writeJson(v, element, [...path, i])).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const shape = schema === undefined ? undefined : objectShape(schema);
    return `{${Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${writeJson(record[k], shape?.[k], [...path, k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Stands in for a value of the wrong JSON type so that Zod reports it. */
class WrongType {
  constructor(readonly found: string) {}
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof JsonNumber);
}

/** Number leaves get the source text; other numbers become doubles; strings under number leaves are wrong. */
function convertGstr1Numbers(value: unknown, schema: z.ZodType | undefined): unknown {
  if (value instanceof JsonNumber) {
    return schema !== undefined && isNumberLeaf(schema) ? value.source : Number(value.source);
  }
  if (typeof value === "string") {
    return schema !== undefined && isNumberLeaf(schema) ? new WrongType("a string") : value;
  }
  if (Array.isArray(value)) {
    const element = schema === undefined ? undefined : arrayElement(schema);
    return value.map((v: unknown) => convertGstr1Numbers(v, element));
  }
  if (isPlainObject(value)) {
    const shape = schema === undefined ? undefined : objectShape(schema);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = convertGstr1Numbers(v, shape?.[k]);
    return out;
  }
  return value;
}

/** Parses JSON text keeping exact number text, then validates with `schema`. Never throws on bad input. */
export function parseWire<S extends z.ZodType>(
  schema: S,
  text: string,
): z.ZodSafeParseResult<z.output<S>> {
  let raw: unknown;
  try {
    raw = parseJsonLossless(text);
  } catch (e) {
    if (e instanceof SyntaxError) {
      const error = new z.ZodError([
        { code: "custom", path: [], message: `invalid JSON: ${e.message}`, input: text },
      ]);
      return { success: false, error } as unknown as z.ZodSafeParseResult<z.output<S>>;
    }
    throw e;
  }
  return schema.safeParse(convertGstr1Numbers(raw, schema));
}
