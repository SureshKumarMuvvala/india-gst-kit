import { describe, expect, it } from "vitest";
import { classifyDocument, buildGstr1, type Gstr1Issue } from "../src/index.js";
import {
  FILER,
  GSTINS,
  PERIOD,
  api,
  build,
  codes,
  mkDoc,
  parties,
  partyWith,
  unregMh,
  withCheck,
  at,
  list,
  rec,
} from "./helpers.js";

const sectionOf = (doc: ReturnType<typeof mkDoc>, extra = {}) => {
  const r = build([doc], extra);
  return r.ok ? r.classification[0]?.section : r.issues.map((i) => i.code);
};

describe("invoices → sections", () => {
  it("registered DOMESTIC → b2b R, intra-state tax in camt/samt", () => {
    const j = api([mkDoc()]);
    expect(at(j, "b2b", 0, "ctin")).toBe(GSTINS.recipientKa);
    const inv = at(j, "b2b", 0, "inv", 0);
    expect(inv).toMatchObject({
      inum: "INV/1",
      idt: "05-10-2026",
      pos: "29",
      rchrg: "N",
      inv_typ: "R",
    });
    expect(at(inv, "itms", 0, "itm_det")).toEqual({
      txval: 1000,
      rt: 18,
      camt: 90,
      samt: 90,
      csamt: 0,
    });
  });
  it("registered DEEMED_EXPORT → b2b DE", () => {
    const j = api([mkDoc({ recipient: parties.recipientMh, category: "DEEMED_EXPORT" })]);
    expect(at(j, "b2b", 0, "inv", 0, "inv_typ")).toBe("DE");
    expect(at(j, "b2b", 0, "inv", 0, "itms", 0, "itm_det", "iamt")).toBe(180);
  });
  it("SEZ_WITH_PAYMENT → b2b SEWP with IGST", () => {
    const j = api([mkDoc({ recipient: parties.sezUnit, category: "SEZ_WITH_PAYMENT" })]);
    expect(at(j, "b2b", 0, "inv", 0, "inv_typ")).toBe("SEWP");
    expect(at(j, "b2b", 0, "inv", 0, "itms", 0, "itm_det")).toEqual({
      txval: 1000,
      rt: 18,
      iamt: 180,
      csamt: 0,
    });
  });
  it("SEZ_WITHOUT_PAYMENT → b2b SEWOP with iamt and csamt 0.00", () => {
    const j = api([mkDoc({ recipient: parties.sezUnit, category: "SEZ_WITHOUT_PAYMENT" })]);
    expect(at(j, "b2b", 0, "inv", 0, "inv_typ")).toBe("SEWOP");
    expect(at(j, "b2b", 0, "inv", 0, "itms", 0, "itm_det")).toEqual({
      txval: 1000,
      rt: 18,
      iamt: 0,
      csamt: 0,
    });
  });
  it("unregistered inter-state: 100000.01 → b2cl, 100000.00 → b2cs INTER (strictly greater)", () => {
    const over = mkDoc({ recipient: unregMh, lines: [{ taxable: "100000.01", rate: "0" }] });
    expect(sectionOf(over)).toBe("b2cl");
    const exact = mkDoc({ recipient: unregMh, lines: [{ taxable: "100000.00", rate: "0" }] });
    expect(sectionOf(exact)).toBe("b2cs");
    expect(at(api([exact]), "b2cs", 0)).toMatchObject({ sply_ty: "INTER", typ: "OE", pos: "27" });
    const j = api([over]);
    expect(at(j, "b2cl", 0, "pos")).toBe("27");
    expect(at(j, "b2cl", 0, "inv", 0, "itms", 0, "itm_det")).toEqual({
      txval: 100000.01,
      rt: 0,
      iamt: 0,
      csamt: 0,
    });
  });
  it("unregistered intra-state of any value → b2cs INTRA", () => {
    const d = mkDoc({
      recipient: parties.unregistered,
      lines: [{ taxable: "5000000.00", rate: "0" }],
    });
    expect(sectionOf(d)).toBe("b2cs");
    expect(at(api([d]), "b2cs", 0)).toMatchObject({
      sply_ty: "INTRA",
      pos: "29",
      rt: 0,
      txval: 5000000,
    });
  });
  it.each([
    ["EXPORT_WITH_PAYMENT", "WPAY"],
    ["EXPORT_WITHOUT_PAYMENT", "WOPAY"],
  ])("%s → exp %s with no pos", (category, typ) => {
    const d = mkDoc({ recipient: parties.overseas, category, pos: "96" });
    const j = api([d]);
    expect(at(j, "exp", 0, "exp_typ")).toBe(typ);
    const inv = at(j, "exp", 0, "inv", 0);
    expect(at(inv, "pos")).toBeUndefined();
    expect(at(inv, "itms", 0, "num")).toBeUndefined();
    expect(at(inv, "itms", 0, "itm_det")).toBeUndefined();
    expect(Object.keys(rec(inv, "itms", 0))).toEqual(["txval", "rt", "iamt", "csamt"]);
    if (typ === "WOPAY") expect(at(inv, "itms", 0)).toMatchObject({ iamt: 0, csamt: 0 });
    else expect(at(inv, "itms", 0, "iamt")).toBe(180);
  });
});

