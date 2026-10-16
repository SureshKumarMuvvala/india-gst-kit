import { z } from "zod";
import { issue, type IrnIssue } from "./types.js";
import { arrayElement, isNumberLeaf, objectShape } from "./zod-walk.js";

/** A JSON number kept as its source text, so no digit is ever lost to a double. */
export class JsonNumber {
  constructor(readonly source: string) {}
}

type Path = (string | number)[];
export type ZodIssue = z.core.$ZodIssue;

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
 * number belongs, or a number where a string belongs, is reported as WRONG_TYPE and replaced by `undefined`.
 */
export function convertNumbers(
  value: unknown,
  schema: z.ZodType | undefined,
  path: Path,
  issues: IrnIssue[],
  prefix: Path = [],
  rule = "S-TYPE",
): unknown {
  const here = [...prefix, ...path];
  if (value instanceof JsonNumber) {
    if (schema === undefined || isNumberLeaf(schema)) return value.source;
    issues.push(issue(here, "WRONG_TYPE", rule, "expected a string, found a JSON number"));
    return undefined;
  }
  if (typeof value === "string") {
    if (schema !== undefined && isNumberLeaf(schema)) {
      issues.push(issue(here, "WRONG_TYPE", rule, "expected a JSON number, found a string"));
      return undefined;
    }
    return value;
  }
  if (Array.isArray(value)) {
    const element = schema === undefined ? undefined : arrayElement(schema);
    return value.map((v: unknown, i) =>
      convertNumbers(v, element, [...path, i], issues, prefix, rule),
    );
  }
  if (isPlainObject(value)) {
    const shape = schema === undefined ? undefined : objectShape(schema);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = convertNumbers(v, shape?.[k], [...path, k], issues, prefix, rule);
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
