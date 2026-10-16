import { describe, expect, it } from "vitest";
import { computeLineTax, money, sumMoney } from "../src/index.js";

describe("money()", () => {
  it("rounds half-up to 2 dp at the .005 boundary", () => {
    expect(money("0.005")).toBe("0.01");
    expect(money("0.0049")).toBe("0.00");
    expect(money("1.005")).toBe("1.01"); // would be 1.00 with binary floats
    expect(money(2.675)).toBe("2.68");
    expect(money("0.004")).toBe("0.00");
  });
  it("formats exactly 2 dp", () => {
    expect(money(0)).toBe("0.00");
    expect(money("12.5")).toBe("12.50");
    expect(money("999999999999999")).toBe("999999999999999.00");
  });
  it("throws on negative, NaN and non-finite input", () => {
    expect(() => money("-0.01")).toThrow();
    expect(() => money(Number.NaN)).toThrow();
    expect(() => money("abc")).toThrow();
    expect(() => money(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("sumMoney()", () => {
  it("sums exactly over many lines (no float drift)", () => {
    const xs = Array.from({ length: 1000 }, () => "0.10");
    expect(sumMoney(xs)).toBe("100.00");
    expect(sumMoney([])).toBe("0.00");
    expect(sumMoney(["999999999999.99", "0.01"])).toBe("1000000000000.00");
  });
});

describe("computeLineTax()", () => {
  it("INTER: igst = round2(taxable × rate / 100), cgst = sgst = 0", () => {
    expect(computeLineTax("100.10", "5", "INTER")).toEqual({
      cgst: "0.00",
      sgst: "0.00",
      igst: "5.01",
    });
    expect(computeLineTax("1000.00", "18", "INTER")).toEqual({
      cgst: "0.00",
      sgst: "0.00",
      igst: "180.00",
    });
  });
  it("INTRA remainder-to-sgst (default): 100.10 @ 5 % → T 5.01, cgst 2.51, sgst 2.50", () => {
    const expected = { cgst: "2.51", sgst: "2.50", igst: "0.00" };
    expect(computeLineTax("100.10", "5", "INTRA")).toEqual(expected);
    expect(computeLineTax("100.10", "5", "INTRA", { convention: "remainder-to-sgst" })).toEqual(
      expected,
    );
  });
  it("INTRA equal-halves: 100.10 @ 5 % → 2.50 / 2.50 (sum 5.00)", () => {
    expect(computeLineTax("100.10", "5", "INTRA", { convention: "equal-halves" })).toEqual({
      cgst: "2.50",
      sgst: "2.50",
      igst: "0.00",
    });
  });
  it("even-paisa case is identical under both conventions", () => {
    const a = computeLineTax("1000.00", "18", "INTRA");
    const b = computeLineTax("1000.00", "18", "INTRA", { convention: "equal-halves" });
    expect(a).toEqual({ cgst: "90.00", sgst: "90.00", igst: "0.00" });
    expect(b).toEqual(a);
  });
  it("handles fractional rates and zero", () => {
    expect(computeLineTax("1000.00", "2.5", "INTER").igst).toBe("25.00");
    expect(computeLineTax("100.00", "0.25", "INTER").igst).toBe("0.25");
    expect(computeLineTax("0.00", "18", "INTRA")).toEqual({
      cgst: "0.00",
      sgst: "0.00",
      igst: "0.00",
    });
    expect(computeLineTax("100.00", "0", "INTRA")).toEqual({
      cgst: "0.00",
      sgst: "0.00",
      igst: "0.00",
    });
  });
  it("handles very large values without overflow", () => {
    expect(computeLineTax("999999999999999.99", "28", "INTER").igst).toBe("280000000000000.00");
  });
});