describe("invoice errors", () => {
  it("SEZ or deemed export to an unregistered recipient → CATEGORY_NEEDS_GSTIN", () => {
    for (const category of ["SEZ_WITH_PAYMENT", "SEZ_WITHOUT_PAYMENT", "DEEMED_EXPORT"]) {
      expect(codes([mkDoc({ recipient: parties.unregistered, category })])).toContain(
        "CATEGORY_NEEDS_GSTIN",
      );
    }
  });
  it("POS 96 on a DOMESTIC unregistered invoice → POS_96_NOT_EXPORT", () => {
    const c = codes([mkDoc({ recipient: parties.unregistered, pos: "96" })]);
    expect(c).toContain("POS_96_NOT_EXPORT");
    expect(c).not.toContain("POS_NOT_ACCEPTED");
  });
  it("POS 99 → POS_NOT_ACCEPTED", () => {
    expect(codes([mkDoc({ recipient: parties.unregistered, pos: "99" })])).toContain(
      "POS_NOT_ACCEPTED",
    );
    expect(codes([mkDoc({ pos: "99" })])).toContain("POS_NOT_ACCEPTED");
  });
  it("POS 96 is accepted on b2b", () => {
    expect(codes([mkDoc({ pos: "96" })])).not.toContain("POS_NOT_ACCEPTED");
  });
  it("bill of supply → UNSUPPORTED_DOCUMENT", () => {
    expect(codes([mkDoc({ kind: "BILL_OF_SUPPLY" })])).toContain("UNSUPPORTED_DOCUMENT");
  });
  it.each(["COMPOSITION", "SEZ_UNIT", "SEZ_DEVELOPER"])(
    "%s supplier → UNSUPPORTED_SUPPLIER",
    (registrationType) => {
      const supplier = { ...parties.supplier, registrationType };
      const kind = registrationType === "COMPOSITION" ? "CREDIT_NOTE" : "TAX_INVOICE";
      const d = mkDoc({
        supplier,
        kind,
        ...(kind === "CREDIT_NOTE" ? { original: { number: "INV/0", date: "2026-10-01" } } : {}),
      });
      expect(codes([d])).toContain("UNSUPPORTED_SUPPLIER");
    },
  );
  it("reverse charge to an unregistered recipient → REVERSE_CHARGE_B2C", () => {
    expect(codes([mkDoc({ recipient: parties.unregistered, reverseCharge: true })])).toContain(
      "REVERSE_CHARGE_B2C",
    );
    expect(codes([mkDoc({ reverseCharge: true })])).not.toContain("REVERSE_CHARGE_B2C");
    expect(at(api([mkDoc({ reverseCharge: true })]), "b2b", 0, "inv", 0, "rchrg")).toBe("Y");
  });
});

