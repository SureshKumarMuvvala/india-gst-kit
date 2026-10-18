import { describe, expect, it } from "vitest";
import { toApiSavePayload, toOfflineUploadJson } from "../src/index.js";
import { codes, GSTINS, list, rec, ret, validateS4, validateS5 } from "./helpers.js";
import { api, offline } from "./a2-helpers.js";

// Spec §17.4–§17.6 / §17.13 "Table 10", "Table 8", "Table 11". Filer state = 29 (Karnataka).

const row = (over: Record<string, unknown> = {}) => ({
  originalPeriod: "062025",
  pos: "29",
  rate: "18",
  revised: { taxableValue: "1000", cgst: "90", sgst: "90", cess: "0" },
  original: { taxableValue: "800", cgst: "72", sgst: "72", cess: "0" },
  ...over,
});
const interRow = (over: Record<string, unknown> = {}) =>
  row({
    pos: "27",
    revised: { taxableValue: "500", igst: "90", cess: "0" },
    original: { taxableValue: "400", igst: "72", cess: "0" },
    ...over,
  });

describe("Table 10 — b2csa", () => {
  it("intra row → INTRA with camt/samt; inter row → INTER with iamt; typ OE; S5 and S4 valid", () => {
    const j = api([], { b2csAmendments: [row(), interRow()] });
    expect(list(j, "b2csa")).toEqual([
      {
        typ: "OE",
        sply_ty: "INTER",
        pos: "27",
        omon: "062025",
        itms: [{ rt: 18, txval: 500, iamt: 90, csamt: 0 }],
      },
      {
        typ: "OE",
        sply_ty: "INTRA",
        pos: "29",
        omon: "062025",
        itms: [{ rt: 18, txval: 1000, camt: 90, samt: 90, csamt: 0 }],
      },
    ]);
    expect(validateS5(j) || JSON.stringify(validateS5.errors)).toBe(true);
    const b = offline([], { b2csAmendments: [row(), interRow()] });
    expect(validateS4(b) || JSON.stringify(validateS4.errors)).toBe(true);
    expect(b["b2csa"]).toEqual(j["b2csa"]);
  });

  it("two rates for the same (omon, pos) → one row, two itms; the original row is internal only", () => {
    const j = api([], {
      b2csAmendments: [
        row(),
        row({ rate: "5", revised: { taxableValue: "100", cgst: "2.5", sgst: "2.5", cess: "0" } }),
      ],
    });
    const rows = list(j, "b2csa");
    expect(rows).toHaveLength(1);
    expect(list(rows[0], "itms").map((i) => rec(i)["rt"])).toEqual([5, 18]);
    expect(JSON.stringify(j)).not.toContain("800");
    expect(ret([], { b2csAmendments: [row()] }).b2csa?.[0]?.original.taxableValue).toBe("800.00");
  });

  it("a negative revised txval is emitted", () => {
    const j = api([], {
      b2csAmendments: [
        row({ revised: { taxableValue: "-200", cgst: "-18", sgst: "-18", cess: "0" } }),
      ],
    });
    expect(rec(list(rec(list(j, "b2csa")[0]), "itms")[0])["txval"]).toBe(-200);
    expect(validateS5(j)).toBe(true);
  });

  it("errors: igst on INTRA → B2CS_TAX_SPLIT; POS 96 → POS_NOT_ACCEPTED; duplicate → DUPLICATE_B2CS_AMENDMENT", () => {
    expect(
      codes([], {
        b2csAmendments: [row({ revised: { taxableValue: "1", igst: "1", cess: "0" } })],
      }),
    ).toEqual(["B2CS_TAX_SPLIT"]);
    expect(codes([], { b2csAmendments: [interRow({ pos: "96" })] })).toEqual(["POS_NOT_ACCEPTED"]);
    expect(codes([], { b2csAmendments: [row(), row()] })).toEqual(["DUPLICATE_B2CS_AMENDMENT"]);
    expect(codes([], { b2csAmendments: [row({ originalPeriod: "102026" })] })).toEqual([
      "AMENDMENT_PERIOD",
    ]);
    expect(codes([], { b2csAmendments: [row({ rate: "0.5" })] })).toEqual(["RATE_NOT_ACCEPTED"]);
    expect(codes([], { b2csAmendments: [row({ extra: 1 })] })).toEqual(["SCHEMA"]);
  });
});

