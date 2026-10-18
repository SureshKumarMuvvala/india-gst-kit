import { describe, expect, it } from "vitest";
import { GSTINS } from "@india-gst-kit/fixtures";
import {
  AC_ADVANCE_MAP,
  AC_NOT_COVERED,
  outwardFromGstr1,
  type OutwardDerivation,
  type TrailEntry,
} from "../src/index.js";
import { codes, draftOf, gstr1With, item, loadSource } from "./helpers.js";

// Spec §22 (Track A2): G11–G15; G1′/G6′ not built (Notification 26/2022-CT omitted Tables 4C/5B).

function derive(...args: Parameters<typeof outwardFromGstr1>): OutwardDerivation {
  const r = outwardFromGstr1(...args);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
const strip = (e: TrailEntry) => ({ box: e.box, ref: e.ref, pos: e.pos, amounts: e.amounts });
const ret = (sections: Record<string, unknown>) => gstr1With(sections);

const orig = (over: Record<string, unknown> = {}) => ({
  number: "O-1",
  date: "2025-06-10",
  period: "062025",
  pos: "27",
  reverseCharge: false,
  invoiceType: "R",
  items: [item("1000.00", { igst: "180.00" })],
  ...over,
});
const b2baInv = (over: Record<string, unknown> = {}, o: Record<string, unknown> = {}) => ({
  number: "R-1",
  date: "2026-10-08",
  value: "1416.00",
  pos: "27",
  reverseCharge: false,
  invoiceType: "R",
  items: [item("1200.00", { igst: "216.00" })],
  original: orig(o),
  ...over,
});
const z5 = { cgst: "0.00", sgst: "0.00", cess: "0.00" };

describe("G11 — Table 8 → 3.1c / 3.1e", () => {
  it("3.1c = nil rated + exempted, 3.1e = non-GST, over all rows; ref tbl8", () => {
    const d = derive(
      ret({
        nil: [
          { supply: "INTER_REGISTERED", nilRated: "10.00", exempted: "20.00", nonGst: "30.00" },
          { supply: "INTRA_UNREGISTERED", nilRated: "1.00", exempted: "2.00", nonGst: "3.00" },
        ],
      }),
    );
    expect(d.entries.map(strip)).toEqual([
      { box: "3.1c", ref: "tbl8", pos: undefined, amounts: { taxableValue: "33.00" } },
      { box: "3.1e", ref: "tbl8", pos: undefined, amounts: { taxableValue: "33.00" } },
    ]);
  });
  it("assembly puts them into 3.1 (c) and (e) with a GSTR1 trail (D-A13)", () => {
    const d = derive(
      ret({
        nil: [{ supply: "INTER_REGISTERED", nilRated: "5.00", exempted: "6.00", nonGst: "7.00" }],
      }),
    );
    const draft = draftOf({ outward: d });
    expect(draft.return.t31.c.taxableValue).toBe("11.00");
    expect(draft.return.t31.e.taxableValue).toBe("7.00");
    expect(draft.trail.filter((e) => e.ref === "tbl8").map((e) => e.source)).toEqual([
      "GSTR1",
      "GSTR1",
    ]);
  });
});

describe("e-commerce-marked invoices stay in 4A / 5A (N26; G1′ / G6′ not built)", () => {
  it("a marked b2b R invoice feeds tbl4a and not tbl4c; a marked b2cl invoice feeds tbl5a and 3.2unreg", () => {
    const d = derive(
      ret({
        b2b: [
          {
            ctin: GSTINS.recipientMh,
            invoices: [
              {
                number: "M-1",
                date: "2026-10-01",
                value: "1180.00",
                pos: "27",
                reverseCharge: false,
                invoiceType: "R",
                etin: GSTINS.ecoOperatorKa,
                items: [item("1000.00", { igst: "180.00" })],
              },
            ],
          },
        ],
        b2cl: [
          {
            pos: "27",
            invoices: [
              {
                number: "M-2",
                date: "2026-10-01",
                value: "118000.00",
                etin: GSTINS.ecoOperatorKa,
                items: [item("100000.00", { igst: "18000.00" })],
              },
            ],
          },
        ],
      }),
    );
    expect(d.entries.map((e) => `${e.box}:${e.ref}`)).toEqual([
      "3.1a:tbl4a",
      "3.1a:tbl5a",
      "3.2unreg:tbl5a",
    ]);
    expect(d.notCovered).toContain("3.1a:tbl4c");
    expect(d.notCovered).toContain("3.1a:tbl5b");
  });
});

describe("G12 / G13 — amendments, revised − original (D-A12)", () => {
  it("b2ba ₹1,000 + 18 % → ₹1,200 gives 3.1a tbl9a +200.00 / +36.00; a downward revision is negative", () => {
    const up = derive(ret({ b2ba: [{ ctin: GSTINS.recipientMh, invoices: [b2baInv()] }] }));
    expect(up.entries.map(strip)).toEqual([
      {
        box: "3.1a",
        ref: "tbl9a",
        pos: undefined,
        amounts: { taxableValue: "200.00", igst: "36.00", ...z5 },
      },
    ]);
    const down = derive(
      ret({
        b2ba: [
          {
            ctin: GSTINS.recipientMh,
            invoices: [b2baInv({ items: [item("900.00", { igst: "162.00" })] })],
          },
        ],
      }),
    );
    expect(down.entries.map(strip)[0]?.amounts).toMatchObject({
      taxableValue: "-100.00",
      igst: "-18.00",
    });
  });

  it("cdnra credit note 500 → 400 gives +100.00 (the note sign on both sides)", () => {
    const d = derive(
      ret({
        cdnra: [
          {
            ctin: GSTINS.recipientMh,
            notes: [
              {
                number: "CN-R",
                date: "2026-10-08",
                value: "472.00",
                noteType: "C",
                pos: "27",
                reverseCharge: false,
                invoiceType: "R",
                items: [item("400.00", { igst: "72.00" })],
                original: orig({
                  number: "CN-O",
                  noteType: "C",
                  items: [item("500.00", { igst: "90.00" })],
                }),
              },
            ],
          },
        ],
      }),
    );
    expect(d.entries.map(strip)).toEqual([
      {
        box: "3.1a",
        ref: "tbl9c",
        pos: undefined,
        amounts: { taxableValue: "100.00", igst: "18.00", ...z5 },
      },
    ]);
  });

  it("POS change with a composition recipient: 3.2comp −original at the old POS, +revised at the new", () => {
    const d = derive(
      ret({
        b2ba: [{ ctin: GSTINS.compositionDl, invoices: [b2baInv({ pos: "27" }, { pos: "07" })] }],
      }),
      { recipientTypes: { [GSTINS.compositionDl]: "COMPOSITION" } },
    );
    expect(d.entries.filter((e) => e.box === "3.2comp").map(strip)).toEqual([
      {
        box: "3.2comp",
        ref: "tbl9a",
        pos: "07",
        amounts: { taxableValue: "-1000.00", igst: "-180.00" },
      },
      {
        box: "3.2comp",
        ref: "tbl9a",
        pos: "27",
        amounts: { taxableValue: "1200.00", igst: "216.00" },
      },
    ]);
  });

  it("routing: SEWP b2ba and expa → 3.1b; b2cla → 3.1a + 3.2unreg; cdnura EXPWOP → 3.1b", () => {
    const d = derive(
      ret({
        b2ba: [
          {
            ctin: GSTINS.sezMh,
            invoices: [b2baInv({ invoiceType: "SEWP" }, { invoiceType: "SEWP" })],
          },
        ],
        b2cla: [
          {
            pos: "27",
            invoices: [
              {
                number: "L-R",
                date: "2026-10-08",
                value: "1.00",
                items: [item("1200.00", { igst: "216.00" })],
                original: orig(),
              },
            ],
          },
        ],
        expa: [
          {
            exportType: "WPAY",
            invoices: [
              {
                number: "E-R",
                date: "2026-10-08",
                value: "1.00",
                items: [{ rate: "18", taxableValue: "1200.00", igst: "216.00", cess: "0.00" }],
                original: orig({ exportType: "WPAY" }),
              },
            ],
          },
        ],
        cdnura: [
          {
            number: "N-R",
            date: "2026-10-08",
            value: "1.00",
            noteType: "C",
            type: "EXPWOP",
            items: [item("100.00", { igst: "0.00" })],
            original: orig({
              noteType: "C",
              type: "EXPWOP",
              items: [item("200.00", { igst: "0.00" })],
            }),
          },
        ],
      }),
    );
    expect(d.entries.map((e) => `${e.box}:${e.ref}:${e.pos ?? ""}`)).toEqual([
      "3.1a:tbl9a:",
      "3.1b:tbl9a:",
      "3.1b:tbl9c:",
      "3.2unreg:tbl9a:27",
    ]);
    const b31 = d.entries.find((e) => e.box === "3.1b" && e.ref === "tbl9a");
    expect(b31?.amounts).toEqual({ taxableValue: "400.00", igst: "72.00", cess: "0.00" });
    expect(d.entries.find((e) => e.ref === "tbl9c")?.amounts.taxableValue).toBe("100.00");
  });

  it("an RCM b2ba → RCM_NOT_MAPPED, no entries", () => {
    const r = outwardFromGstr1(
      ret({
        b2ba: [
          {
            ctin: GSTINS.recipientMh,
            invoices: [b2baInv({ reverseCharge: true }, { reverseCharge: true })],
          },
        ],
      }),
    );
    if (!r.ok) throw new Error("derive failed");
    expect(r.value.entries).toEqual([]);
    expect(codes(r.value.unmapped.map((u) => u.issue))).toEqual(["RCM_NOT_MAPPED"]);
  });
});

describe("G14 — Table 10, revised − original", () => {
  it("INTRA → 3.1a tbl10a; INTER → 3.1a tbl10b and 3.2unreg tbl10b", () => {
    const d = derive(
      ret({
        b2csa: [
          {
            originalPeriod: "062025",
            supplyType: "INTRA",
            pos: "29",
            rate: "18",
            revised: { taxableValue: "1000.00", cgst: "90.00", sgst: "90.00", cess: "0.00" },
            original: { taxableValue: "800.00", cgst: "72.00", sgst: "72.00", cess: "0.00" },
          },
          {
            originalPeriod: "062025",
            supplyType: "INTER",
            pos: "27",
            rate: "18",
            revised: { taxableValue: "100.00", igst: "18.00", cess: "0.00" },
            original: { taxableValue: "300.00", igst: "54.00", cess: "0.00" },
          },
        ],
      }),
    );
    expect(d.entries.map(strip)).toEqual([
      {
        box: "3.1a",
        ref: "tbl10a",
        pos: undefined,
        amounts: { taxableValue: "200.00", cgst: "18.00", sgst: "18.00", cess: "0.00" },
      },
      {
        box: "3.1a",
        ref: "tbl10b",
        pos: undefined,
        amounts: { taxableValue: "-200.00", igst: "-36.00", cess: "0.00" },
      },
      {
        box: "3.2unreg",
        ref: "tbl10b",
        pos: "27",
        amounts: { taxableValue: "-200.00", igst: "-36.00" },
      },
    ]);
  });
});

describe("G15 — advances, opt-in (D-A14)", () => {
  const adv = {
    advances: {
      received: [
        {
          party: { kind: "B2C", pos: "27" },
          supplyType: "INTER",
          items: [{ rate: "18", amount: "500.00", igst: "90.00", cess: "0.00" }],
        },
        {
          party: { kind: "EXPORT", exportType: "WPAY" },
          supplyType: "INTER",
          items: [{ rate: "18", amount: "100.00", igst: "18.00", cess: "0.00" }],
        },
        {
          party: {
            kind: "B2B",
            recipientGstin: GSTINS.compositionDl,
            pos: "07",
            invoiceType: "R",
            reverseCharge: false,
          },
          supplyType: "INTER",
          items: [{ rate: "18", amount: "50.00", igst: "9.00", cess: "0.00" }],
        },
      ],
      adjusted: [
        {
          party: { kind: "B2C", pos: "29" },
          supplyType: "INTRA",
          items: [{ rate: "18", amount: "200.00", cgst: "18.00", sgst: "18.00", cess: "0.00" }],
        },
      ],
      receivedAmendments: [],
      adjustedAmendments: [],
    },
  };
  const advanceKeys = AC_ADVANCE_MAP.map((r) => `${r.box}:${r.table}`);

  it("flag off: no tbl11 entries; the advance keys stay in notCovered", () => {
    const d = derive(ret(adv));
    expect(d.entries).toEqual([]);
    for (const k of advanceKeys) expect(d.notCovered).toContain(k);
  });
  it("flag on: received +, adjusted −, EXPORT in 3.1b, INTER B2C in 3.2unreg, comp B2B in 3.2comp", () => {
    const d = derive(ret(adv), {
      confirmAdvanceMapping: true,
      recipientTypes: { [GSTINS.compositionDl]: "COMPOSITION" },
    });
    expect(d.entries.map(strip)).toEqual([
      {
        box: "3.1a",
        ref: "tbl11a_1_2_4",
        pos: undefined,
        amounts: {
          taxableValue: "550.00",
          igst: "99.00",
          cgst: "0.00",
          sgst: "0.00",
          cess: "0.00",
        },
      },
      {
        box: "3.1a",
        ref: "tbl11b_1_2_4",
        pos: undefined,
        amounts: {
          taxableValue: "-200.00",
          igst: "0.00",
          cgst: "-18.00",
          sgst: "-18.00",
          cess: "0.00",
        },
      },
      {
        box: "3.1b",
        ref: "tbl11a_3",
        pos: undefined,
        amounts: { taxableValue: "100.00", igst: "18.00", cess: "0.00" },
      },
      {
        box: "3.2unreg",
        ref: "tbl11a_4_5",
        pos: "27",
        amounts: { taxableValue: "500.00", igst: "90.00" },
      },
      {
        box: "3.2comp",
        ref: "tbl11a_1_5",
        pos: "07",
        amounts: { taxableValue: "50.00", igst: "9.00" },
      },
    ]);
    for (const k of advanceKeys) expect(d.notCovered).not.toContain(k);
  });
  it("an RCM B2B advance → RCM_NOT_MAPPED", () => {
    const r = outwardFromGstr1(
      ret({
        advances: {
          ...adv.advances,
          adjusted: [],
          received: [
            {
              party: {
                kind: "B2B",
                recipientGstin: GSTINS.recipientMh,
                pos: "27",
                invoiceType: "R",
                reverseCharge: true,
              },
              supplyType: "INTER",
              items: [{ rate: "18", amount: "1.00", igst: "0.18", cess: "0.00" }],
            },
          ],
        },
      }),
      { confirmAdvanceMapping: true },
    );
    if (!r.ok) throw new Error("derive failed");
    expect(codes(r.value.unmapped.map((u) => u.issue))).toEqual(["RCM_NOT_MAPPED"]);
  });
});

describe("notCovered and AC_ADVANCE_MAP (spec §22.3)", () => {
  it("notCovered equals AC_NOT_COVERED with the flag off, and AC_NOT_COVERED minus AC_ADVANCE_MAP with it on", () => {
    const all = Object.entries(AC_NOT_COVERED).flatMap(([b, ks]) => ks.map((k) => `${b}:${k}`));
    expect(derive(ret({})).notCovered).toEqual(all);
    const keys = new Set(AC_ADVANCE_MAP.map((r) => `${r.box}:${r.table}`));
    expect(derive(ret({}), { confirmAdvanceMapping: true }).notCovered).toEqual(
      all.filter((k) => !keys.has(k)),
    );
    expect(AC_NOT_COVERED["3.1c"]).toEqual([]);
    expect(AC_NOT_COVERED["3.1e"]).toEqual([]);
    expect(AC_NOT_COVERED["3.1a"]).toEqual(expect.arrayContaining(["tbl4c", "tbl5b", "tbl4f"]));
  });
  it("every AC_ADVANCE_MAP row exists in AC with the same field set (leaves minus val/form/pos)", () => {
    const ac = loadSource("AC") as {
      properties: { r3bautopop: { properties: { liabitc: unknown } } };
    };
    const WIRE: Record<string, string> = {
      txval: "taxableValue",
      iamt: "igst",
      camt: "cgst",
      samt: "sgst",
      csamt: "cess",
    };
    for (const row of AC_ADVANCE_MAP) {
      let cur: unknown = ac.properties.r3bautopop.properties.liabitc;
      for (const k of row.acPath.split("."))
        cur = (cur as { properties: Record<string, unknown> }).properties[k];
      const n = ((cur as Record<string, unknown>)["items"] ?? cur) as {
        properties: Record<string, unknown>;
      };
      const leaves = Object.keys(n.properties)
        .filter((k) => !["val", "form", "pos"].includes(k))
        .map((k) => WIRE[k]);
      expect([...leaves].sort(), row.acPath).toEqual([...row.fields].sort());
    }
  });
  it("Tables 14 / 15 and advance amendments produce no entries", () => {
    const d = derive(
      ret({
        supeco: {
          collectsTcs: [
            {
              etin: GSTINS.ecoOperatorKa,
              netValue: "1.00",
              igst: "0.00",
              cgst: "0.00",
              sgst: "0.00",
            },
          ],
          paysTax95: [],
          collectsTcsAmendments: [],
          paysTax95Amendments: [],
        },
        ecom: {
          b2b: [],
          urp2b: [],
          b2c: [],
          urp2c: [{ pos: "27", supplyType: "INTER", flag: "N", rate: "18", taxableValue: "1.00" }],
          b2ba: [],
          urp2ba: [],
          b2ca: [],
          urp2ca: [],
        },
        advances: {
          received: [],
          adjusted: [],
          receivedAmendments: [
            {
              originalPeriod: "062025",
              original: { kind: "B2C", pos: "27" },
              row: {
                party: { kind: "B2C", pos: "27" },
                supplyType: "INTER",
                items: [{ rate: "18", amount: "1.00", igst: "0.18", cess: "0.00" }],
              },
            },
          ],
          adjustedAmendments: [],
        },
      }),
      { confirmAdvanceMapping: true },
    );
    expect(d.entries).toEqual([]);
  });
});
