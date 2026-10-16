import { describe, expect, it } from "vitest";
import { buildGstr1, type DocIssueSeries } from "../src/index.js";
import {
  FILER,
  GSTINS,
  PERIOD,
  api,
  build,
  codes,
  mkDoc,
  offline,
  parties,
  unregMh,
  at,
  list,
  rec,
} from "./helpers.js";

describe("items and aggregation", () => {
  it("3 lines at 18% plus 1 at 5% → items 1801 and 501 with summed values", () => {
    const j = api([
      mkDoc({
        lines: [
          { taxable: "1000.00", rate: "18" },
          { taxable: "1000.00", rate: "18" },
          { taxable: "1000.00", rate: "18" },
          { taxable: "1000.00", rate: "5" },
        ],
      }),
    ]);
    const inv = at(j, "b2b", 0, "inv", 0);
    expect(at(inv, "itms")).toEqual([
      { num: 1801, itm_det: { txval: 3000, rt: 18, camt: 270, samt: 270, csamt: 0 } },
      { num: 501, itm_det: { txval: 1000, rt: 5, camt: 25, samt: 25, csamt: 0 } },
    ]);
    expect(at(inv, "val")).toBe(4590);
  });
  it("rate 0.25 → num 26; rate 0 → num 1; 7.5 → 751", () => {
    const j = api([
      mkDoc({
        lines: [
          { taxable: "1000.00", rate: "0.25" },
          { taxable: "1000.00", rate: "0" },
          { taxable: "1000.00", rate: "7.5" },
        ],
      }),
    ]);
    expect(list(j, "b2b", 0, "inv", 0, "itms").map((i) => at(i, "num"))).toEqual([26, 1, 751]);
  });
  it("inter items have iamt only", () => {
    const j = api([mkDoc({ recipient: parties.recipientMh })]);
    const det = at(j, "b2b", 0, "inv", 0, "itms", 0, "itm_det");
    expect(det).toEqual({ txval: 1000, rt: 18, iamt: 180, csamt: 0 });
    expect("camt" in rec(det)).toBe(false);
    expect("samt" in rec(det)).toBe(false);
  });
  it("a UT place of supply puts UTGST in samt", () => {
    const supplier = {
      ...parties.supplier,
      gstin: GSTINS.spareCh,
      stateCode: "04",
      address: { ...parties.supplier.address, stateCode: "04" },
    };
    const doc = mkDoc({ supplier, recipient: parties.recipientCh, pos: "04" });
    const r = buildGstr1({ gstin: GSTINS.spareCh, period: PERIOD, documents: [doc] });
    expect(r.ok).toBe(true);
    expect(doc.lines[0]?.sgst).toBe("90.00");
    const out = api([doc], { gstin: GSTINS.spareCh });
    expect(at(out, "b2b", 0, "inv", 0, "itms", 0, "itm_det")).toEqual({
      txval: 1000,
      rt: 18,
      camt: 90,
      samt: 90,
      csamt: 0,
    });
  });
  it("val is grandTotal, including roundOff and otherCharges", () => {
    const j = api([mkDoc({ roundOff: "0.40", otherCharges: "10.00" })]);
    expect(at(j, "b2b", 0, "inv", 0, "val")).toBe(1190.4);
  });
  it("b2cs rows merge by (sply_ty, pos, rt, typ) and are ordered by pos then rt", () => {
    const mk = (
      n: string,
      rate: string,
      recipient: Record<string, unknown> = parties.unregistered,
      taxable = "1000.00",
    ) => mkDoc({ number: n, recipient, lines: [{ taxable, rate }] });
    const j = api([
      mk("A/1", "18"),
      mk("A/2", "5"),
      mk("A/3", "18", parties.unregistered, "500.00"),
      mk("A/4", "18", unregMh),
    ]);
    expect(at(j, "b2cs")).toEqual([
      { sply_ty: "INTER", typ: "OE", pos: "27", rt: 18, txval: 1000, iamt: 180, csamt: 0 },
      { sply_ty: "INTRA", typ: "OE", pos: "29", rt: 5, txval: 1000, camt: 25, samt: 25, csamt: 0 },
      {
        sply_ty: "INTRA",
        typ: "OE",
        pos: "29",
        rt: 18,
        txval: 1500,
        camt: 135,
        samt: 135,
        csamt: 0,
      },
    ]);
  });
  it("odd-paisa sums are exact", () => {
    const line = { taxable: "0.05", rate: "18" };
    const j = api([mkDoc({ lines: [line, line, line] })]);
    const det = at(j, "b2b", 0, "inv", 0, "itms", 0, "itm_det");
    expect(det).toEqual({ txval: 0.15, rt: 18, camt: 0.03, samt: 0, csamt: 0 });
  });
  it("groups and documents keep the input order of first appearance", () => {
    const j = api([
      mkDoc({ number: "A/1", recipient: parties.recipientMh }),
      mkDoc({ number: "A/2", recipient: parties.recipientKa }),
      mkDoc({ number: "A/3", recipient: parties.recipientMh }),
    ]);
    expect(list(j, "b2b").map((g) => at(g, "ctin"))).toEqual([
      GSTINS.recipientMh,
      GSTINS.recipientKa,
    ]);
    expect(list(j, "b2b", 0, "inv").map((i) => at(i, "inum"))).toEqual(["A/1", "A/3"]);
  });
  it("b2cl groups by pos", () => {
    const big = (n: string, recipient: typeof unregMh) =>
      mkDoc({
        number: n,
        recipient,
        pos: String(recipient["stateCode"]),
        lines: [{ taxable: "150000.00", rate: "0" }],
      });
    const j = api([big("B/1", unregMh), big("B/2", unregMh)]);
    expect(at(j, "b2cl")).toHaveLength(1);
    expect(at(j, "b2cl", 0, "inv")).toHaveLength(2);
  });
});

