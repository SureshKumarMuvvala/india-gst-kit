import { describe, expect, it } from "vitest";
import { rupeeTolerance, validateIrnRequest, withinTolerance } from "../src/index.js";
import { edit, expectHit, hits, mapped } from "./helpers.js";

describe("rupeeTolerance", () => {
  it("reproduces the three examples in the source", () => {
    expect(rupeeTolerance("2345.04")).toEqual({ min: "2344.00", max: "2347.00" });
    expect(rupeeTolerance("10241.00")).toEqual({ min: "10240.00", max: "10242.00" });
    expect(rupeeTolerance("10241.61")).toEqual({ min: "10240.00", max: "10243.00" });
  });
  it("uses floor/ceil for zero and negative values (UNVERIFIED)", () => {
    expect(rupeeTolerance("0")).toEqual({ min: "-1.00", max: "1.00" });
    expect(rupeeTolerance("-0.50")).toEqual({ min: "-2.00", max: "1.00" });
    expect(rupeeTolerance("-1.50")).toEqual({ min: "-3.00", max: "0.00" });
  });
  it("never rounds the calculated value first", () => {
    expect(rupeeTolerance("100.999999")).toEqual({ min: "99.00", max: "102.00" });
    expect(rupeeTolerance("1000000000000.005")).toEqual({
      min: "999999999999.00",
      max: "1000000000002.00",
    });
  });
});

describe("withinTolerance", () => {
  it("is inclusive at both ends and strict one paisa outside", () => {
    expect(withinTolerance("2344.00", "2345.04")).toBe(true);
    expect(withinTolerance("2347.00", "2345.04")).toBe(true);
    expect(withinTolerance("2343.99", "2345.04")).toBe(false);
    expect(withinTolerance("2347.01", "2345.04")).toBe(false);
    expect(withinTolerance("2345.04", "2345.04")).toBe(true);
  });
  it("compares as decimals (10240 == 10240.00)", () => {
    expect(withinTolerance("10240", "10241.00")).toBe(true);
    expect(withinTolerance("10242.0", "10241.00")).toBe(true);
  });
});

