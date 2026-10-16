import { describe, expect, it } from "vitest";
import { looseDocNumber, normaliseDocNumber } from "../src/index.js";

describe("normaliseDocNumber", () => {
  it("trims, upper-cases and collapses whitespace", () => {
    expect(normaliseDocNumber("  inv/ 001  ")).toBe("INV/ 001");
  });
  it("collapses tabs, newlines and Unicode whitespace to one space", () => {
    expect(normaliseDocNumber("a\t\n b")).toBe("A B");
    expect(normaliseDocNumber("a  b")).toBe("A B");
  });
  it("keeps punctuation, so INV-1 and INV/1 differ", () => {
    expect(normaliseDocNumber("INV-1")).toBe("INV-1");
    expect(normaliseDocNumber("INV-1")).not.toBe(normaliseDocNumber("INV/1"));
  });
  it("keeps leading zeros, so INV/001 and INV/1 differ", () => {
    expect(normaliseDocNumber("INV/001")).not.toBe(normaliseDocNumber("INV/1"));
  });
});

describe("looseDocNumber", () => {
  it.each([
    ["INV/0012-A", "INV12A"],
    ["INV-1", "INV1"],
    ["INV/1", "INV1"],
    ["inv1", "INV1"],
    ["inv 12a", "INV12A"],
    ["2026/007", "20267"],
    ["000", "0"],
    ["A00B", "A0B"],
    ["0", "0"],
    ["INV/2026-27/0001", "INV2026271"],
  ])("%s → %s", (input, expected) => {
    expect(looseDocNumber(input)).toBe(expected);
  });

  it("makes INV-1, INV/1 and inv1 equal", () => {
    expect(new Set(["INV-1", "INV/1", "inv1"].map(looseDocNumber)).size).toBe(1);
  });
  it("makes INV/001 and INV-1 equal but their normalised forms differ", () => {
    expect(looseDocNumber("INV/001")).toBe(looseDocNumber("INV-1"));
    expect(normaliseDocNumber("INV/001")).not.toBe(normaliseDocNumber("INV-1"));
  });
});