describe("hsn", () => {
  const line = (taxable: string, o: Record<string, unknown> = {}) => ({ taxable, ...o });
  it("b2b and cdnr lines go to hsn_b2b; b2cl/b2cs/cdnur/exp lines go to hsn_b2c", () => {
    const orig = { number: "INV/0", date: "2026-10-01" };
    const j = api([
      mkDoc({ number: "R/1", lines: [line("1000.00", { hsn: "1001" })] }),
      mkDoc({
        number: "R/2",
        kind: "CREDIT_NOTE",
        original: orig,
        lines: [line("100.00", { hsn: "1002" })],
      }),
      mkDoc({
        number: "C/1",
        recipient: unregMh,
        lines: [line("150000.00", { hsn: "2001", rate: "0" })],
      }),
      mkDoc({
        number: "C/2",
        recipient: parties.unregistered,
        lines: [line("1000.00", { hsn: "2002" })],
      }),
      mkDoc({
        number: "E/1",
        recipient: parties.overseas,
        category: "EXPORT_WITH_PAYMENT",
        pos: "96",
        lines: [line("1000.00", { hsn: "2003" })],
      }),
      mkDoc({
        number: "E/2",
        kind: "CREDIT_NOTE",
        recipient: parties.overseas,
        category: "EXPORT_WITH_PAYMENT",
        pos: "96",
        original: orig,
        lines: [line("100.00", { hsn: "2004" })],
      }),
    ]);
    expect(list(j, "hsn", "hsn_b2b").map((r) => at(r, "hsn_sc"))).toEqual(["1001", "1002"]);
    expect(list(j, "hsn", "hsn_b2c").map((r) => at(r, "hsn_sc"))).toEqual([
      "2001",
      "2002",
      "2003",
      "2004",
    ]);
  });
  it("same (hsn, rt, uqc) → one row; a different rate → two rows; num is 1..n sorted", () => {
    const j = api([
      mkDoc({
        lines: [
          line("1000.00", { hsn: "8471", qty: "10", rate: "18" }),
          line("500.00", { hsn: "8471", qty: "5", rate: "18" }),
          line("200.00", { hsn: "8471", qty: "2", rate: "5" }),
          line("100.00", { hsn: "1001", qty: "1", rate: "5" }),
        ],
      }),
    ]);
    expect(at(j, "hsn", "hsn_b2b")).toEqual([
      {
        num: 1,
        hsn_sc: "1001",
        uqc: "NOS",
        qty: 1,
        rt: 5,
        txval: 100,
        iamt: 0,
        camt: 2.5,
        samt: 2.5,
        csamt: 0,
      },
      {
        num: 2,
        hsn_sc: "8471",
        uqc: "NOS",
        qty: 2,
        rt: 5,
        txval: 200,
        iamt: 0,
        camt: 5,
        samt: 5,
        csamt: 0,
      },
      {
        num: 3,
        hsn_sc: "8471",
        uqc: "NOS",
        qty: 15,
        rt: 18,
        txval: 1500,
        iamt: 0,
        camt: 135,
        samt: 135,
        csamt: 0,
      },
    ]);
    expect(at(j, "hsn", "hsn_b2c")).toBeUndefined();
  });
  it("a different unit makes a different row", () => {
    const j = api([
      mkDoc({
        lines: [
          line("100.00", { hsn: "8471", qty: "1", unit: "NOS" }),
          line("100.00", { hsn: "8471", qty: "1", unit: "KGS" }),
        ],
      }),
    ]);
    expect(list(j, "hsn", "hsn_b2b").map((r) => at(r, "uqc"))).toEqual(["KGS", "NOS"]);
  });
  it('a service → uqc "NA" and qty 0', () => {
    const j = api([mkDoc({ lines: [line("500.00", { service: true })] })]);
    expect(at(j, "hsn", "hsn_b2b", 0)).toMatchObject({ hsn_sc: "998313", uqc: "NA", qty: 0 });
  });
  it("credit notes subtract and debit notes add", () => {
    const orig = { number: "INV/0", date: "2026-10-01" };
    const j = api([
      mkDoc({ number: "A/1", lines: [line("1000.00", { qty: "10" })] }),
      mkDoc({
        number: "C/1",
        kind: "CREDIT_NOTE",
        original: orig,
        lines: [line("200.00", { qty: "2" })],
      }),
      mkDoc({
        number: "D/1",
        kind: "DEBIT_NOTE",
        original: orig,
        lines: [line("50.00", { qty: "1" })],
      }),
    ]);
    expect(at(j, "hsn", "hsn_b2b")).toEqual([
      {
        num: 1,
        hsn_sc: "8471",
        uqc: "NOS",
        qty: 9,
        rt: 18,
        txval: 850,
        iamt: 0,
        camt: 76.5,
        samt: 76.5,
        csamt: 0,
      },
    ]);
  });
  it("no val and no desc are emitted", () => {
    const row = rec(api([mkDoc()]), "hsn", "hsn_b2b", 0);
    expect("val" in row).toBe(false);
    expect("desc" in row).toBe(false);
    expect("user_desc" in row).toBe(false);
  });
  it("aatoAbove5Cr with a 4-digit HSN → HSN_LENGTH", () => {
    const doc = mkDoc({ lines: [line("1000.00", { hsn: "8471" })] });
    expect(codes([doc])).toEqual([]);
    expect(codes([doc], { options: { aatoAbove5Cr: true } })).toContain("HSN_LENGTH");
    const six = mkDoc({ lines: [line("1000.00", { hsn: "847130" })] });
    expect(codes([six], { options: { aatoAbove5Cr: true } })).toEqual([]);
  });
  it("a quantity of 1.005 → QTY_PRECISION", () => {
    const doc = mkDoc({ lines: [line("1005.00", { qty: "1.005", unitPrice: "1000.000" })] });
    expect(codes([doc])).toContain("QTY_PRECISION");
  });
  it("a period with no lines → no hsn key", () => {
    const j = api([]);
    expect("hsn" in j).toBe(false);
  });
});

