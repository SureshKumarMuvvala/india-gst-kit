import { describe, expect, it } from "vitest";
import { b2clThreshold } from "../src/index.js";
import { codes, mkDoc } from "./helpers.js";
import { buildGstr1 } from "../src/index.js";
import { FILER } from "./helpers.js";

describe("b2clThreshold", () => {
  it.each([
    ["072024", "250000.00"],
    ["082024", "100000.00"],
    ["122023", "250000.00"],
    ["092023", "250000.00"], // the year is compared before the month
    ["012025", "100000.00"],
    ["102026", "100000.00"],
  ])("%s → %s", (fp, expected) => {
    expect(b2clThreshold(fp)).toBe(expected);
  });
  it("rejects a malformed period", () => {
    expect(() => b2clThreshold("132025")).toThrow(RangeError);
  });
});

describe("period support", () => {
  const doc = mkDoc({ date: "2025-05-10" });
  const run = (period: string) => buildGstr1({ gstin: FILER, period, documents: [doc] });
  it("042025 is not supported", () => {
    const r = run("042025");
    expect(r.ok ? [] : r.issues.map((i) => i.code)).toContain("PERIOD_NOT_SUPPORTED");
  });
  it("052025 is accepted", () => {
    expect(run("052025").ok).toBe(true);
  });
  it("132025 is a schema error", () => {
    const r = run("132025");
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.issues.map((i) => i.code)).toContain("SCHEMA");
  });
  it("a period before 052025 is still reported once", () => {
    expect(codes([doc], { period: "032025" })).toContain("PERIOD_NOT_SUPPORTED");
  });
});
