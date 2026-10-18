import { describe, expect, it } from "vitest";
import { GSTINS } from "@india-gst-kit/fixtures";
import { isValidGstin } from "@india-gst-kit/model";
import { validateGstr3b } from "../src/index.js";
import { emptyFor } from "./schema-helpers.js";
import { codes } from "./helpers.js";

describe("validateGstr3b (spec §7)", () => {
  it.each(["102026", "011900", "122099"])("period %s passes", (p) => {
    expect(validateGstr3b({ ...emptyFor(), period: p })).toEqual([]);
  });
  it.each(["132026", "002026", "10226", "102126", "1020266", "102026 "])(
    "period %j is PERIOD_FORMAT",
    (p) => {
      expect(codes(validateGstr3b({ ...emptyFor(), period: p }))).toEqual(["PERIOD_FORMAT"]);
    },
  );

  it("a model-valid, PAN-structured GSTIN passes", () => {
    expect(validateGstr3b({ ...emptyFor(), gstin: GSTINS.recipientMh })).toEqual([]);
  });
  it("a model-valid GSTIN outside SV's PAN pattern is GSTIN_NOT_ACCEPTED_BY_3B (D-H4)", () => {
    expect(isValidGstin(GSTINS.notPanStructuredKa)).toBe(true);
    expect(codes(validateGstr3b({ ...emptyFor(), gstin: GSTINS.notPanStructuredKa }))).toEqual([
      "GSTIN_NOT_ACCEPTED_BY_3B",
    ]);
  });
  it("a bad check digit and a lower-case GSTIN are GSTIN_INVALID (the model)", () => {
    const badDigit = `${GSTINS.supplierKa.slice(0, 14)}${GSTINS.supplierKa.endsWith("A") ? "B" : "A"}`;
    expect(codes(validateGstr3b({ ...emptyFor(), gstin: badDigit }))).toEqual(["GSTIN_INVALID"]);
    expect(
      codes(validateGstr3b({ ...emptyFor(), gstin: GSTINS.supplierKa.toLowerCase() })),
    ).toEqual(["GSTIN_INVALID"]);
  });

  const withPos = (pos: string) => {
    const r = emptyFor();
    r.t31.a.taxableValue = "100.00";
    r.t31.a.igst = "18.00";
    r.t32.unregistered.push({ pos, taxableValue: "1.00", igst: "0.18" });
    return r;
  };
  it.each(["29", "97", "01", "38"])("POS %s passes", (p) => {
    expect(validateGstr3b(withPos(p))).toEqual([]);
  });
  it.each(["96", "99", "00", "39", "7", "AB"])("POS %s is POS_NOT_ACCEPTED", (p) => {
    expect(codes(validateGstr3b(withPos(p)))).toEqual(["POS_NOT_ACCEPTED"]);
  });
  it.each(["25", "28"])("POS %s is POS_UNKNOWN (SV accepts it, the model does not; D-H5)", (p) => {
    expect(codes(validateGstr3b(withPos(p)))).toEqual(["POS_UNKNOWN"]);
  });
  it("a duplicate POS in one list is DUPLICATE_POS", () => {
    const r = withPos("27");
    r.t32.unregistered.push({ pos: "27", taxableValue: "1.00", igst: "0.18" });
    expect(codes(validateGstr3b(r))).toEqual(["DUPLICATE_POS"]);
  });

  it("CGST ≠ SGST in 3.1a gives no issue (not checked: no source, Q-H10)", () => {
    const r = emptyFor();
    r.t31.a.cgst = "10.00";
    r.t31.a.sgst = "11.00";
    expect(validateGstr3b(r)).toEqual([]);
  });

  it("V11: Σ3.2 above 3.1a is the warning T32_EXCEEDS_31A (FG-3B: 3.2 is of the supplies in 3.1 (a))", () => {
    const r = emptyFor();
    r.t32.composition.push({ pos: "07", taxableValue: "10.00", igst: "1.80" });
    const issues = validateGstr3b(r);
    expect(issues.map((i) => [i.code, i.severity])).toEqual([
      ["T32_EXCEEDS_31A", "warning"],
      ["T32_EXCEEDS_31A", "warning"],
    ]);
  });

  it("V8: 4C differing from 4A − 4B is the warning ITC_NET_DIFFERS", () => {
    const r = emptyFor();
    r.t4.available.OTH.igst = "10.00";
    expect(validateGstr3b(r).map((i) => [i.code, i.severity])).toEqual([
      ["ITC_NET_DIFFERS", "warning"],
    ]);
  });

  it("never throws on junk input", () => {
    expect(codes(validateGstr3b(null))).toEqual(["SCHEMA"]);
    expect(codes(validateGstr3b({ return: 1, trail: [] }))).toEqual(["SCHEMA"]);
  });
});
