import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  STATE_CODES,
  isGstinStateCode,
  isPlaceOfSupplyCode,
  isStateCode,
  normaliseStateCode,
  stateCodeFromName,
  stateName,
} from "../src/index.js";

const csvPath = new URL("../../../sources/einvoice/master-codes/state-codes.csv", import.meta.url);
const csvRows = readFileSync(csvPath, "utf8")
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((r) => {
    const [code = "", name = ""] = r.split(",");
    return { code: code.padStart(2, "0"), name };
  });

describe("STATE_CODES", () => {
  it("matches source A exactly (count, codes, names), with codes zero-padded to 2 digits", () => {
    expect(STATE_CODES.length).toBe(csvRows.length);
    expect(STATE_CODES.map((s) => ({ ...s }))).toEqual(csvRows);
    for (const s of STATE_CODES) expect(s.code).toMatch(/^\d{2}$/);
  });
  it("has unique codes; the only duplicate name is OTHER COUNTRIES (96 and 99)", () => {
    const codes = STATE_CODES.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    const byName = Map.groupBy(STATE_CODES, (s) => s.name.toUpperCase());
    const dups = [...byName].filter(([, v]) => v.length > 1);
    expect(dups.map(([n, v]) => [n, v.map((s) => s.code)])).toEqual([
      ["OTHER COUNTRIES", ["96", "99"]],
    ]);
  });
  it("has no code 28 and keeps withdrawn 25 listed", () => {
    expect(isStateCode("28")).toBe(false);
    expect(isStateCode("25")).toBe(true);
  });
  it("every code round-trips via its name (99 resolves to 96)", () => {
    for (const s of STATE_CODES) {
      const back = stateCodeFromName(s.name);
      expect(back).toBe(s.code === "99" ? "96" : s.code);
    }
  });
});

describe("lookups", () => {
  it("stateName", () => {
    expect(stateName("29")).toBe("KARNATAKA");
    expect(stateName("97")).toBe("Other Territory");
    expect(stateName("28")).toBeUndefined();
    expect(stateName("1")).toBeUndefined(); // exact 2-digit form only; use normaliseStateCode
  });
  it("stateCodeFromName is case- and whitespace-insensitive", () => {
    expect(stateCodeFromName("  karnataka ")).toBe("29");
    expect(stateCodeFromName("Tamil   Nadu")).toBe("33");
    expect(stateCodeFromName("other territory")).toBe("97");
    expect(stateCodeFromName("Atlantis")).toBeUndefined();
    expect(stateCodeFromName("")).toBeUndefined();
  });
  it("normaliseStateCode pads single digits and rejects unknowns", () => {
    expect(normaliseStateCode("1")).toBe("01");
    expect(normaliseStateCode(" 7 ")).toBe("07");
    expect(normaliseStateCode("29")).toBe("29");
    expect(normaliseStateCode("28")).toBeUndefined();
    expect(normaliseStateCode("0")).toBeUndefined();
    expect(normaliseStateCode("abc")).toBeUndefined();
  });
  it("isStateCode is strict about the 2-digit form", () => {
    expect(isStateCode("01")).toBe(true);
    expect(isStateCode("1")).toBe(false);
    expect(isStateCode("00")).toBe(false);
  });
  it("withdrawn 25 is not a place of supply; 96/97/99 are", () => {
    expect(isPlaceOfSupplyCode("25")).toBe(false);
    for (const c of ["96", "97", "99", "29", "26"]) expect(isPlaceOfSupplyCode(c)).toBe(true);
    expect(isPlaceOfSupplyCode("28")).toBe(false);
  });
  it("96 and 99 (outside India) are not GSTIN state prefixes; 97 and 25 are", () => {
    expect(isGstinStateCode("96")).toBe(false);
    expect(isGstinStateCode("99")).toBe(false);
    expect(isGstinStateCode("97")).toBe(true);
    expect(isGstinStateCode("25")).toBe(true);
    expect(isGstinStateCode("29")).toBe(true);
    expect(isGstinStateCode("28")).toBe(false);
  });
});
