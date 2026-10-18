import { describe, expect, it } from "vitest";
import { buildGstr1, toApiSavePayload, toOfflineUploadJson } from "../src/index.js";
import {
  codes,
  FILER,
  GSTINS,
  list,
  mkDoc,
  parties,
  PERIOD,
  rec,
  ret,
  unregMh,
  validateS4,
  validateS5,
} from "./helpers.js";
import { api, offline } from "./a2-helpers.js";

// Spec §17.7, §17.8, §17.21 / §17.13 "4C / 5B", "Tables 14 / 15".

const ETIN = GSTINS.ecoOperatorKa;

describe("e-commerce marks (4C / 5B → 4A / 5A since N26; etin in output (b) only)", () => {
  const b2bInv = mkDoc({ number: "M/1", recipient: parties.recipientMh });
  const b2clInv = mkDoc({ number: "M/2", recipient: unregMh, lines: [{ taxable: "150000.00" }] });
  const marks = [
    { kind: "TAX_INVOICE", number: "M/1", etin: ETIN },
    { kind: "TAX_INVOICE", number: "M/2", etin: ETIN },
  ] as const;

  it("(b) writes etin on the b2b and b2cl invoices; validates against S4", () => {
    const b = offline([b2bInv, b2clInv], { ecoMarks: marks });
    expect(rec(list(rec(list(b, "b2b")[0]), "inv")[0])["etin"]).toBe(ETIN);
    expect(rec(list(rec(list(b, "b2cl")[0]), "inv")[0])["etin"]).toBe(ETIN);
    expect(validateS4(b) || JSON.stringify(validateS4.errors)).toBe(true);
  });

  it("(a) has no etin and returns one info-level ECO_NOT_IN_API_SHAPE per marked invoice, pointing to Table 14 (Q-A15)", () => {
    const r = toApiSavePayload(ret([b2bInv, b2clInv], { ecoMarks: marks }));
    if (!r.ok) throw new Error("render failed");
    expect(JSON.stringify(r.value)).not.toContain("etin");
    expect(r.warnings).toEqual([]);
    expect(r.info.map((w) => [w.code, w.severity, w.documentNumber])).toEqual([
      ["ECO_NOT_IN_API_SHAPE", "info", "M/1"],
      ["ECO_NOT_IN_API_SHAPE", "info", "M/2"],
    ]);
    for (const i of r.info) {
      expect(i.message).toContain("Table 14");
      expect(i.message).toContain("26/2022");
    }
    expect(toApiSavePayload(ret([b2bInv])).ok && toApiSavePayload(ret([b2bInv]))).toMatchObject({
      warnings: [],
      info: [],
    });
  });

  it("marking an export, B2CS, RCM or SEZ invoice → ECO_NOT_APPLICABLE", () => {
    const docs = [
      mkDoc({
        number: "X/E",
        recipient: parties.overseas,
        pos: "96",
        category: "EXPORT_WITH_PAYMENT",
      }),
      mkDoc({ number: "X/S", recipient: parties.unregistered }),
      mkDoc({ number: "X/R", recipient: parties.recipientMh, reverseCharge: true }),
      mkDoc({ number: "X/Z", recipient: parties.sezUnit, category: "SEZ_WITH_PAYMENT" }),
    ];
    expect(
      codes(docs, {
        ecoMarks: docs.map((d) => ({ kind: "TAX_INVOICE" as const, number: d.number, etin: ETIN })),
      }),
    ).toEqual([
      "ECO_NOT_APPLICABLE",
      "ECO_NOT_APPLICABLE",
      "ECO_NOT_APPLICABLE",
      "ECO_NOT_APPLICABLE",
    ]);
  });

  it("unknown number → ECO_UNKNOWN_DOCUMENT; etin without C at position 14 → ECO_GSTIN_FORMAT; twice → DUPLICATE_DOCUMENT", () => {
    expect(
      codes([b2bInv], { ecoMarks: [{ kind: "TAX_INVOICE", number: "NOPE", etin: ETIN }] }),
    ).toEqual(["ECO_UNKNOWN_DOCUMENT"]);
    expect(
      codes([b2bInv], {
        ecoMarks: [{ kind: "TAX_INVOICE", number: "M/1", etin: GSTINS.recipientMh }],
      }),
    ).toEqual(["ECO_GSTIN_FORMAT"]);
    expect(codes([b2bInv], { ecoMarks: [marks[0], marks[0]] })).toEqual(["DUPLICATE_DOCUMENT"]);
  });

  it("b2cs typ is always OE; HSN and doc_issue are unchanged by marks", () => {
    const small = mkDoc({ number: "M/3", recipient: parties.unregistered });
    const j = api([b2bInv, b2clInv, small], { ecoMarks: marks });
    expect(list(j, "b2cs").map((r) => rec(r)["typ"])).toEqual(["OE"]);
    const plain = api([b2bInv, b2clInv, small]);
    expect(j["hsn"]).toEqual(plain["hsn"]);
    expect(j["doc_issue"]).toEqual(plain["doc_issue"]);
  });
});

