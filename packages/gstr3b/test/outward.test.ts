import { describe, expect, it } from "vitest";
import { GSTINS, gstr3bExpectedOutward } from "@india-gst-kit/fixtures";
import {
  AC_GSTR1_MAP,
  AC_NOT_COVERED,
  outwardFromGstr1,
  type OutwardDerivation,
  type TrailEntry,
} from "../src/index.js";
import { codes, draftOf, gstr1, gstr1With, item, loadSource } from "./helpers.js";

function derive(...args: Parameters<typeof outwardFromGstr1>): OutwardDerivation {
  const r = outwardFromGstr1(...args);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
const strip = (e: TrailEntry) => ({ box: e.box, ref: e.ref, pos: e.pos, amounts: e.amounts });

const b2bInv = (over: Record<string, unknown>) => ({
  number: "X-1",
  date: "2026-10-01",
  value: "1180.00",
  pos: "27",
  reverseCharge: false,
  invoiceType: "R",
  items: [item("1000.00", { igst: "180.00" })],
  ...over,
});
const b2b = (ctin: string, inv: Record<string, unknown>) =>
  gstr1With({ b2b: [{ ctin, invoices: [b2bInv(inv)] }] } as never);
const cdnrNote = (over: Record<string, unknown>) => ({
  number: "N-1",
  date: "2026-10-01",
  value: "118.00",
  noteType: "C",
  pos: "27",
  reverseCharge: false,
  invoiceType: "R",
  items: [item("100.00", { igst: "18.00" })],
  ...over,
});

describe("outwardFromGstr1 — one test per mapping row (spec §4.1–4.2)", () => {
  it("G1: a regular B2B invoice → 3.1a tbl4a, all heads; no 3.2 for an ordinary recipient", () => {
    const d = derive(b2b(GSTINS.recipientMh, {}));
    expect(d.entries.map(strip)).toEqual([
      {
        box: "3.1a",
        ref: "tbl4a",
        pos: undefined,
        amounts: {
          taxableValue: "1000.00",
          igst: "180.00",
          cgst: "0.00",
          sgst: "0.00",
          cess: "0.00",
        },
      },
    ]);
    expect(d.entries[0]?.documents).toEqual([{ section: "b2b", number: "X-1" }]);
  });

  it("G1 + COMPOSITION → also 3.2comp tbl4a; + UIN_HOLDER → 3.2uin; never inferred from the GSTIN", () => {
    const comp = derive(b2b(GSTINS.compositionDl, { pos: "07" }), {
      recipientTypes: { [GSTINS.compositionDl]: "COMPOSITION" },
    });
    expect(comp.entries.map(strip)).toContainEqual({
      box: "3.2comp",
      ref: "tbl4a",
      pos: "07",
      amounts: { taxableValue: "1000.00", igst: "180.00" },
    });
    const uin = derive(b2b(GSTINS.recipientMh, {}), {
      recipientTypes: { [GSTINS.recipientMh]: "UIN_HOLDER" },
    });
    expect(uin.entries.map((e) => e.box)).toEqual(["3.1a", "3.2uin"]);
    expect(derive(b2b(GSTINS.compositionDl, { pos: "07" })).entries.map((e) => e.box)).toEqual([
      "3.1a",
    ]);
  });

  it("G2: an RCM regular invoice adds only its taxable value to 3.1a (tbl4b) and nothing to 3.2", () => {
    const d = derive(b2b(GSTINS.compositionDl, { reverseCharge: true }), {
      recipientTypes: { [GSTINS.compositionDl]: "COMPOSITION" },
    });
    expect(d.entries.map(strip)).toEqual([
      { box: "3.1a", ref: "tbl4b", pos: undefined, amounts: { taxableValue: "1000.00" } },
    ]);
  });

  it("G3: SEZ invoices (SEWP/SEWOP) → 3.1b tbl6b only; nothing in 3.1a or 3.2", () => {
    for (const t of ["SEWP", "SEWOP"]) {
      const d = derive(b2b(GSTINS.sezMh, { invoiceType: t }), {
        recipientTypes: { [GSTINS.sezMh]: "UIN_HOLDER" },
      });
      expect(d.entries.map(strip)).toEqual([
        {
          box: "3.1b",
          ref: "tbl6b",
          pos: undefined,
          amounts: { taxableValue: "1000.00", igst: "180.00", cess: "0.00" },
        },
      ]);
    }
  });

  it("G4: a deemed export → 3.1a tbl6c, all heads; never 3.2", () => {
    const d = derive(b2b(GSTINS.compositionDl, { invoiceType: "DE", pos: "07" }), {
      recipientTypes: { [GSTINS.compositionDl]: "COMPOSITION" },
    });
    expect(d.entries.map(strip)).toEqual([
      {
        box: "3.1a",
        ref: "tbl6c",
        pos: undefined,
        amounts: {
          taxableValue: "1000.00",
          igst: "180.00",
          cgst: "0.00",
          sgst: "0.00",
          cess: "0.00",
        },
      },
    ]);
  });

  it("G5: an RCM SEZ / deemed-export invoice is unmapped (RCM_NOT_MAPPED) and adds nothing", () => {
    for (const t of ["SEWP", "SEWOP", "DE"]) {
      const d = derive(b2b(GSTINS.sezMh, { invoiceType: t, reverseCharge: true }));
      expect(d.entries).toEqual([]);
      expect(d.unmapped.map((u) => u.issue.code)).toEqual(["RCM_NOT_MAPPED"]);
      expect(d.unmapped[0]?.issue.severity).toBe("warning");
    }
  });

  it("G6: a B2CL invoice → 3.1a tbl5a (txval, iamt, csamt) and 3.2unreg by POS", () => {
    const d = derive(
      gstr1With({
        b2cl: [
          {
            pos: "27",
            invoices: [
              {
                number: "L-1",
                date: "2026-10-01",
                value: "1180.00",
                items: [item("1000.00", { igst: "180.00" }, "5.00")],
              },
            ],
          },
        ],
      }),
    );
    expect(d.entries.map(strip)).toEqual([
      {
        box: "3.1a",
        ref: "tbl5a",
        pos: undefined,
        amounts: { taxableValue: "1000.00", igst: "180.00", cess: "5.00" },
      },
      {
        box: "3.2unreg",
        ref: "tbl5a",
        pos: "27",
        amounts: { taxableValue: "1000.00", igst: "180.00" },
      },
    ]);
  });

  it("G7: exports → 3.1b tbl6a only", () => {
    const d = derive(
      gstr1With({
        exp: [
          {
            exportType: "WOPAY",
            invoices: [
              {
                number: "E-1",
                date: "2026-10-01",
                value: "500.00",
                items: [{ rate: "0", taxableValue: "500.00", igst: "0.00", cess: "0.00" }],
              },
            ],
          },
        ],
      }),
    );
    expect(d.entries.map(strip)).toEqual([
      {
        box: "3.1b",
        ref: "tbl6a",
        pos: undefined,
        amounts: { taxableValue: "500.00", igst: "0.00", cess: "0.00" },
      },
    ]);
  });

  it("G8: an intra-State B2CS row → 3.1a tbl7a_1 (no IGST); G9: inter-State → 3.1a tbl7b_1 and 3.2unreg", () => {
    const d = derive(
      gstr1With({
        b2cs: [
          {
            supplyType: "INTRA",
            pos: "29",
            rate: "18",
            taxableValue: "100.00",
            cgst: "9.00",
            sgst: "9.00",
            cess: "0.00",
          },
          {
            supplyType: "INTER",
            pos: "33",
            rate: "18",
            taxableValue: "200.00",
            igst: "36.00",
            cess: "1.00",
          },
        ],
      }),
    );
    expect(d.entries.map(strip)).toEqual([
      {
        box: "3.1a",
        ref: "tbl7a_1",
        pos: undefined,
        amounts: { taxableValue: "100.00", cgst: "9.00", sgst: "9.00", cess: "0.00" },
      },
      {
        box: "3.1a",
        ref: "tbl7b_1",
        pos: undefined,
        amounts: { taxableValue: "200.00", igst: "36.00", cess: "1.00" },
      },
      {
        box: "3.2unreg",
        ref: "tbl7b_1",
        pos: "33",
        amounts: { taxableValue: "200.00", igst: "36.00" },
      },
    ]);
  });

  it("G10 signs: a credit note subtracts, a debit note adds, in 3.1a and 3.2 (FG-3B Instruction 1)", () => {
    const g = gstr1With({
      cdnr: [
        {
          ctin: GSTINS.compositionDl,
          notes: [
            cdnrNote({ pos: "07" }),
            cdnrNote({
              number: "N-2",
              noteType: "D",
              pos: "07",
              items: [item("40.00", { igst: "7.20" })],
            }),
          ],
        },
      ],
    } as never);
    const d = derive(g, { recipientTypes: { [GSTINS.compositionDl]: "COMPOSITION" } });
    expect(d.entries.map(strip)).toEqual([
      {
        box: "3.1a",
        ref: "tbl9b",
        pos: undefined,
        amounts: {
          taxableValue: "-60.00",
          igst: "-10.80",
          cgst: "0.00",
          sgst: "0.00",
          cess: "0.00",
        },
      },
      {
        box: "3.2comp",
        ref: "tbl9b",
        pos: "07",
        amounts: { taxableValue: "-60.00", igst: "-10.80" },
      },
    ]);
  });

  it("G10 routing: cdnr SEWP → 3.1b; cdnur EXPWOP → 3.1b; cdnur B2CL → 3.1a and 3.2unreg; DE note → 3.1a only", () => {
    const sez = derive(
      gstr1With({
        cdnr: [{ ctin: GSTINS.sezMh, notes: [cdnrNote({ invoiceType: "SEWP" })] }],
      } as never),
    );
    expect(sez.entries.map((e) => [e.box, e.ref])).toEqual([["3.1b", "tbl9b"]]);
    expect(sez.entries[0]?.amounts).toEqual({
      taxableValue: "-100.00",
      igst: "-18.00",
      cess: "0.00",
    });
    const de = derive(
      gstr1With({
        cdnr: [{ ctin: GSTINS.compositionDl, notes: [cdnrNote({ invoiceType: "DE" })] }],
      } as never),
      {
        recipientTypes: { [GSTINS.compositionDl]: "COMPOSITION" },
      },
    );
    expect(de.entries.map((e) => e.box)).toEqual(["3.1a"]);
    const exp = derive(
      gstr1With({
        cdnur: [
          {
            number: "U-1",
            date: "2026-10-01",
            value: "118.00",
            noteType: "C",
            type: "EXPWOP",
            items: [item("100.00", { igst: "0.00" })],
          },
        ],
      } as never),
    );
    expect(exp.entries.map((e) => [e.box, e.ref])).toEqual([["3.1b", "tbl9b"]]);
    const b2cl = derive(
      gstr1With({
        cdnur: [
          {
            number: "U-2",
            date: "2026-10-01",
            value: "118.00",
            noteType: "C",
            type: "B2CL",
            pos: "27",
            items: [item("100.00", { igst: "18.00" })],
          },
        ],
      } as never),
    );
    expect(b2cl.entries.map((e) => [e.box, e.pos])).toEqual([
      ["3.1a", undefined],
      ["3.2unreg", "27"],
    ]);
  });
});

describe("outwardFromGstr1 — unmapped data (spec §4.4)", () => {
  it("an RCM cdnr note is RCM_NOT_MAPPED and adds nothing", () => {
    const d = derive(
      gstr1With({
        cdnr: [{ ctin: GSTINS.recipientMh, notes: [cdnrNote({ reverseCharge: true })] }],
      } as never),
    );
    expect(d.entries).toEqual([]);
    expect(d.unmapped.map((u) => u.issue.code)).toEqual(["RCM_NOT_MAPPED"]);
  });

  it("an intra-State item bound for 3.2 is INTRA_ITEM_IN_32 (info) and still goes to 3.1a", () => {
    const d = derive(
      b2b(GSTINS.compositionDl, {
        pos: "29",
        items: [item("100.00", { cgst: "9.00", sgst: "9.00" })],
      }),
      {
        recipientTypes: { [GSTINS.compositionDl]: "COMPOSITION" },
      },
    );
    expect(d.entries.map((e) => e.box)).toEqual(["3.1a"]);
    expect(d.unmapped.map((u) => [u.issue.code, u.issue.severity])).toEqual([
      ["INTRA_ITEM_IN_32", "info"],
    ]);
  });

  it("a B2CL note without POS is NOTE_POS_MISSING and goes to 3.1a only", () => {
    const d = derive(
      gstr1With({
        cdnur: [
          {
            number: "U-3",
            date: "2026-10-01",
            value: "118.00",
            noteType: "C",
            type: "B2CL",
            items: [item("100.00", { igst: "18.00" })],
          },
        ],
      } as never),
    );
    expect(d.entries.map((e) => e.box)).toEqual(["3.1a"]);
    expect(d.unmapped.map((u) => u.issue.code)).toEqual(["NOTE_POS_MISSING"]);
  });

  it("an invalid gstr1 return is GSTR1_INVALID", () => {
    const r = outwardFromGstr1({ ...gstr1(), gstin: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(codes(r.issues)).toContain("GSTR1_INVALID");
  });

  it("assembly: a different gstin or period gives GSTR1_GSTIN_MISMATCH / GSTR1_PERIOD_MISMATCH", async () => {
    const { assembleGstr3b } = await import("../src/index.js");
    const outward = derive(gstr1());
    const a = assembleGstr3b({ gstin: GSTINS.supplierKa, period: "112026", outward });
    expect(a.ok ? [] : codes(a.issues)).toContain("GSTR1_PERIOD_MISMATCH");
    const b = assembleGstr3b({ gstin: GSTINS.spareKa, period: "102026", outward });
    expect(b.ok ? [] : codes(b.issues)).toContain("GSTR1_GSTIN_MISMATCH");
  });
});

describe("outwardFromGstr1 — the full fixture", () => {
  it("derives the hand-worked 3.1a, 3.1b and 3.2 figures", () => {
    const outward = derive(gstr1(), { recipientTypes: { [GSTINS.compositionDl]: "COMPOSITION" } });
    expect(outward.unmapped).toEqual([]);
    const d = draftOf({ outward, itcNet: "COMPUTE" });
    expect(d.return.t31.a).toEqual(gstr3bExpectedOutward.t31a);
    expect(d.return.t31.b).toEqual(gstr3bExpectedOutward.t31b);
    expect(d.return.t32.unregistered).toEqual(gstr3bExpectedOutward.t32unreg);
    expect(d.return.t32.composition).toEqual(gstr3bExpectedOutward.t32comp);
    expect(d.return.t32.uinHolders).toEqual([]);
  });
});

describe("AC_GSTR1_MAP and AC_NOT_COVERED against the AC file (spec §4.2–4.3)", () => {
  const ac = loadSource("AC") as {
    properties: { r3bautopop: { properties: { liabitc: unknown } } };
  };
  const liabitc = ac.properties.r3bautopop.properties.liabitc;
  const node = (path: string): Record<string, unknown> => {
    let cur: unknown = liabitc;
    for (const k of path.split("."))
      cur = (cur as { properties: Record<string, unknown> }).properties[k];
    const n = cur as Record<string, unknown>;
    return (n["items"] as Record<string, unknown> | undefined) ?? n;
  };
  const WIRE: Record<string, string> = {
    txval: "taxableValue",
    iamt: "igst",
    camt: "cgst",
    samt: "sgst",
    csamt: "cess",
  };

  it("every map row's AC path exists and its field set equals the node's leaves minus val/form/pos", () => {
    for (const row of AC_GSTR1_MAP) {
      const n = node(row.acPath);
      const leaves = Object.keys(n["properties"] as Record<string, unknown>)
        .filter((k) => !["val", "form", "pos"].includes(k))
        .map((k) => WIRE[k]);
      expect([...leaves].sort(), row.acPath).toEqual([...row.fields].sort());
    }
  });

  it("notCovered = the AC det keys of each box minus the mapped ones (computed independently)", () => {
    const boxPath = {
      "3.1a": "sup_details.osup_3_1a",
      "3.1b": "sup_details.osup_3_1b",
      "3.2unreg": "inter_sup.osup_unreg_3_2",
      "3.2comp": "inter_sup.osup_comp_3_2",
      "3.2uin": "inter_sup.osup_uin_3_2",
    } as const;
    for (const [box, path] of Object.entries(boxPath)) {
      const det = Object.keys(node(`${path}.det`)["properties"] as Record<string, unknown>);
      const mapped = AC_GSTR1_MAP.filter((r) => r.box === box).map((r) => r.table);
      expect([...AC_NOT_COVERED[box as keyof typeof boxPath]].sort(), box).toEqual(
        det.filter((k) => !mapped.includes(k)).sort(),
      );
    }
    for (const box of ["3.1c", "3.1e"] as const) {
      const p = box === "3.1c" ? "sup_details.osup_3_1c.det" : "sup_details.osup_3_1e.det";
      expect(AC_NOT_COVERED[box]).toEqual(
        Object.keys(node(p)["properties"] as Record<string, unknown>),
      );
    }
  });

  it("the derivation's notCovered lists exactly AC_NOT_COVERED", () => {
    const d = derive(gstr1());
    expect(d.notCovered).toEqual(
      Object.entries(AC_NOT_COVERED).flatMap(([b, ks]) => ks.map((k) => `${b}:${k}`)),
    );
  });
});