describe("rates", () => {
  it("0.5 → RATE_NOT_ACCEPTED", () => {
    expect(codes([mkDoc({ lines: [{ taxable: "1000.00", rate: "0.5" }] })])).toContain(
      "RATE_NOT_ACCEPTED",
    );
  });
  it("18.000 is emitted as 18; 40 is accepted; 0.25 → 0.25", () => {
    const j = api([
      mkDoc({
        lines: [
          { taxable: "1000.00", rate: "18.000" },
          { taxable: "1000.00", rate: "40" },
          { taxable: "1000.00", rate: "0.25" },
        ],
      }),
    ]);
    const rts = list(j, "b2b", 0, "inv", 0, "itms").map((i) => at(i, "itm_det", "rt"));
    expect(rts).toEqual([18, 40, 0.25]);
  });
  it.each(["0", "0.1", "0.25", "1", "1.5", "3", "5", "6", "7.5", "12", "18", "28", "40"])(
    "rate %s is in the list",
    (rate) => {
      expect(codes([mkDoc({ lines: [{ taxable: "1000.00", rate }] })])).not.toContain(
        "RATE_NOT_ACCEPTED",
      );
    },
  );
});

describe("credit and debit notes", () => {
  const orig = { number: "INV/0", date: "2026-10-01" };
  it("credit note to a registered recipient → cdnr C, positive amounts; debit → D", () => {
    const c = api([mkDoc({ kind: "CREDIT_NOTE", number: "CN/1", original: orig })]);
    const nt = at(c, "cdnr", 0, "nt", 0);
    expect(at(c, "cdnr", 0, "ctin")).toBe(GSTINS.recipientKa);
    expect(nt).toMatchObject({
      nt_num: "CN/1",
      nt_dt: "05-10-2026",
      ntty: "C",
      val: 1180,
      pos: "29",
      rchrg: "N",
      inv_typ: "R",
    });
    expect(at(nt, "itms", 0, "itm_det", "txval")).toBe(1000);
    const d = api([mkDoc({ kind: "DEBIT_NOTE", number: "DN/1", original: orig })]);
    expect(at(d, "cdnr", 0, "nt", 0, "ntty")).toBe("D");
  });
  it("note on an export → cdnur EXPWP / EXPWOP, no pos", () => {
    for (const [category, typ] of [
      ["EXPORT_WITH_PAYMENT", "EXPWP"],
      ["EXPORT_WITHOUT_PAYMENT", "EXPWOP"],
    ] as const) {
      const j = api([
        mkDoc({
          kind: "CREDIT_NOTE",
          number: "CN/1",
          recipient: parties.overseas,
          category,
          pos: "96",
          original: orig,
        }),
      ]);
      expect(at(j, "cdnur", 0, "typ")).toBe(typ);
      expect(at(j, "cdnur", 0, "pos")).toBeUndefined();
      expect(at(j, "cdnur", 0, "ntty")).toBe("C");
    }
  });
  const b2clOrig = (period?: string) =>
    mkDoc({
      number: "B2CL/1",
      date: "2026-10-01",
      recipient: unregMh,
      lines: [{ taxable: "150000.00", rate: "0" }],
      ...(period === undefined ? {} : { date: "2024-07-10" }),
    });
  const unregNote = (kind: "CREDIT_NOTE" | "DEBIT_NOTE", taxable = "1000.00", number = "CN/1") =>
    mkDoc({
      kind,
      number,
      recipient: unregMh,
      original: { number: "B2CL/1", date: "2026-10-01" },
      lines: [{ taxable, rate: "0" }],
    });
  it("unregistered, original b2cl in documents → cdnur B2CL with pos", () => {
    const j = api([b2clOrig(), unregNote("CREDIT_NOTE")]);
    expect(at(j, "cdnur", 0)).toMatchObject({ typ: "B2CL", pos: "27", ntty: "C", val: 1000 });
    expect(at(j, "b2cs")).toBeUndefined();
  });
  it("original 1.5 lakh reported in 072024 → b2cs then (limit 2.5 lakh) → note nets into b2cs", () => {
    const original = mkDoc({
      number: "B2CL/1",
      date: "2024-07-10",
      recipient: unregMh,
      lines: [{ taxable: "150000.00", rate: "0" }],
    });
    const note = mkDoc({
      kind: "CREDIT_NOTE",
      number: "CN/1",
      recipient: unregMh,
      original: { number: "B2CL/1", date: "2024-07-10" },
      lines: [{ taxable: "1000.00", rate: "0" }],
    });
    const j = api([note], {
      options: { originalInvoices: [{ document: original, period: "072024" }] },
    });
    expect(at(j, "cdnur")).toBeUndefined();
    expect(at(j, "b2cs")).toEqual([
      { sply_ty: "INTER", typ: "OE", pos: "27", rt: 0, txval: -1000, iamt: 0, csamt: 0 },
    ]);
    const j2 = api([note], {
      options: { originalInvoices: [{ document: original, period: "082024" }] },
    });
    expect(at(j2, "cdnur", 0)).toMatchObject({ typ: "B2CL", pos: "27" });
  });
  it("original b2cs → b2cs row reduced (credit) / increased (debit); negative net is emitted", () => {
    const original = mkDoc({
      number: "B2CS/1",
      date: "2026-10-01",
      recipient: unregMh,
      lines: [{ taxable: "500.00", rate: "0" }],
    });
    const note = (kind: "CREDIT_NOTE" | "DEBIT_NOTE", taxable: string, number: string) =>
      mkDoc({
        kind,
        number,
        recipient: unregMh,
        original: { number: "B2CS/1", date: "2026-10-01" },
        lines: [{ taxable, rate: "0" }],
      });
    const credit = list(api([original, note("CREDIT_NOTE", "200.00", "CN/1")]), "b2cs");
    expect(credit).toHaveLength(1);
    expect(at(credit, 0, "txval")).toBe(300);
    const debit = list(api([original, note("DEBIT_NOTE", "200.00", "DN/1")]), "b2cs");
    expect(at(debit, 0, "txval")).toBe(700);
    const negative = list(api([original, note("CREDIT_NOTE", "800.00", "CN/2")]), "b2cs");
    expect(at(negative, 0, "txval")).toBe(-300);
  });
  it("unregistered, original missing → ORIGINAL_NOT_FOUND", () => {
    expect(codes([unregNote("CREDIT_NOTE")])).toContain("ORIGINAL_NOT_FOUND");
  });
  it("original found by number but with another date is not found", () => {
    const o = b2clOrig();
    const n = mkDoc({
      kind: "CREDIT_NOTE",
      number: "CN/1",
      recipient: unregMh,
      original: { number: "B2CL/1", date: "2026-09-30" },
    });
    expect(codes([o, n])).toContain("ORIGINAL_NOT_FOUND");
  });
  it("note POS differs from the original's → NOTE_POS_MISMATCH", () => {
    const o = mkDoc({ number: "INV/0", date: "2026-10-01", recipient: parties.recipientMh });
    const n = mkDoc({
      kind: "CREDIT_NOTE",
      number: "CN/1",
      recipient: parties.recipientMh,
      pos: "29",
      original: { number: "INV/0", date: "2026-10-01" },
    });
    expect(codes([o, n])).toContain("NOTE_POS_MISMATCH");
    const ok = mkDoc({
      kind: "CREDIT_NOTE",
      number: "CN/1",
      recipient: parties.recipientMh,
      original: { number: "INV/0", date: "2026-10-01" },
    });
    expect(codes([o, ok])).not.toContain("NOTE_POS_MISMATCH");
  });
});