describe("Table 14 — supeco / supecoa", () => {
  const row = (flag?: "N") => ({
    etin: ETIN,
    netValue: "10000",
    igst: "0",
    cgst: "900",
    sgst: "900",
    cess: "0",
    ...(flag === undefined ? {} : { flag }),
  });
  const supeco = {
    collectsTcs: [row("N")],
    paysTax95: [row("N")],
    collectsTcsAmendments: [
      { ...row("N"), originalEtin: GSTINS.ecoOperatorMh, originalPeriod: "062025" },
    ],
  };
  it("collectsTcs / paysTax95 → clttx / paytx; amendments → clttxa with oetin / omon", () => {
    const j = api([], { supeco });
    expect(j["supeco"]).toEqual({
      clttx: [{ etin: ETIN, suppval: 10000, igst: 0, cgst: 900, sgst: 900, cess: 0, flag: "N" }],
      paytx: [{ etin: ETIN, suppval: 10000, igst: 0, cgst: 900, sgst: 900, cess: 0, flag: "N" }],
    });
    expect(rec(list(rec(j, "supecoa"), "clttxa")[0])).toMatchObject({
      oetin: GSTINS.ecoOperatorMh,
      omon: "062025",
    });
    expect(validateS5(j) || JSON.stringify(validateS5.errors)).toBe(true);
    const b = offline([], { supeco });
    expect(validateS4(b) || JSON.stringify(validateS4.errors)).toBe(true);
  });
  it("a row without flag renders in (a) and is NOT_IN_OFFLINE_SHAPE in (b)", () => {
    const r = ret([], { supeco: { collectsTcs: [row()] } });
    expect(toApiSavePayload(r).ok).toBe(true);
    const b = toOfflineUploadJson(r);
    expect(b.ok ? [] : b.issues.map((i) => i.code)).toEqual(["NOT_IN_OFFLINE_SHAPE"]);
  });
  it("bad etin → RECIPIENT_GSTIN_FORMAT; omon = current period → AMENDMENT_PERIOD", () => {
    expect(
      codes([], { supeco: { paysTax95: [{ ...row("N"), etin: "29KKKKK1234K0Z0" }] } }),
    ).toEqual(["RECIPIENT_GSTIN_FORMAT"]);
    expect(
      codes([], {
        supeco: {
          paysTax95Amendments: [{ ...row("N"), originalEtin: ETIN, originalPeriod: PERIOD }],
        },
      }),
    ).toEqual(["AMENDMENT_PERIOD"]);
  });
});