describe("Table 8 — nil", () => {
  const all = [
    { supply: "INTRA_UNREGISTERED", nilRated: "4", exempted: "0", nonGst: "0" },
    { supply: "INTER_REGISTERED", nilRated: "1", exempted: "2", nonGst: "3" },
    { supply: "INTER_UNREGISTERED", nilRated: "0", exempted: "5", nonGst: "0" },
    { supply: "INTRA_REGISTERED", nilRated: "0", exempted: "0", nonGst: "6" },
  ] as const;
  it("four rows → nil.inv in 8A–8D order with the S5 codes; all three amounts emitted", () => {
    const j = api([], { nil: all });
    expect(j["nil"]).toEqual({
      inv: [
        { sply_ty: "INTRB2B", nil_amt: 1, expt_amt: 2, ngsup_amt: 3 },
        { sply_ty: "INTRAB2B", nil_amt: 0, expt_amt: 0, ngsup_amt: 6 },
        { sply_ty: "INTRB2C", nil_amt: 0, expt_amt: 5, ngsup_amt: 0 },
        { sply_ty: "INTRAB2C", nil_amt: 4, expt_amt: 0, ngsup_amt: 0 },
      ],
    });
    expect(validateS5(j) || JSON.stringify(validateS5.errors)).toBe(true);
    expect(validateS4(offline([], { nil: all }))).toBe(true);
  });
  it("a negative amount is accepted (S5 #nonEmptyNil has no minimum)", () => {
    const j = api([], {
      nil: [{ supply: "INTER_REGISTERED", nilRated: "-1", exempted: "0", nonGst: "0" }],
    });
    expect(validateS5(j)).toBe(true);
  });
  it("no rows → no nil key; duplicate supply → DUPLICATE_NIL_ROW; a missing column → SCHEMA", () => {
    expect("nil" in api([], { nil: [] })).toBe(false);
    expect(codes([], { nil: [all[0], all[0]] })).toEqual(["DUPLICATE_NIL_ROW"]);
    expect(
      codes([], { nil: [{ supply: "INTER_REGISTERED", nilRated: "1", exempted: "1" }] as never }),
    ).toEqual(["SCHEMA"]);
  });
});

