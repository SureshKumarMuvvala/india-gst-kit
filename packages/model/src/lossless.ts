import { z } from "zod";

// Number leaves are JSON numbers on the wire but strings in memory. They are tracked by identity so that
// serialisers and the lossless parser can tell them apart from string leaves.
const NUMBER_LEAVES = new WeakSet<object>();

export function markNumber<T extends z.ZodType>(schema: T): T {
  NUMBER_LEAVES.add(schema);
  return schema;
}

/** Strips `.optional()` / `.nullable()` wrappers. */
export function unwrapSchema(schema: z.ZodType): z.ZodType {
  let cur = schema;
  while (cur instanceof z.ZodOptional || cur instanceof z.ZodNullable) {
    cur = cur.unwrap() as z.ZodType;
  }
  return cur;
}

export function isNumberLeaf(schema: z.ZodType): boolean {
  return NUMBER_LEAVES.has(unwrapSchema(schema));
}

export function objectShape(schema: z.ZodType): Readonly<Record<string, z.ZodType>> | undefined {
  const u = unwrapSchema(schema);
  return u instanceof z.ZodObject ? u.shape : undefined;
}

export function arrayElement(schema: z.ZodType): z.ZodType | undefined {
  const u = unwrapSchema(schema);
  return u instanceof z.ZodArray ? (u.element as z.ZodType) : undefined;
}

/** A JSON number kept as its source text, so no digit is ever lost to a double. */
export class JsonNumber {
  constructor(readonly source: string) {}
}

type Path = (string | number)[];
export type ZodIssue = z.core.$ZodIssue;

/** A number/string mismatch found by {@link convertNumbers}; callers wrap it in their own issue type. */
export type LosslessTypeIssue = { path: Path; message: string };

/** `JSON.parse` that turns every number into a {@link JsonNumber} (needs Node ≥ 22: reviver `context.source`). */
export function parseJsonLossless(text: string): unknown {
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

/**
 * Replaces {@link JsonNumber}s by their source text where `schema` has a number leaf. A string where a
 * number belongs, or a number where a string belongs, is pushed to `issues` and replaced by `undefined`.
 */
export function convertNumbers(
  value: unknown,
  schema: z.ZodType | undefined,
  path: Path,
  issues: LosslessTypeIssue[],
  prefix: Path = [],
): unknown {
  const here = [...prefix, ...path];
  if (value instanceof JsonNumber) {
    if (schema === undefined || isNumberLeaf(schema)) return value.source;
    issues.push({ path: here, message: "expected a string, found a JSON number" });
    return undefined;
  }
  if (typeof value === "string") {
    if (schema !== undefined && isNumberLeaf(schema)) {
      issues.push({ path: here, message: "expected a JSON number, found a string" });
      return undefined;
    }
    return value;
  }
  if (Array.isArray(value)) {
    const element = schema === undefined ? undefined : arrayElement(schema);
    return value.map((v: unknown, i) => convertNumbers(v, element, [...path, i], issues, prefix));
  }
  if (isPlainObject(value)) {
    const shape = schema === undefined ? undefined : objectShape(schema);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = convertNumbers(v, shape?.[k], [...path, k], issues, prefix);
    }
    return out;
  }
  return value;
}

export function pathStartsWith(
  path: readonly (string | number)[],
  prefix: readonly (string | number)[],
): boolean {
  return prefix.length <= path.length && prefix.every((p, i) => path[i] === p);
}

export function zodPath(issuePath: readonly PropertyKey[]): Path {
  return issuePath.map((p) => (typeof p === "number" ? p : String(p)));
}

export function getAt(root: unknown, path: readonly (string | number)[]): unknown {
  let cur = root;
  for (const p of path) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string | number, unknown>)[p];
  }
  return cur;
}

export interface LenientResult {
  data?: unknown;
  issues: ZodIssue[];
  /** Unknown keys that were dropped, with their full path. */
  unknown: Path[];
}

/**
 * Parses with a strict-object schema but drops unknown keys (reporting them) instead of failing, repeating
 * until only genuine issues remain. The input is not mutated.
 */
export function parseLenient(schema: z.ZodType, input: unknown): LenientResult {
  const work = structuredClone(input);
  const unknown: Path[] = [];
  for (let round = 0; round < 50; round++) {
    const r = schema.safeParse(work);
    if (r.success) return { data: r.data, issues: [], unknown };
    const unrecognised = r.error.issues.filter((i) => i.code === "unrecognized_keys");
    if (unrecognised.length === 0) return { issues: r.error.issues, unknown };
    for (const u of unrecognised) {
      const base = zodPath(u.path);
      const target = getAt(work, base);
      if (typeof target !== "object" || target === null) continue;
      for (const key of u.keys) {
        Reflect.deleteProperty(target, key);
        unknown.push([...base, key]);
      }
    }
  }
  return { issues: [], unknown };
}