describe("preconditions", () => {
  it("another supplier → SUPPLIER_MISMATCH", () => {
    const supplier = { ...parties.supplier, gstin: GSTINS.spareKa };
    expect(codes([mkDoc({ supplier })])).toContain("SUPPLIER_MISMATCH");
  });
  it("a filer GSTIN that fails S5 #gstin → SUPPLIER_GSTIN_FORMAT", () => {
    // Derived from the registered synthetic GSTIN: the 14th character becomes W (not in S5's class).
    const bad = withCheck(`${FILER.slice(0, 13)}W`);
    const supplier = { ...parties.supplier, gstin: bad };
    const r = buildGstr1({ gstin: bad, period: PERIOD, documents: [mkDoc({ supplier })] });
    expect(r.ok ? [] : r.issues.map((i) => i.code)).toContain("SUPPLIER_GSTIN_FORMAT");
  });
  it("a recipient GSTIN that fails S5 #ctin → RECIPIENT_GSTIN_FORMAT", () => {
    const bad = withCheck(`${GSTINS.recipientKa.slice(0, 13)}W`);
    expect(codes([mkDoc({ recipient: partyWith(bad) })])).toContain("RECIPIENT_GSTIN_FORMAT");
  });
  it("synthetic UIN-shaped and TDS-shaped ctin values pass", () => {
    const uin = withCheck("2912ABC12345UN");
    const tds = withCheck("29AAAAB1234A1D");
    for (const g of [uin, tds]) {
      expect(codes([mkDoc({ recipient: partyWith(g) })])).toEqual([]);
    }
  });
  it("dates: 2017-06-30 and after the period end → DATE_OUT_OF_RANGE; boundaries and earlier periods are fine", () => {
    expect(codes([mkDoc({ date: "2017-06-30" })])).toContain("DATE_OUT_OF_RANGE");
    expect(codes([mkDoc({ date: "2026-11-01" })])).toContain("DATE_OUT_OF_RANGE");
    expect(codes([mkDoc({ date: "2026-10-31" })])).toEqual([]);
    expect(codes([mkDoc({ date: "2026-07-15" })])).toEqual([]);
    expect(codes([mkDoc({ date: "2017-07-01" })])).toEqual([]);
  });
  it("duplicate invoice numbers → DUPLICATE_DOCUMENT; an invoice and a note may share a number", () => {
    const a = mkDoc({ number: "X/1" });
    expect(codes([a, mkDoc({ number: "X/1", date: "2026-10-06" })])).toContain(
      "DUPLICATE_DOCUMENT",
    );
    const note = mkDoc({
      kind: "CREDIT_NOTE",
      number: "X/1",
      original: { number: "X/1", date: "2026-10-05" },
    });
    expect(codes([a, note])).toEqual([]);
    const n2 = { ...note };
    const dn = mkDoc({
      kind: "DEBIT_NOTE",
      number: "X/1",
      original: { number: "X/1", date: "2026-10-05" },
    });
    expect(codes([a, n2, dn])).toContain("DUPLICATE_DOCUMENT");
  });
  it("val 10000000000000.00 → AMOUNT_OUT_OF_RANGE", () => {
    const d = mkDoc({ lines: [{ taxable: "10000000000000.00", rate: "0", service: true }] });
    expect(codes([d])).toContain("AMOUNT_OUT_OF_RANGE");
    // val is in range here, but the item txval limit is 99 999 999 999.99
    const big = mkDoc({ lines: [{ taxable: "9999999999999.99", rate: "0", service: true }] });
    expect(codes([big])).toContain("AMOUNT_OUT_OF_RANGE");
    const fine = mkDoc({ lines: [{ taxable: "99999999999.99", rate: "0", service: true }] });
    expect(codes([fine])).toEqual([]);
  });
  it("issues are collected, not first-fail", () => {
    const bad = mkDoc({
      kind: "BILL_OF_SUPPLY",
      date: "2017-01-01",
      recipient: parties.unregistered,
      reverseCharge: true,
      lines: [{ taxable: "1000.00", rate: "0.5" }],
    });
    const c = codes([
      bad,
      mkDoc({ supplier: { ...parties.supplier, gstin: GSTINS.spareKa }, number: "Z/1" }),
    ]);
    for (const code of [
      "UNSUPPORTED_DOCUMENT",
      "DATE_OUT_OF_RANGE",
      "RATE_NOT_ACCEPTED",
      "SUPPLIER_MISMATCH",
    ]) {
      expect(c).toContain(code);
    }
  });
  it("issues carry the document number", () => {
    const r = build([mkDoc({ number: "Q/9", kind: "BILL_OF_SUPPLY" })]);
    const i: Gstr1Issue | undefined = r.ok ? undefined : r.issues[0];
    expect(i?.documentNumber).toBe("Q/9");
    expect(typeof i?.message).toBe("string");
  });
});

describe("classifyDocument (pure)", () => {
  it("classifies one document without building a return", () => {
    const c = classifyDocument(mkDoc(), { period: PERIOD, filer: FILER });
    expect(c).toMatchObject({ ok: true, section: "b2b" });
    const bad = classifyDocument(mkDoc({ kind: "BILL_OF_SUPPLY" }), {
      period: PERIOD,
      filer: FILER,
    });
    expect(bad.ok).toBe(false);
  });
  it("is deterministic and does not mutate its input", () => {
    const d = mkDoc();
    const before = JSON.stringify(d);
    const a = classifyDocument(d, { period: PERIOD, filer: FILER });
    const b = classifyDocument(d, { period: PERIOD, filer: FILER });
    expect(a).toEqual(b);
    expect(JSON.stringify(d)).toBe(before);
  });
});