describe("Table 11 — advances", () => {
  const b2b = (over: Record<string, unknown> = {}) => ({
    party: {
      kind: "B2B",
      recipientGstin: GSTINS.recipientKa,
      pos: "29",
      invoiceType: "R",
      reverseCharge: false,
      ...over,
    },
    items: [{ rate: "18", amount: "1000", cgst: "90", sgst: "90" }],
  });
  const b2c = (pos = "27", items: unknown[] = [{ rate: "18", amount: "500", igst: "90" }]) => ({
    party: { kind: "B2C", pos },
    items,
  });
  const exp = {
    party: { kind: "EXPORT", exportType: "WPAY" },
    items: [{ rate: "18", amount: "100", igst: "18" }],
  };

  it("B2B intra → at_b2b with rtin, sply_ty INTRA, camt/samt", () => {
    const j = api([], { advances: { received: [b2b()] } as never });
    expect(j["at"]).toEqual({
      at_b2b: [
        {
          rtin: GSTINS.recipientKa,
          pos: "29",
          sply_ty: "INTRA",
          inv_typ: "R",
          rchrg: "N",
          itms: [{ ad_amt: 1000, camt: 90, samt: 90, csamt: 0, rt: 18 }],
        },
      ],
    });
    expect(validateS5(j) || JSON.stringify(validateS5.errors)).toBe(true);
  });

  it("SEWP is INTER even when pos = supplier state; B2C inter → at_b2c; EXPORT → at_exp INTER without pos", () => {
    const sez = {
      party: {
        kind: "B2B",
        recipientGstin: GSTINS.spareKa,
        pos: "29",
        invoiceType: "SEWP",
        reverseCharge: false,
      },
      items: [{ rate: "18", amount: "100", igst: "18" }],
    };
    const j = api([], { advances: { received: [sez, b2c(), exp] } as never });
    const at = rec(j, "at");
    expect(rec(list(at, "at_b2b")[0])["sply_ty"]).toBe("INTER");
    expect(list(at, "at_b2c")).toEqual([
      { pos: "27", sply_ty: "INTER", itms: [{ ad_amt: 500, iamt: 90, csamt: 0, rt: 18 }] },
    ]);
    expect(list(at, "at_exp")).toEqual([
      { exp_typ: "WPAY", sply_ty: "INTER", itms: [{ ad_amt: 100, iamt: 18, csamt: 0, rt: 18 }] },
    ]);
    expect(validateS5(j) || JSON.stringify(validateS5.errors)).toBe(true);
  });

  it("rows with the same key merge; items sum per rate; txpd mirrors at", () => {
    const j = api([], {
      advances: {
        received: [
          b2c(),
          b2c("27", [
            { rate: "18", amount: "50", igst: "9" },
            { rate: "5", amount: "10", igst: "0.5" },
          ]),
        ],
        adjusted: [b2c()],
      } as never,
    });
    expect(list(rec(j, "at"), "at_b2c")).toEqual([
      {
        pos: "27",
        sply_ty: "INTER",
        itms: [
          { ad_amt: 550, iamt: 99, csamt: 0, rt: 18 },
          { ad_amt: 10, iamt: 0.5, csamt: 0, rt: 5 },
        ],
      },
    ]);
    expect(rec(j, "txpd")).toEqual({
      txpd_b2c: [
        { pos: "27", sply_ty: "INTER", itms: [{ ad_amt: 500, iamt: 90, csamt: 0, rt: 18 }] },
      ],
    });
    expect(validateS5(j) || JSON.stringify(validateS5.errors)).toBe(true);
  });

  it("ata carries omon, opos, oinv_typ, ortin, orchrg", () => {
    const j = api([], {
      advances: {
        receivedAmendments: [
          {
            originalPeriod: "062025",
            original: {
              kind: "B2B",
              recipientGstin: GSTINS.recipientKa,
              pos: "29",
              invoiceType: "R",
              reverseCharge: false,
            },
            revised: b2b(),
          },
        ],
      } as never,
    });
    expect(rec(list(rec(j, "ata"), "ata_b2b")[0])).toMatchObject({
      omon: "062025",
      opos: "29",
      oinv_typ: "R",
      ortin: GSTINS.recipientKa,
      orchrg: "N",
    });
    expect(validateS5(j) || JSON.stringify(validateS5.errors)).toBe(true);
  });

  it("errors: ADVANCE_TAX_SPLIT, ADVANCE_PARTY_CHANGE, RECIPIENT_GSTIN_FORMAT, POS_NOT_ACCEPTED", () => {
    expect(
      codes([], {
        advances: { received: [b2c("27", [{ rate: "18", amount: "1", cgst: "1" }])] } as never,
      }),
    ).toEqual(["ADVANCE_TAX_SPLIT"]);
    expect(
      codes([], {
        advances: {
          adjustedAmendments: [
            { originalPeriod: "062025", original: { kind: "B2C", pos: "27" }, revised: exp },
          ],
        } as never,
      }),
    ).toEqual(["ADVANCE_PARTY_CHANGE"]);
    expect(
      codes([], {
        advances: { received: [b2b({ recipientGstin: GSTINS.notPanStructuredKa })] } as never,
      }),
    ).toEqual(["RECIPIENT_GSTIN_FORMAT"]);
    expect(codes([], { advances: { received: [b2c("96")] } as never })).toEqual([
      "POS_NOT_ACCEPTED",
    ]);
  });

  describe("output (b): flat S4 rows", () => {
    it("B2B + B2C with the same (pos, sply_ty) merge into one at row with summed items", () => {
      const both = [b2b({ pos: "27", recipientGstin: GSTINS.recipientMh }), b2c()].map((r, i) =>
        i === 0 ? { ...r, items: [{ rate: "18", amount: "1000", igst: "180" }] } : r,
      );
      const b = offline([], { advances: { received: both } as never });
      expect(b["at"]).toEqual([
        { pos: "27", sply_ty: "INTER", itms: [{ ad_amt: 1500, iamt: 270, csamt: 0, rt: 18 }] },
      ]);
      expect(validateS4(b) || JSON.stringify(validateS4.errors)).toBe(true);
    });
    it("EXPORT / negative txpd / ata POS change → NOT_IN_OFFLINE_SHAPE, while (a) still renders", () => {
      const cases = [
        { received: [exp] },
        { adjusted: [b2c("27", [{ rate: "18", amount: "-5", igst: "-0.9" }])] },
        {
          receivedAmendments: [
            { originalPeriod: "062025", original: { kind: "B2C", pos: "33" }, revised: b2c("27") },
          ],
        },
      ];
      for (const advances of cases) {
        const r = ret([], { advances: advances as never });
        const b = toOfflineUploadJson(r);
        expect(b.ok ? [] : b.issues.map((i) => i.code)).toEqual(["NOT_IN_OFFLINE_SHAPE"]);
        expect(toApiSavePayload(r).ok).toBe(true);
      }
    });
  });
});
