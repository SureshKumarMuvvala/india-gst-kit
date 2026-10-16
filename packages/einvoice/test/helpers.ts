import { fixtures, GSTINS, parties, type FixtureName } from "@india-gst-kit/fixtures";
import { parseGstDocument, type GstDocument } from "@india-gst-kit/model";
import { expect } from "vitest";
import { toIrnRequest, type IrnIssue, type IrnRequest } from "../src/index.js";

export { GSTINS, fixtures, parties };
export type { FixtureName };

type Obj = Record<string, unknown>;

export function parseDoc(input: unknown): GstDocument {
  const r = parseGstDocument(structuredClone(input));
  if (!r.success) throw new Error(`document does not parse: ${JSON.stringify(r.error.issues)}`);
  return r.data;
}

export function parsed(name: FixtureName): GstDocument {
  return parseDoc(fixtures[name]);
}

/** A fixture with some top-level fields replaced (deep-cloned first). */
export function variant(name: FixtureName, patch: Obj): GstDocument {
  return parseDoc({ ...structuredClone(fixtures[name]), ...patch });
}

export function mapDoc(doc: GstDocument): IrnRequest {
  const r = toIrnRequest(doc);
  if (!r.ok) throw new Error(`does not map: ${JSON.stringify(r.issues)}`);
  return r.value;
}

export function mapped(name: FixtureName): IrnRequest {
  return mapDoc(parsed(name));
}

/** Deep copy of `obj` with the value at `path` replaced; `undefined` deletes the key. */
export function mutate(obj: unknown, path: readonly (string | number)[], value: unknown): unknown {
  const copy = structuredClone(obj);
  let cur: unknown = copy;
  path.slice(0, -1).forEach((p) => {
    cur = (cur as Obj)[p];
  });
  const last = path[path.length - 1];
  if (last === undefined) throw new Error("empty path");
  if (value === undefined) {
    if (Array.isArray(cur)) cur.splice(Number(last), 1);
    else Reflect.deleteProperty(cur as Obj, last);
  } else {
    (cur as Obj)[last] = value;
  }
  return copy;
}

/** Copy of `obj` without the given keys. */
export function omit(obj: object, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
}

export type Edit = readonly [readonly (string | number)[], unknown];

export function edit(obj: unknown, edits: readonly Edit[]): unknown {
  return edits.reduce((acc, [path, value]) => mutate(acc, path, value), obj);
}

export function hits(issues: readonly IrnIssue[], rule: string): IrnIssue[] {
  return issues.filter((i) => i.rule === rule);
}

export function expectHit(
  issues: readonly IrnIssue[],
  rule: string,
  path: readonly (string | number)[],
  severity: "error" | "warning" = "error",
): void {
  const found = hits(issues, rule).filter((i) => i.path.join(".") === path.join("."));
  expect(
    found.map((i) => i.severity),
    `${rule} at ${path.join(".")} in ${JSON.stringify(issues.map((i) => `${i.rule}@${i.path.join(".")}`))}`,
  ).toContain(severity);
}