describe("tolerance in the rules", () => {
  it("V22 boundaries: calculated 162.00 accepts 161.00 and 163.00, rejects 160.99 and 163.01", () => {
    const base = mapped("interInvoice");
    const at = (v: string) =>
      validateIrnRequest(edit(base, [[["ItemList", 0, "IgstAmt"], v]])).issues;
    expect(hits(at("161.00"), "V22")).toEqual([]);
    expect(hits(at("163.00"), "V22")).toEqual([]);
    expectHit(at("160.99"), "V22", ["ItemList", 0, "IgstAmt"]);
    expectHit(at("163.01"), "V22", ["ItemList", 0, "IgstAmt"]);
  });

  it("CRN/DBN skip the rate checks V21–V24 (but not V20/V25)", () => {
    for (const name of ["creditNote", "debitNote"] as const) {
      const base = mapped(name);
      const r = validateIrnRequest(
        edit(base, [
          [["ItemList", 0, "CgstAmt"], "50.00"],
          [["ItemList", 0, "IgstAmt"], "50.00"],
          [["ItemList", 0, "SgstAmt"], "50.00"],
          [["ItemList", 0, "CesAmt"], "50.00"],
          [["ItemList", 0, "StateCesAmt"], "50.00"],
        ]),
      );
      for (const rule of ["V21", "V22", "V23", "V24"])
        expect(hits(r.issues, rule), `${name} ${rule}`).toEqual([]);
      expectHit(r.issues, "V25", ["ItemList", 0, "TotItemVal"]);
    }
    const inv = validateIrnRequest(
      edit(mapped("interInvoice"), [[["ItemList", 0, "IgstAmt"], "50.00"]]),
    );
    expectHit(inv.issues, "V22", ["ItemList", 0, "IgstAmt"]);
  });

  it("EXPWOP with IGST 0 skips V22; with a non-zero wrong IGST it does not", () => {
    const base = mapped("exportWithoutPayment");
    expect(hits(validateIrnRequest(base).issues, "V22")).toEqual([]);
    const wrong = validateIrnRequest(edit(base, [[["ItemList", 0, "IgstAmt"], "5.00"]]));
    expectHit(wrong.issues, "V22", ["ItemList", 0, "IgstAmt"]);
    const sez = mapped("sezWithoutPayment");
    expect(hits(validateIrnRequest(sez).issues, "V22")).toEqual([]);
  });

  it("an INTER supply with a rate but zero IGST is a V22 failure for ordinary B2B", () => {
    const r = validateIrnRequest(
      edit(mapped("interInvoice"), [[["ItemList", 0, "IgstAmt"], "0.00"]]),
    );
    expectHit(r.issues, "V22", ["ItemList", 0, "IgstAmt"]);
  });

  describe("RCM / EXPWP item total may include or exclude the tax (D-Q4)", () => {
    // item 0 of interInvoice: AssAmt 900.00, IGST 162.00, total 1062.00 → without tax 900.00
    const rcm = (total: string) =>
      validateIrnRequest(
        edit(mapped("interInvoice"), [
          [["TranDtls", "RegRev"], "Y"],
          [["ItemList", 0, "TotItemVal"], total],
        ]),
      ).issues;
    it("accepts the total with tax and without tax, rejects anything else", () => {
      expect(hits(rcm("1062.00"), "V25")).toEqual([]);
      expect(hits(rcm("900.00"), "V25")).toEqual([]);
      expectHit(rcm("1000.00"), "V25", ["ItemList", 0, "TotItemVal"]);
    });
    it("a non-RCM invoice must include the tax", () => {
      const r = validateIrnRequest(
        edit(mapped("interInvoice"), [[["ItemList", 0, "TotItemVal"], "900.00"]]),
      );
      expectHit(r.issues, "V25", ["ItemList", 0, "TotItemVal"]);
    });
    it("EXPWP behaves like RCM", () => {
      const r = validateIrnRequest(
        edit(mapped("exportWithoutPayment"), [
          [["TranDtls", "SupTyp"], "EXPWP"],
          [["ItemList", 0, "IgstAmt"], "180.00"],
          [["ItemList", 0, "TotItemVal"], "1000.00"],
          [["ValDtls", "IgstVal"], "180.00"],
        ]),
      );
      expect(hits(r.issues, "V25")).toEqual([]);
    });
    it("'without tax' keeps OthChrg", () => {
      const r = validateIrnRequest(
        edit(mapped("interInvoice"), [
          [["TranDtls", "RegRev"], "Y"],
          [["ItemList", 0, "OthChrg"], "50.00"],
          [["ItemList", 0, "TotItemVal"], "950.00"],
        ]),
      );
      expect(hits(r.issues, "V25")).toEqual([]);
    });
  });

  it("the withdrawn check TotAmt ≈ Qty × UnitPrice is not applied", () => {
    const r = validateIrnRequest(
      edit(mapped("intraInvoice"), [[["ItemList", 0, "UnitPrice"], "7.00"]]),
    );
    expect(r.issues).toEqual([]);
  });

  it("absent optional amounts count as 0", () => {
    const base = mapped("zeroRateInvoice");
    const stripped = edit(base, [
      [["ItemList", 0, "CesRt"], undefined],
      [["ItemList", 0, "CesAmt"], undefined],
      [["ItemList", 0, "CesNonAdvlAmt"], undefined],
      [["ItemList", 0, "StateCesRt"], undefined],
      [["ItemList", 0, "StateCesAmt"], undefined],
      [["ItemList", 0, "StateCesNonAdvlAmt"], undefined],
      [["ItemList", 0, "OthChrg"], undefined],
      [["ItemList", 0, "Discount"], undefined],
      [["ValDtls", "CgstVal"], undefined],
      [["ValDtls", "CesVal"], undefined],
      [["ValDtls", "StCesVal"], undefined],
      [["ValDtls", "Discount"], undefined],
      [["ValDtls", "OthChrg"], undefined],
    ]);
    expect(validateIrnRequest(stripped).issues).toEqual([]);
  });
});