describe("doc_issue", () => {
  const orig = { number: "INV/0", date: "2026-10-01" };
  const docs = () => [
    mkDoc({ number: "A/2", date: "2026-10-03" }),
    mkDoc({ number: "A/1", date: "2026-10-02" }),
    mkDoc({ number: "A/3", date: "2026-10-03" }),
    mkDoc({ number: "A/0", date: "2026-07-15" }), // earlier period: not counted
    mkDoc({ number: "D/1", date: "2026-10-04", kind: "DEBIT_NOTE", original: orig }),
    mkDoc({ number: "C/1", date: "2026-10-04", kind: "CREDIT_NOTE", original: orig }),
    mkDoc({ number: "C/2", date: "2026-10-05", kind: "CREDIT_NOTE", original: orig }),
  ];
  it("(a) doc_det_new with string doc_num 1, 4, 5", () => {
    const j = api(docs());
    expect(at(j, "doc_issue")).toEqual({
      doc_det_new: [
        {
          doc_num: "1",
          doc_typ: "Invoices for outward supply",
          docs: [{ num: 1, from: "A/1", to: "A/3", totnum: 3, cancel: 0, net_issue: 3 }],
        },
        {
          doc_num: "4",
          doc_typ: "Debit Note",
          docs: [{ num: 1, from: "D/1", to: "D/1", totnum: 1, cancel: 0, net_issue: 1 }],
        },
        {
          doc_num: "5",
          doc_typ: "Credit Note",
          docs: [{ num: 1, from: "C/1", to: "C/2", totnum: 2, cancel: 0, net_issue: 2 }],
        },
      ],
    });
  });
  it("(b) doc_det with integer doc_num 1, 4, 5 and the same series", () => {
    const j = offline(docs());
    const a = list(api(docs()), "doc_issue", "doc_det_new");
    const b = list(j, "doc_issue", "doc_det");
    expect(b.map((e) => at(e, "doc_num"))).toEqual([1, 4, 5]);
    expect(b.map((e) => ({ ...rec(e), doc_num: String(at(e, "doc_num")) }))).toEqual(a);
    expect(at(j, "doc_issue", "doc_det_new")).toBeUndefined();
  });
  it("only earlier-period documents → no doc_issue", () => {
    expect(api([mkDoc({ date: "2026-07-15" })])["doc_issue"]).toBeUndefined();
  });
  it("the override replaces the derivation", () => {
    const j = api(docs(), {
      options: {
        docIssue: [
          { type: "TAX_INVOICE", from: "A/1", to: "A/10", total: 10, cancelled: 2, netIssued: 8 },
        ],
      },
    });
    expect(at(j, "doc_issue")).toEqual({
      doc_det_new: [
        {
          doc_num: "1",
          doc_typ: "Invoices for outward supply",
          docs: [{ num: 1, from: "A/1", to: "A/10", totnum: 10, cancel: 2, net_issue: 8 }],
        },
      ],
    });
  });
  it("several override series of one type are numbered 1..n", () => {
    const j = api([], {
      options: {
        docIssue: [
          { type: "TAX_INVOICE", from: "A/1", to: "A/5", total: 5, cancelled: 0, netIssued: 5 },
          { type: "TAX_INVOICE", from: "B/1", to: "B/5", total: 5, cancelled: 0, netIssued: 5 },
        ],
      },
    });
    expect(list(j, "doc_issue", "doc_det_new", 0, "docs").map((d) => at(d, "num"))).toEqual([1, 2]);
  });
  it.each([
    ["cancel > totnum", { total: 1, cancelled: 2, netIssued: 0 }],
    ["net_issue ≠ totnum − cancel", { total: 5, cancelled: 1, netIssued: 5 }],
    ["from not matching #inum", { from: "!bad", total: 1, cancelled: 0, netIssued: 1 }],
    ["a non-integer count", { total: 1.5, cancelled: 0, netIssued: 1.5 }],
    ["a count above 9999999999", { total: 10000000000, cancelled: 0, netIssued: 10000000000 }],
    ["a negative count", { total: 1, cancelled: -1, netIssued: 2 }],
  ] as [string, Partial<DocIssueSeries>][])(
    "override with %s → DOC_ISSUE_INVALID",
    (_name, patch) => {
      const series: DocIssueSeries = {
        type: "TAX_INVOICE",
        from: "A/1",
        to: "A/9",
        total: 9,
        cancelled: 0,
        netIssued: 9,
        ...patch,
      };
      expect(codes([], { options: { docIssue: [series] } })).toContain("DOC_ISSUE_INVALID");
    },
  );
});

describe("build result", () => {
  it("reports the classification of every document", () => {
    const r = build([
      mkDoc({ number: "A/1" }),
      mkDoc({ number: "A/2", recipient: parties.unregistered }),
    ]);
    expect(r.ok && r.classification).toEqual([
      { kind: "TAX_INVOICE", number: "A/1", section: "b2b" },
      { kind: "TAX_INVOICE", number: "A/2", section: "b2cs" },
    ]);
  });
  it("never throws on data problems", () => {
    expect(() => buildGstr1({ gstin: "nope", period: "xx", documents: [mkDoc()] })).not.toThrow();
    const r = buildGstr1({ gstin: FILER, period: PERIOD, documents: [] });
    expect(r.ok).toBe(true);
  });
});
