import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UQC_CODES, isUqcCode } from "../src/index.js";

const csvPath = new URL("../../../sources/einvoice/master-codes/uqc.csv", import.meta.url);
const rows = readFileSync(csvPath, "utf8")
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((r) => {
    const [code = "", description = ""] = r.split(",");
    return { code, description };
  });

describe("UQC_CODES", () => {
  it("matches source B exactly (45 codes)", () => {
    expect(UQC_CODES.length).toBe(45);
    expect(UQC_CODES.map((u) => ({ ...u }))).toEqual(rows);
  });
  it("has no duplicate codes", () => {
    expect(new Set(UQC_CODES.map((u) => u.code)).size).toBe(UQC_CODES.length);
  });
  it("isUqcCode", () => {
    expect(isUqcCode("NOS")).toBe(true);
    expect(isUqcCode("KGS")).toBe(true);
    expect(isUqcCode("nos")).toBe(false);
    expect(isUqcCode("XYZ")).toBe(false);
    expect(isUqcCode("")).toBe(false);
  });
});
