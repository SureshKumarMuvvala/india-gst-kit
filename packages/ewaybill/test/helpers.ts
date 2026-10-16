import { fixtures, GSTINS, parties, type FixtureName } from "@india-gst-kit/fixtures";
import { parseGstDocument, type GstDocument } from "@india-gst-kit/model";
import { expect } from "vitest";
import {
  toEwbRequest,
  type EwbIssue,
  type EwbMovementInput,
  type EwbRequest,
} from "../src/index.js";

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

/** A valid road movement; fields can be replaced or (with `undefined`) removed. */
export function movement(patch: Obj = {}): EwbMovementInput {
  const transport: Obj = {
    distanceKm: "150",
    mode: "ROAD",
    vehicleNo: "KA01AB1234",
    vehicleType: "REGULAR",
    ...patch,
  };
  const defined = Object.fromEntries(Object.entries(transport).filter(([, v]) => v !== undefined));
  return { transport: defined } as EwbMovementInput;
}

export const portAddress = {
  line1: "Container Freight Station",
  city: "Chennai",
  pincode: "600001",
  stateCode: "33",
};

export function mapDoc(doc: GstDocument, mv: EwbMovementInput = movement()): EwbRequest {
  const r = toEwbRequest(doc, mv);
  if (!r.ok) throw new Error(`does not map: ${JSON.stringify(r.issues)}`);
  return r.value;
}

export function mapped(name: FixtureName, mv: EwbMovementInput = movement()): EwbRequest {
  return mapDoc(parsed(name), mv);
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

export type Edit = readonly [readonly (string | number)[], unknown];

export function edit(obj: unknown, edits: readonly Edit[]): unknown {
  return edits.reduce((acc, [path, value]) => mutate(acc, path, value), obj);
}

export function hits(issues: readonly EwbIssue[], rule: string): EwbIssue[] {
  return issues.filter((i) => i.rule === rule);
}

export function expectHit(
  issues: readonly EwbIssue[],
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

export function expectNoHit(issues: readonly EwbIssue[], rule: string): void {
  expect(hits(issues, rule), `${rule} should not fire`).toEqual([]);
}

/** `value`, or a failure with a clear message: the test equivalent of a non-null assertion. */
export function must<T>(value: T | undefined, what = "value"): T {
  if (value === undefined) throw new Error(`${what} is undefined`);
  return value;
}
