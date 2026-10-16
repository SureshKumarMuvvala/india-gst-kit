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
  ])("same state + %s → INTER (SEZ and exports are always inter-state)", (c) => {
    expect(decideTaxSplit("29", "29", c)).toBe("INTER");
    expect(decideTaxSplit("29", "27", c)).toBe("INTER");
  });
  it("DEEMED_EXPORT follows the states like DOMESTIC (not listed as always inter-state)", () => {
    expect(decideTaxSplit("29", "29", "DEEMED_EXPORT")).toBe("INTRA");
    expect(decideTaxSplit("29", "27", "DEEMED_EXPORT")).toBe("INTER");
  });
});

describe("usesUtgst (UTGST Act 2017 s.2(8) as enacted — UNVERIFIED, see spec §6.5)", () => {
  it("true for A&N, Lakshadweep, D&NH, D&D, Chandigarh, other territory", () => {
    for (const c of ["35", "31", "26", "25", "04", "97"] as const) expect(usesUtgst(c)).toBe(true);
  });
  it("false for states, Delhi, Puducherry and J&K", () => {
    const notFalse = new Set(["35", "31", "26", "25", "04", "97", "38"]);
    for (const s of STATE_CODES) {
      if (!notFalse.has(s.code)) expect(usesUtgst(s.code)).toBe(false);
    }
    for (const c of ["07", "34", "01"] as const) expect(usesUtgst(c)).toBe(false);
  });
  it('"unknown" for Ladakh (38): the amending law was not retrieved, so never silently wrong', () => {
    expect(usesUtgst("38")).toBe("unknown");
  });
});
