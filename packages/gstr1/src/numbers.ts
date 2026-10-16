import { z } from "zod";

// Local copy of the technique used by `einvoice` (zod-walk.ts / lossless.ts / json.ts): number leaves are JSON
// numbers on the wire but decimal strings in memory, tracked by schema identity so the writer and the lossless
// parser can tell them from string leaves. Kept here because `@india-gst-kit/model` does not export it yet
// (spec deviation, see the PR).

const NUMBER_LEAVES = new WeakSet<object>();

export function markNumber<T extends z.ZodType>(schema: T): T {
  NUMBER_LEAVES.add(schema);
  return schema;
}

/** Strips `.optional()` / `.nullable()` wrappers. */
function unwrapSchema(schema: z.ZodType): z.ZodType {
  let cur = schema;
  while (cur instanceof z.ZodOptional || cur instanceof z.ZodNullable) {
    cur = cur.unwrap() as z.ZodType;
  }
  return cur;
}

function isNumberLeaf(schema: z.ZodType): boolean {
  return NUMBER_LEAVES.has(unwrapSchema(schema));
}

function objectShape(schema: z.ZodType): Readonly<Record<string, z.ZodType>> | undefined {
  const u = unwrapSchema(schema);
  return u instanceof z.ZodObject ? u.shape : undefined;
}

function arrayElement(schema: z.ZodType): z.ZodType | undefined {
  const u = unwrapSchema(schema);
  return u instanceof z.ZodArray ? (u.element as z.ZodType) : undefined;
}

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

/** A JSON number kept as its source text, so no digit is ever lost to a double. */
class JsonNumber {
  constructor(readonly source: string) {}
}

/** Stands in for a value of the wrong JSON type so that Zod reports it. */
class WrongType {
  constructor(readonly found: string) {}
}

/** `JSON.parse` that turns every number into a {@link JsonNumber} (Node ≥ 22: reviver `context.source`). */
function parseJsonLossless(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value !== "number") return value;
    if (context?.source === undefined) {
      throw new Error("JSON.parse source text access is not available; Node >= 22 is required");
    }
    return new JsonNumber(context.source);
  });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof JsonNumber);
}

/** Number leaves get the source text; other numbers become doubles; strings under number leaves are wrong. */
function convertNumbers(value: unknown, schema: z.ZodType | undefined): unknown {
  if (value instanceof JsonNumber) {
    return schema !== undefined && isNumberLeaf(schema) ? value.source : Number(value.source);
  }
  if (typeof value === "string") {
    return schema !== undefined && isNumberLeaf(schema) ? new WrongType("a string") : value;
  }
  if (Array.isArray(value)) {
    const element = schema === undefined ? undefined : arrayElement(schema);
    return value.map((v: unknown) => convertNumbers(v, element));
  }
  if (isPlainObject(value)) {
    const shape = schema === undefined ? undefined : objectShape(schema);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = convertNumbers(v, shape?.[k]);
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
  return schema.safeParse(convertNumbers(raw, schema));
}
