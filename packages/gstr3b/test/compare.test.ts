import { describe, expect, it } from "vitest";
import { GSTINS, gstr3bAutoCalcFixture } from "@india-gst-kit/fixtures";
import {
  compareWithAutoCalc,
  outwardFromGstr1,
  parseAutoCalcJson,
  type AutoCalc,
  type Gstr3bDraft,
} from "../src/index.js";
import { codes, draftOf, gstr1 } from "./helpers.js";

type Obj = Record<string, unknown>;
const at = (o: unknown, path: string): Obj => {
  let cur = o;
  for (const k of path.split(".")) cur = (cur as Obj)[k];
  return cur as Obj;
};
function ac(mutate: (doc: Obj) => void = () => undefined): AutoCalc {
  const doc = structuredClone(gstr3bAutoCalcFixture) as unknown as Obj;
  mutate(doc);
  const r = parseAutoCalcJson(JSON.stringify(doc));
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
function ours(): Gstr3bDraft {
  const o = outwardFromGstr1(gstr1(), {
    recipientTypes: { [GSTINS.compositionDl]: "COMPOSITION" },
  });
  if (!o.ok) throw new Error("derivation failed");
  return draftOf({ outward: o.value, itcNet: "COMPUTE" });
}

describe("compareWithAutoCalc (spec §9.2, D-H8)", () => {
  it("an AC matching our own return diffs to all-zero, every compared row within tolerance", () => {
    const r = compareWithAutoCalc(ours().return, ac());
    expect(r.block).toBe("liabitc");
    expect(r.tolerance).toBe("0.00");
    expect(r.meta).toEqual({
      r1fildt: "2026-11-11",
      r2bgendt: "2026-11-14",
      r3bgendt: "2026-11-15",
    });
    expect(r.boxes.length).toBeGreaterThan(20);
    expect(r.boxes.filter((b) => b.withinTolerance !== true)).toEqual([]);
    expect(r.issues).toEqual([]);
  });

  it('tolerance: 0.50 is outside "0.00" and within "1.00"; |−1.00| ≤ 1.00 is inclusive', () => {
    const portal = ac((d) => {
      at(d, "r3bautopop.liabitc.sup_details.osup_3_1a.subtotal")["txval"] = 168299.5;
      at(d, "r3bautopop.liabitc.sup_details.osup_3_1b.subtotal")["iamt"] = 1054;
    });
    const row = (r: ReturnType<typeof compareWithAutoCalc>, box: string, field: string) =>
      r.boxes.find((b) => b.box === box && b.field === field);
    const exact = compareWithAutoCalc(ours().return, portal);
    expect(row(exact, "3.1a", "taxableValue")).toMatchObject({
      ours: "168300.00",
      portal: "168299.50",
      difference: "0.50",
      withinTolerance: false,
    });
    const loose = compareWithAutoCalc(ours().return, portal, { tolerance: "1.00" });
    expect(row(loose, "3.1a", "taxableValue")?.withinTolerance).toBe(true);
    expect(row(loose, "3.1b", "igst")).toMatchObject({
      difference: "-1.00",
      withinTolerance: true,
    });
  });

  it("3.2: a POS only on the portal is compared against 0.00 on our side", () => {
    const portal = ac((d) => {
      (at(d, "r3bautopop.liabitc.inter_sup.osup_unreg_3_2")["subtotal"] as Obj[]).push({
        pos: "29",
        txval: 10,
        iamt: 1.8,
      });
    });
    const r = compareWithAutoCalc(ours().return, portal);
    expect(r.boxes.filter((b) => b.box === "3.2unreg" && b.pos === "29")).toEqual([
      {
        box: "3.2unreg",
        pos: "29",
        field: "taxableValue",
        ours: "0.00",
        portal: "10.00",
        difference: "-10.00",
        withinTolerance: false,
      },
      {
        box: "3.2unreg",
        pos: "29",
        field: "igst",
        ours: "0.00",
        portal: "1.80",
        difference: "-1.80",
        withinTolerance: false,
      },
    ]);
  });

  it("a portal 3.2 row with POS 96 is POS_NOT_ACCEPTED (portal side) and not compared", () => {
    const portal = ac((d) => {
      (at(d, "r3bautopop.liabitc.inter_sup.osup_unreg_3_2")["subtotal"] as Obj[]).push({
        pos: "96",
        txval: 10,
        iamt: 0,
      });
    });
    const r = compareWithAutoCalc(ours().return, portal);
    expect(codes(r.issues)).toEqual(["POS_NOT_ACCEPTED"]);
    expect(r.boxes.some((b) => b.pos === "96")).toBe(false);
  });

  it("ITC: without confirmItcMapping the four pairings are MAPPING_UNCONFIRMED; with it they are compared; 4B2/4D2 never", () => {
    const off = compareWithAutoCalc(ours().return, ac());
    expect(
      off.uncompared
        .filter((u) => u.reason === "MAPPING_UNCONFIRMED")
        .map((u) => u.box ?? u.portalPath),
    ).toEqual(["4A.IMPG", "4A.ISRC", "4A.ISD", "4A.OTH", "elgitc.itc4b2", "elgitc.itc4d2"]);
    expect(off.uncompared.find((u) => u.box === "4A.IMPG")?.portal).toEqual({
      igst: "0.00",
      cess: "0.00",
    });
    const on = compareWithAutoCalc(ours().return, ac(), { confirmItcMapping: true });
    expect(on.boxes.filter((b) => b.box === "4A.OTH").map((b) => b.field)).toEqual([
      "igst",
      "cgst",
      "sgst",
      "cess",
    ]);
    expect(on.boxes.find((b) => b.box === "4A.IMPG" && b.field === "cgst")?.portal).toBeNull();
    expect(on.uncompared.map((u) => u.portalPath ?? u.box)).toEqual(
      expect.arrayContaining([
        "elgitc.itc4b2",
        "elgitc.itc4d2",
        "4A.IMPS",
        "4B.RUL",
        "4C",
        "4D.RUL",
        "5.GST",
        "5.1",
      ]),
    );
    expect(on.uncompared.find((u) => u.box === "4A.IMPS")?.reason).toBe("NOT_AUTO_CALCULATED");
  });

  it("block: liabitcr1 is read when asked; a block missing from AC gives null portal values", () => {
    const portal = ac((d) => {
      at(d, "r3bautopop.liabitcr1.sup_details.osup_3_1c.subtotal")["txval"] = 5;
    });
    const r1 = compareWithAutoCalc(ours().return, portal, { block: "liabitcr1" });
    expect(r1.boxes.find((b) => b.box === "3.1c")).toMatchObject({
      portal: "5.00",
      difference: "-5.00",
    });
    const r1a = compareWithAutoCalc(ours().return, portal, { block: "liabitcr1a" });
    expect(r1a.boxes.find((b) => b.box === "3.1a")).toMatchObject({
      portal: null,
      difference: null,
      withinTolerance: null,
    });
  });

  it("portal errors are reported by the parser and the figures present are still compared", () => {
    const doc = structuredClone(gstr3bAutoCalcFixture) as unknown as Obj;
    at(doc, "r3bautopop")["error"] = [{ error_cd: "X1", error_desc: "synthetic" }];
    const p = parseAutoCalcJson(JSON.stringify(doc));
    expect(codes(p.issues)).toEqual(["PORTAL_ERRORS"]);
    if (!p.ok) throw new Error("should parse");
    expect(compareWithAutoCalc(ours().return, p.value).boxes.length).toBeGreaterThan(0);
  });

  it("detail: our tbl4a contribution is compared with AC det.tbl4a", () => {
    const draft = ours();
    const portal = ac((d) => {
      at(d, "r3bautopop.liabitc.sup_details.osup_3_1a")["det"] = {
        tbl4a: { txval: 3500, iamt: 540, camt: 45, samt: 45, csamt: 0 },
      };
    });
    const r = compareWithAutoCalc(draft.return, portal, { detail: true, trail: draft.trail });
    const t4a = r.detail?.find((x) => x.box === "3.1a" && x.acTable === "tbl4a");
    expect(t4a?.ours).toEqual({
      taxableValue: "3500.00",
      igst: "540.00",
      cgst: "45.00",
      sgst: "45.00",
      cess: "0.00",
    });
    expect(t4a?.portal).toEqual(t4a?.ours);
    expect(r.detail?.find((x) => x.acTable === "tbl5a" && x.box === "3.1a")?.portal).toBeNull();
  });

  it("never mutates our return", () => {
    const d = ours();
    const before = structuredClone(d.return);
    compareWithAutoCalc(
      d.return,
      ac((x) => (at(x, "r3bautopop.liabitc.sup_details.osup_3_1a.subtotal")["txval"] = 1)),
      { tolerance: "5.00" },
    );
    expect(d.return).toEqual(before);
  });

  it("rejects a malformed tolerance (programmer error)", () => {
    expect(() => compareWithAutoCalc(ours().return, ac(), { tolerance: "-1" })).toThrow(RangeError);
  });
});