describe("Table 15 — ecom / ecoma (reported by the operator)", () => {
  const doc = {
    number: "E15/1",
    date: "2026-10-03",
    value: "1180",
    pos: "27",
    supplyType: "INTER" as const,
    invoiceType: "R" as const,
    flag: "N" as const,
    items: [{ rate: "18", taxableValue: "1000", igst: "180", cess: "0" }],
  };
  const rateRow = {
    pos: "27",
    supplyType: "INTER" as const,
    flag: "N" as const,
    rate: "18",
    taxableValue: "500",
    igst: "90",
  };
  const ecom = {
    b2b: [{ supplierGstin: GSTINS.recipientKa, recipientGstin: GSTINS.recipientMh, ...doc }],
    urp2b: [{ recipientGstin: GSTINS.recipientMh, ...doc, number: "E15/2" }],
    b2c: [{ supplierGstin: GSTINS.recipientKa, ...rateRow }],
    urp2c: [rateRow],
    b2ba: [
      {
        supplierGstin: GSTINS.recipientKa,
        recipientGstin: GSTINS.recipientMh,
        ...doc,
        number: "E15/1R",
        originalNumber: "E15/0",
        originalDate: "2026-09-03",
      },
    ],
    urp2ba: [
      {
        recipientGstin: GSTINS.recipientMh,
        ...doc,
        number: "E15/2R",
        originalNumber: "E15/9",
        originalDate: "2026-09-03",
      },
    ],
    b2ca: [
      {
        supplierGstin: GSTINS.recipientKa,
        originalSupplierGstin: GSTINS.spareKa,
        originalPeriod: "092026",
        pos: "27",
        supplyType: "INTER" as const,
        flag: "N" as const,
        items: [{ rate: "18", taxableValue: "-100", igst: "-18" }],
      },
    ],
    urp2ca: [
      {
        originalPeriod: "092026",
        pos: "27",
        supplyType: "INTER" as const,
        flag: "E" as const,
        items: [{ rate: "5", taxableValue: "100", igst: "5" }],
      },
    ],
  };
  it("all eight arrays render as S5 with the caller's flag; S4 valid too", () => {
    const j = api([], { ecom });
    const e = rec(j, "ecom");
    expect(Object.keys(e)).toEqual(["b2b", "urp2b", "b2c", "urp2c"]);
    expect(rec(list(e, "b2b")[0])).toMatchObject({
      stin: GSTINS.recipientKa,
      rtin: GSTINS.recipientMh,
    });
    expect(rec(list(rec(list(e, "b2b")[0]), "inv")[0])).toEqual({
      inum: "E15/1",
      idt: "03-10-2026",
      val: 1180,
      pos: "27",
      sply_ty: "INTER",
      inv_typ: "R",
      flag: "N",
      itms: [{ num: 1801, itm_det: { rt: 18, txval: 1000, iamt: 180, csamt: 0 } }],
    });
    expect(list(e, "b2c")[0]).toEqual({
      stin: GSTINS.recipientKa,
      pos: "27",
      sply_ty: "INTER",
      flag: "N",
      rt: 18,
      txval: 500,
      iamt: 90,
    });
    const a = rec(j, "ecoma");
    expect(Object.keys(a)).toEqual(["b2ba", "urp2ba", "b2ca", "urp2ca"]);
    expect(rec(list(rec(list(a, "b2ba")[0]), "inv")[0])).toMatchObject({
      oinum: "E15/0",
      oidt: "03-09-2026",
    });
    expect(list(a, "b2ca")[0]).toEqual({
      pos: "27",
      posItms: [
        {
          stin: GSTINS.recipientKa,
          ostin: GSTINS.spareKa,
          omon: "092026",
          sply_ty: "INTER",
          flag: "N",
          itms: [{ rt: 18, txval: -100, iamt: -18 }],
        },
      ],
    });
    expect(validateS5(j) || JSON.stringify(validateS5.errors)).toBe(true);
    expect(validateS4(offline([], { ecom })) || JSON.stringify(validateS4.errors)).toBe(true);
  });
  it("a missing flag is a SCHEMA issue; TAX_SPLIT per sply_ty; duplicate invoice number per supplier", () => {
    const noFlag: Partial<typeof doc> = { ...doc };
    delete noFlag.flag;
    expect(
      codes([], { ecom: { urp2b: [{ recipientGstin: GSTINS.recipientMh, ...noFlag }] } as never }),
    ).toEqual(["SCHEMA"]);
    expect(codes([], { ecom: { urp2c: [{ ...rateRow, supplyType: "INTRA" as const }] } })).toEqual([
      "TAX_SPLIT",
    ]);
    expect(
      codes([], {
        ecom: {
          b2b: [
            { supplierGstin: GSTINS.recipientKa, recipientGstin: GSTINS.recipientMh, ...doc },
            { supplierGstin: GSTINS.recipientKa, recipientGstin: GSTINS.recipientCh, ...doc },
          ],
        },
      }),
    ).toEqual(["DUPLICATE_DOCUMENT"]);
  });
  it("Tables 14 / 15 are never produced from documents", () => {
    const r = buildGstr1({
      gstin: FILER,
      period: PERIOD,
      documents: [mkDoc({ recipient: parties.recipientMh })],
    });
    expect(r.ok && r.value.ecom === undefined && r.value.supeco === undefined).toBe(true);
  });
});
