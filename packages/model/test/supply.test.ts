import { describe, expect, it } from "vitest";
import { STATE_CODES, decideTaxSplit, usesUtgst, type SupplyCategory } from "../src/index.js";

describe("decideTaxSplit", () => {
  it("same state, DOMESTIC → INTRA (category defaults to DOMESTIC)", () => {
    expect(decideTaxSplit("29", "29")).toBe("INTRA");
    expect(decideTaxSplit("29", "29", "DOMESTIC")).toBe("INTRA");
  });
  it("different state → INTER", () => {
    expect(decideTaxSplit("29", "27")).toBe("INTER");
  });
  it.each<SupplyCategory>([
    "SEZ_WITH_PAYMENT",
    "SEZ_WITHOUT_PAYMENT",
    "EXPORT_WITH_PAYMENT",
    "EXPORT_WITHOUT_PAYMENT",
    "DEEMED_EXPORT",
  ])("same state + %s → INTER", (c) => {
    expect(decideTaxSplit("29", "29", c)).toBe("INTER");
    expect(decideTaxSplit("29", "27", c)).toBe("INTER");
  });
});

describe("usesUtgst (UTGST Act 2017 s.2(8) as enacted — UNVERIFIED, see spec §6.5)", () => {
  it("true for A&N, Lakshadweep, D&NH, D&D, Chandigarh, other territory", () => {
    for (const c of ["35", "31", "26", "25", "04", "97"] as const) expect(usesUtgst(c)).toBe(true);
  });
  it("false for states, Delhi, Puducherry, J&K and Ladakh (amendments not retrieved)", () => {
    const utgst = new Set(["35", "31", "26", "25", "04", "97"]);
    for (const s of STATE_CODES) {
      if (!utgst.has(s.code)) expect(usesUtgst(s.code)).toBe(false);
    }
    for (const c of ["07", "34", "01", "38"] as const) expect(usesUtgst(c)).toBe(false);
  });
});
