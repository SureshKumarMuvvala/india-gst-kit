import { z } from "zod";
import {
  arrayElement,
  convertNumbers,
  getAt,
  isNumberLeaf,
  objectShape,
  parseJsonLossless,
  pathStartsWith,
  zodPath,
  type ZodIssue,
} from "@india-gst-kit/model";
import {
  EMPTY_AS_ABSENT,
  EwbByIrnRequestSchema,
  EwbRequestSchema,
  type EwbByIrnRequest,
  type EwbRequest,
} from "./schema.js";
import { hasErrors, issue, type EwbIssue } from "./types.js";

export type EwbParseResult<T> = { ok: boolean; value?: T; issues: EwbIssue[] };

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
 * Compact JSON in the schema's key order. Number fields are written as raw number literals from their
 * string form, never through `Number`; `transDistance` stays a JSON string.
 * @throws RangeError if a number leaf is not a valid JSON number literal (a programmer error).
 */
export function serializeEwbRequest(req: EwbRequest): string {
  return write(req, EwbRequestSchema, []);
}

/** As {@link serializeEwbRequest}, for the EWB-by-IRN request. */
export function serializeEwbByIrnRequest(req: EwbByIrnRequest): string {
  return write(req, EwbByIrnRequestSchema, []);
}

/** Decision D-M4: optional string fields of H equal to `""` count as absent. Returns a copy. */
export function dropEmptyStrings(req: unknown): unknown {
  if (typeof req !== "object" || req === null || Array.isArray(req)) return req;
  const copy: Record<string, unknown> = { ...(req as Record<string, unknown>) };
  for (const key of EMPTY_AS_ABSENT) if (copy[key] === "") Reflect.deleteProperty(copy, key);
  return copy;
}

const isMissing = (input: unknown, path: (string | number)[]): boolean =>
  getAt(input, path) === undefined;

/** Stable rule id for a structural issue that a named rule also covers; `S-SCHEMA` otherwise. */
function ruleFor(path: (string | number)[], z1: ZodIssue, input: unknown): string {
  const last = String(path[path.length - 1] ?? "");
  const missing = isMissing(input, path);
  if (z1.code === "invalid_type" && missing && path.length > 1) {
    const parent = path[path.length - 2];
    if (parent === "DispDtls" || parent === "ExpShipDtls") return "V-B3";
  }
  if (last === "Distance" || last === "transDistance") return missing ? "V-B2" : "V-T8";
  if ((last === "transporterId" || last === "TransId") && z1.code === "invalid_format")
    return "V-T9";
  if (last === "supplyType" || last === "docType") return "V-G1";
  if (/decimal places/.test(z1.message)) return "V-G13";
  return "S-SCHEMA";
}

/** Converts Zod issues to EwbIssues; unknown keys are errors for requests, warnings for decoded responses. */
export function toEwbIssues(
  zIssues: readonly ZodIssue[],
  input: unknown,
  options: { prefix?: (string | number)[]; rule?: string; unknownKey?: "error" | "warning" } = {},
): EwbIssue[] {
  const prefix = options.prefix ?? [];
  const out: EwbIssue[] = [];
  const seen = new Set<string>();
  const push = (i: EwbIssue) => {
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
    const id = options.rule ?? ruleFor(path, z1, input);
    push(
      issue(
        full,
        id === "S-SCHEMA" || options.rule !== undefined ? "SCHEMA" : "RULE",
        id,
        z1.message,
      ),
    );
  }
  return out;
}

/** Converts a JSON-number/string mismatch into WRONG_TYPE issues. */
function typeIssues(raw: unknown, schema: z.ZodType): { converted: unknown; issues: EwbIssue[] } {
  const found: { path: (string | number)[]; message: string }[] = [];
  const converted = convertNumbers(raw, schema, [], found);
  return {
    converted,
    issues: found.map((f) => issue(f.path, "WRONG_TYPE", "S-TYPE", f.message)),
  };
}

function parseJson<S extends z.ZodType>(
  text: string,
  schema: S,
  prepare: (v: unknown) => unknown,
): EwbParseResult<z.output<S>> {
  let raw: unknown;
  try {
    raw = parseJsonLossless(text);
  } catch (e) {
    if (e instanceof SyntaxError) {
      return { ok: false, issues: [issue([], "BAD_JSON", "S-JSON", e.message)] };
    }
    throw e;
  }
  const { converted, issues: typed } = typeIssues(raw, schema);
  const prepared = prepare(converted);
  const parsed = schema.safeParse(prepared);
  const schemaIssues = parsed.success
    ? []
    : toEwbIssues(parsed.error.issues, prepared).filter(
        (i) => !typed.some((t) => pathStartsWith(i.path, t.path)),
      );
  const issues = [...typed, ...schemaIssues];
  if (parsed.success && !hasErrors(issues)) return { ok: true, value: parsed.data, issues };
  return { ok: false, issues };
}

/**
 * Parses Generate-EWB request JSON text (structure only; use `validateEwbRequest` for the rules). Numbers keep
 * their exact source text; a string where the schema expects a number is a type error, and so is the reverse.
 */
export function parseEwbRequestJson(text: string): EwbParseResult<EwbRequest> {
  return parseJson(text, EwbRequestSchema, dropEmptyStrings);
}

/** As {@link parseEwbRequestJson}, for the EWB-by-IRN request. */
export function parseEwbByIrnRequestJson(text: string): EwbParseResult<EwbByIrnRequest> {
  return parseJson(text, EwbByIrnRequestSchema, (v) => v);
}
