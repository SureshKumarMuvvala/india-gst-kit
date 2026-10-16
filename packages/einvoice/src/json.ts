import { z } from "zod";
import {
  convertNumbers,
  getAt,
  parseJsonLossless,
  pathStartsWith,
  zodPath,
  type ZodIssue,
} from "./lossless.js";
import { IrnRequestSchema, TEXT_MESSAGE, type IrnRequest } from "./schema.js";
import { issue, hasErrors, type IrnIssue } from "./types.js";
import { arrayElement, isNumberLeaf, objectShape } from "./zod-walk.js";

export type IrnParseResult = { ok: boolean; value?: IrnRequest; issues: IrnIssue[] };

const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/** Writes `value` in the key order of `schema`, number leaves as raw literals. */
function write(value: unknown, schema: z.ZodType | undefined, path: (string | number)[]): string {
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
    return `[${value.map((v: unknown, i) => write(v, element, [...path, i])).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const shape = schema === undefined ? undefined : objectShape(schema);
    const known =
      shape === undefined ? [] : Object.keys(shape).filter((k) => record[k] !== undefined);
    // Keys the schema does not know are kept (after the known ones) so nothing is silently dropped.
    const extra = Object.keys(record).filter((k) => !known.includes(k) && record[k] !== undefined);
    return `{${[...known, ...extra]
      .map((k) => `${JSON.stringify(k)}:${write(record[k], shape?.[k], [...path, k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Compact JSON in the schema's key order. Amounts, quantities, rates and PINs are written as raw number
 * literals from their string form, never through `Number`.
 * @throws RangeError if a number leaf is not a valid JSON number literal (a programmer error).
 */
export function serializeIrnRequest(req: IrnRequest): string {
  return write(req, IrnRequestSchema, []);
}

const RULE_V3_START = /^[0/-]/;

/** Converts Zod issues to IrnIssues; unknown keys are errors for requests, warnings for decoded responses. */
export function toIrnIssues(
  zIssues: readonly ZodIssue[],
  input: unknown,
  options: {
    prefix?: (string | number)[];
    rule?: string;
    unknownKey?: "error" | "warning";
    request?: boolean;
  } = {},
): IrnIssue[] {
  const prefix = options.prefix ?? [];
  const base = options.rule ?? "S-SCHEMA";
  const out: IrnIssue[] = [];
  const seen = new Set<string>();
  const push = (i: IrnIssue) => {
    const key = `${i.rule}|${i.path.join(".")}|${i.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(i);
    }
  };
  for (const z1 of zIssues) {
    const path = zodPath(z1.path);
    const full = [...prefix, ...path];
    if (z1.code === "unrecognized_keys") {
      for (const key of z1.keys) {
        push(
          issue(
            [...full, key],
            "UNEXPECTED_KEY",
            "S-UNKNOWN-KEY",
            `unknown key "${key}"`,
            options.unknownKey ?? "error",
          ),
        );
      }
      continue;
    }
    if (options.request === true) {
      const joined = path.join(".");
      const raw = getAt(input, path);
      if (joined === "DocDtls.No" && typeof raw === "string" && RULE_V3_START.test(raw)) {
        push(issue(full, "RULE", "V3", "Document number must not start with 0, / or -"));
        continue;
      }
      if (joined === "ValDtls.RndOffAmt" && z1.message.startsWith("must be between")) {
        push(issue(full, "RULE", "V27", "RndOffAmt must be between -99.99 and 99.99"));
        continue;
      }
    }
    if (z1.message === TEXT_MESSAGE) {
      push(issue(full, "SCHEMA", "S-TEXT", z1.message));
      continue;
    }
    push(issue(full, "SCHEMA", base, z1.message));
  }
  return out;
}

/**
 * Parses IRN request JSON text. Numbers keep their exact source text (via `JSON.parse` reviver
 * `context.source`); a string where the schema expects a number is a type error, and so is the reverse.
 */
export function parseIrnRequestJson(text: string): IrnParseResult {
  let raw: unknown;
  try {
    raw = parseJsonLossless(text);
  } catch (e) {
    if (e instanceof SyntaxError) {
      return { ok: false, issues: [issue([], "BAD_JSON", "S-JSON", e.message)] };
    }
    throw e;
  }
  const typeIssues: IrnIssue[] = [];
  const converted = convertNumbers(raw, IrnRequestSchema, [], typeIssues);
  const parsed = IrnRequestSchema.safeParse(converted);
  const schemaIssues = parsed.success
    ? []
    : toIrnIssues(parsed.error.issues, converted, { request: true }).filter(
        (i) => !typeIssues.some((t) => pathStartsWith(i.path, t.path)),
      );
  const issues = [...typeIssues, ...schemaIssues];
  if (parsed.success && !hasErrors(issues)) return { ok: true, value: parsed.data, issues };
  return { ok: false, issues };
}
