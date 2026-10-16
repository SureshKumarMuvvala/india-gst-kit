import { fixtures, type FixtureName } from "@india-gst-kit/fixtures";
import { expect } from "vitest";
import { GstDocumentSchema, LineSchema, type GstDocumentInput } from "../src/index.js";

/** Mutable deep copy of a fixture, typed as document input. */
export function doc(name: FixtureName): GstDocumentInput {
  return structuredClone(fixtures[name]) as unknown as GstDocumentInput;
}

export function line(name: FixtureName, index = 0) {
  const lines = doc(name).lines;
  const l = lines[index];
  if (l === undefined) throw new Error(`fixture ${name} has no line ${index}`);
  return LineSchema.parse(l);
}

export function issuePaths(input: unknown): string[] {
  const r = GstDocumentSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
}

export function expectValid(input: unknown): void {
  const r = GstDocumentSchema.safeParse(input);
  expect(r.success ? [] : r.error.issues).toEqual([]);
}

export function expectIssueAt(input: unknown, path: string): void {
  expect(issuePaths(input)).toContain(path);
}
