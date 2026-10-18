import { describe, expect, it } from "vitest";
import { GSTINS } from "@india-gst-kit/fixtures";
import {
  assembleGstr3b,
  outwardFromGstr1,
  validateGstr3b,
  type Gstr3bDraft,
} from "../src/index.js";
import { emptyReturn } from "../src/boxes.js";
import { FILER, PERIOD, codes, draftOf, gstr1 } from "./helpers.js";

const h4 = (igst: string, cgst = "0.00", sgst = "0.00", cess = "0.00") => ({
  igst,
  cgst,
  sgst,
  cess,
});

describe("assembleGstr3b / trail (spec §6, §3.3)", () => {
  it("every box equals Σ trail; a hand-edited return gives TRAIL_MISMATCH", () => {
    const d = draftOf({
      entries: [{ box: "3.1c", label: "nil per books", amounts: { taxableValue: "50.00" } }],
    });
    expect(validateGstr3b(d)).toEqual([]);
    const edited: Gstr3bDraft = structuredClone(d);
    edited.return.t31.c.taxableValue = "51.00";
    expect(codes(validateGstr3b(edited))).toEqual(["TRAIL_MISMATCH"]);
  });

  it("a caller entry without a label is CALLER_LABEL_MISSING", () => {
    const r = assembleGstr3b({
      gstin: FILER,
      period: PERIOD,
      entries: [{ box: "5.1", label: " ", amounts: { igst: "1.00" } }],
    });
    expect(r.ok ? [] : codes(r.issues)).toEqual(["CALLER_LABEL_MISSING"]);
  });

  it("a cgst on 3.1b is FIELD_NOT_IN_BOX", () => {
    const r = assembleGstr3b({
      gstin: FILER,
      period: PERIOD,
      entries: [{ box: "3.1b", label: "x", amounts: { cgst: "1.00" } }],
    });
    expect(r.ok ? [] : codes(r.issues)).toEqual(["FIELD_NOT_IN_BOX"]);
  });

  it("two caller entries for one box are summed and both stay in the trail", () => {
    const d = draftOf({
      entries: [
        { box: "4B.RUL", label: "rule 42 working", amounts: { igst: "10.00" } },
        { box: "4B.RUL", label: "rule 43 working", amounts: { igst: "5.50" } },
      ],
      itcNet: "COMPUTE",
    });
    expect(d.return.t4.reversed.RUL.igst).toBe("15.50");
    expect(d.trail.filter((e) => e.box === "4B.RUL").map((e) => e.ref)).toEqual([
      "rule 42 working",
      "rule 43 working",
    ]);
  });

  it("3.2 rows are aggregated per POS, sorted, and zero rows dropped", () => {
    const d = draftOf({
      entries: [
        {
          box: "3.2unreg",
          label: "a",
          pos: "33",
          amounts: { taxableValue: "10.00", igst: "1.80" },
        },
        { box: "3.2unreg", label: "b", pos: "27", amounts: { taxableValue: "5.00", igst: "0.90" } },
        { box: "3.2unreg", label: "c", pos: "33", amounts: { taxableValue: "2.00", igst: "0.36" } },
        { box: "3.2unreg", label: "d", pos: "29", amounts: { taxableValue: "1.00", igst: "0.18" } },
        {
          box: "3.2unreg",
          label: "e",
          pos: "29",
          amounts: { taxableValue: "-1.00", igst: "-0.18" },
        },
        { box: "3.1a", label: "outward", amounts: { taxableValue: "100.00", igst: "18.00" } },
      ],
    });
    expect(d.return.t32.unregistered).toEqual([
      { pos: "27", taxableValue: "5.00", igst: "0.90" },
      { pos: "33", taxableValue: "12.00", igst: "2.16" },
    ]);
    expect(validateGstr3b(d)).toEqual([]);
  });

  it("3.2 entries need a pos; other boxes take none", () => {
    const a = assembleGstr3b({
      gstin: FILER,
      period: PERIOD,
      entries: [{ box: "3.2comp", label: "x", amounts: { igst: "1.00" } }],
    });
    expect(a.ok ? [] : codes(a.issues)).toEqual(["SCHEMA"]);
    const b = assembleGstr3b({
      gstin: FILER,
      period: PERIOD,
      entries: [{ box: "3.1a", label: "x", pos: "27", amounts: { igst: "1.00" } }],
    });
    expect(b.ok ? [] : codes(b.issues)).toEqual(["SCHEMA"]);
  });

  it('itcNet "COMPUTE" gives Σ4A − Σ4B per head as a COMPUTED entry', () => {
    const d = draftOf({
      entries: [
        { box: "4A.IMPG", label: "BoE", amounts: h4("100.00") },
        { box: "4A.OTH", label: "2B Y", amounts: h4("50.00", "20.00", "20.00", "1.00") },
        { box: "4B.OTH", label: "CA", amounts: h4("30.00", "25.00", "0.00", "0.00") },
      ],
      itcNet: "COMPUTE",
    });
    expect(d.return.t4.net).toEqual({ igst: "120.00", cgst: "-5.00", sgst: "20.00", cess: "1.00" });
    expect(d.trail.find((e) => e.box === "4C")?.source).toBe("COMPUTED");
  });

  it("a supplied 4C that differs is kept as supplied and gives the warning ITC_NET_DIFFERS", () => {
    const r = assembleGstr3b({
      gstin: FILER,
      period: PERIOD,
      entries: [{ box: "4A.OTH", label: "2B", amounts: h4("50.00") }],
      itcNet: { label: "per CA", amounts: h4("49.00") },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.return.t4.net.igst).toBe("49.00");
      expect(r.issues.map((i) => [i.code, i.severity])).toEqual([["ITC_NET_DIFFERS", "warning"]]);
    }
  });

  it("boxes the package never fills stay zero without caller entries, even with a full gstr1 derivation", () => {
    const o = outwardFromGstr1(gstr1(), {
      recipientTypes: { [GSTINS.compositionDl]: "COMPOSITION" },
    });
    if (!o.ok) throw new Error("derivation failed");
    const d = draftOf({ outward: o.value, itcNet: "COMPUTE" });
    const zero = emptyReturn(FILER, PERIOD);
    expect(d.return.t31.c).toEqual(zero.t31.c);
    expect(d.return.t31.d).toEqual(zero.t31.d);
    expect(d.return.t31.e).toEqual(zero.t31.e);
    expect(d.return.t311).toEqual(zero.t311);
    expect(d.return.t4).toEqual(zero.t4);
    expect(d.return.t5).toEqual(zero.t5);
    expect(d.return.t51).toEqual(zero.t51);
    expect(new Set(d.trail.map((e) => e.source))).toEqual(new Set(["GSTR1", "COMPUTED"]));
  });

  it("a negative sum in an unsigned box is NEGATIVE_NOT_ALLOWED", () => {
    const r = assembleGstr3b({
      gstin: FILER,
      period: PERIOD,
      entries: [{ box: "5.GST", label: "x", amounts: { inter: "-1.00" } }],
    });
    expect(r.ok ? [] : codes(r.issues)).toEqual(["NEGATIVE_NOT_ALLOWED"]);
  });

  it("a malformed amount is AMOUNT_OUT_OF_RANGE", () => {
    const r = assembleGstr3b({
      gstin: FILER,
      period: PERIOD,
      entries: [{ box: "3.1c", label: "x", amounts: { taxableValue: "1.5" } }],
    });
    expect(r.ok ? [] : codes(r.issues)).toEqual(["AMOUNT_OUT_OF_RANGE"]);
  });
});
