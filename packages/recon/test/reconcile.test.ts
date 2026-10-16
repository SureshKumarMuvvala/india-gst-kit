import { describe, expect, it } from "vitest";
import { gstr2bFixtureText } from "@india-gst-kit/fixtures";
import type { GstDocument } from "@india-gst-kit/model";
import {
  ReconResultSchema,
  parseGstr2bJson,
  reconcile,
  type Gstr2bRecord,
  type ReconResult,
} from "../src/index.js";
import { GSTINS, fixtures, file, invoiceDoc, must, record, regDoc, type Obj } from "./helpers.js";

const buckets = (r: ReconResult) =>
  ({
    matched: r.matched.length,
    matchedWithDifferences: r.matchedWithDifferences.length,
    possibleMatches: r.possibleMatches.length,
    in2bOnly: r.in2bOnly.length,
    inRegisterOnly: r.inRegisterOnly.length,
    excluded: r.excluded.length,
  }) as const;

const run = (
  docs: GstDocument[],
  records: Gstr2bRecord[],
  options?: { amountTolerance?: string },
) => reconcile(docs, file(records), options);

const amounts = (over: Partial<Gstr2bRecord["amounts"]>): Gstr2bRecord["amounts"] => ({
  ...record().amounts,
  ...over,
});

describe("exact match", () => {
  it("pairs a document with the record of the same key", () => {
    const r = run([invoiceDoc()], [record()]);
    expect(buckets(r)).toEqual({
      matched: 1,
      matchedWithDifferences: 0,
      possibleMatches: 0,
      in2bOnly: 0,
      inRegisterOnly: 0,
      excluded: 0,
    });
    expect(r.matched[0]).toMatchObject({
      register: {
        index: 0,
        supplierGstin: GSTINS.supplierKa,
        kind: "TAX_INVOICE",
        number: "INV/2026-27/0001",
        date: "2026-04-20",
      },
      differences: [],
    });
    expect(r.matched[0]?.gstr2b.path).toEqual(["data", "docdata", "b2b", 0, "inv", 0]);
    expect(r.options).toEqual({ amountTolerance: "0.00" });
    expect(ReconResultSchema.safeParse(r).success).toBe(true);
  });

  it("a number that differs only in case or surrounding whitespace is still matched", () => {
    const r = run([invoiceDoc()], [record({ number: "  inv/2026-27/0001 " })]);
    expect(buckets(r).matched).toBe(1);
  });

  it("compares the supplier GSTIN case-insensitively", () => {
    const r = run(
      [invoiceDoc()],
      [record({ supplier: { ...record().supplier, gstin: GSTINS.supplierKa.toLowerCase() } })],
    );
    expect(buckets(r).matched).toBe(1);
  });

  it("amendment records (b2ba) are matched on their new number and date", () => {
    const doc = invoiceDoc({ number: "INV/2026-27/001A", date: "2026-04-22" });
    const r = run(
      [doc],
      [
        record({
          section: "b2ba",
          number: "INV/2026-27/001A",
          date: "2026-04-22",
          original: { number: "INV/2026-27/0001", date: "2026-04-20" },
        }),
      ],
    );
    expect(buckets(r).matched).toBe(1);
  });

  it("credit notes match credit notes", () => {
    const cn = regDoc("creditNote");
    const r = run(
      [cn],
      [
        record({
          section: "cdnr",
          documentType: "CREDIT_NOTE",
          number: "CN/0001",
          amounts: {
            value: "1180.00",
            taxableValue: "1000.00",
            igst: "0.00",
            cgst: "90.00",
            sgst: "90.00",
            cess: "0.00",
          },
        }),
      ],
    );
    expect(buckets(r).matched).toBe(1);
  });
});

describe("amount differences", () => {
  const fields = ["value", "taxableValue", "igst", "cgst", "sgst", "cess"] as const;
  const base = record().amounts;

  it.each(fields)(
    "%s off by +0.01 and −0.01 → matchedWithDifferences with a signed difference",
    (f) => {
      for (const [delta, expected] of [
        [1, "0.01"],
        [-1, "-0.01"],
      ] as const) {
        // 135.00 → 135.01: work in cents to avoid any float arithmetic on the strings
        const cents = Math.round(Number(base[f]) * 100) + delta;
        const changed = (cents / 100).toFixed(2);
        // igst/cess are 0.00; −0.01 is allowed structurally (D4)
        const r = run([invoiceDoc()], [record({ amounts: amounts({ [f]: changed }) })]);
        expect(buckets(r)).toMatchObject({ matched: 0, matchedWithDifferences: 1 });
        expect(r.matchedWithDifferences[0]?.differences).toEqual([
          { field: f, register: base[f], gstr2b: changed, difference: expected },
        ]);
      }
    },
  );

  it("reports several fields at once", () => {
    const r = run(
      [invoiceDoc()],
      [record({ amounts: amounts({ cgst: "135.50", sgst: "134.00" }) })],
    );
    expect(r.matchedWithDifferences[0]?.differences.map((d) => [d.field, d.difference])).toEqual([
      ["cgst", "0.50"],
      ["sgst", "-1.00"],
    ]);
  });

  it("tolerance 1.00 turns a 0.01 difference into matched", () => {
    const r = run([invoiceDoc()], [record({ amounts: amounts({ cgst: "135.01" }) })], {
      amountTolerance: "1.00",
    });
    expect(buckets(r)).toMatchObject({ matched: 1, matchedWithDifferences: 0 });
    expect(r.matched[0]?.differences).toEqual([]);
    expect(r.options.amountTolerance).toBe("1.00");
  });

  it("the tolerance boundary is inclusive and applies per field", () => {
    const pass = run(
      [invoiceDoc()],
      [record({ amounts: amounts({ cgst: "136.00", sgst: "134.00" }) })],
      { amountTolerance: "1.00" },
    );
    expect(buckets(pass).matched).toBe(1);
    const fail = run([invoiceDoc()], [record({ amounts: amounts({ cgst: "136.01" }) })], {
      amountTolerance: "1.00",
    });
    expect(buckets(fail).matchedWithDifferences).toBe(1);
    expect(fail.matchedWithDifferences[0]?.differences.map((d) => d.field)).toEqual(["cgst"]);
  });

  it("only fields beyond the tolerance are listed", () => {
    const r = run(
      [invoiceDoc()],
      [record({ amounts: amounts({ cgst: "135.50", sgst: "140.00" }) })],
      { amountTolerance: "1.00" },
    );
    expect(r.matchedWithDifferences[0]?.differences.map((d) => d.field)).toEqual(["sgst"]);
  });

  it("rejects a malformed tolerance as a programmer error", () => {
    for (const bad of ["-1", "abc", "", "1e2"]) {
      expect(() => run([invoiceDoc()], [], { amountTolerance: bad })).toThrow(RangeError);
    }
  });
});

describe("place of supply and reverse charge", () => {
  it("differences are reported without a signed amount", () => {
    const r = run([invoiceDoc()], [record({ placeOfSupply: "27", reverseCharge: "Y" })]);
    expect(buckets(r).matchedWithDifferences).toBe(1);
    expect(r.matchedWithDifferences[0]?.differences).toEqual([
      { field: "placeOfSupply", register: "29", gstr2b: "27" },
      { field: "reverseCharge", register: "N", gstr2b: "Y" },
    ]);
    for (const d of r.matchedWithDifferences[0]?.differences ?? [])
      expect(d).not.toHaveProperty("difference");
  });

  it("are not compared when 2B (cdnr) omits them", () => {
    const r = run(
      [regDoc("creditNote", { reverseCharge: true })],
      [
        record(
          {
            section: "cdnr",
            documentType: "CREDIT_NOTE",
            number: "CN/0001",
            amounts: {
              value: "1180.00",
              taxableValue: "1000.00",
              igst: "0.00",
              cgst: "90.00",
              sgst: "90.00",
              cess: "0.00",
            },
          },
          ["placeOfSupply", "reverseCharge"],
        ),
      ],
    );
    expect(buckets(r).matched).toBe(1);
  });

  it("a reverse-charge register document compares as Y", () => {
    const r = run(
      [regDoc("reverseChargeInvoice")],
      [record({ number: "INV/2026-27/0007", reverseCharge: "Y" })],
    );
    expect(buckets(r).matched).toBe(1);
  });
});

describe("only buckets", () => {
  it("a record with no register document is in2bOnly, with no candidates", () => {
    const rec = record();
    const r = run([], [rec]);
    expect(r.in2bOnly).toEqual([{ record: rec, candidates: [] }]);
  });
  it("a register document with no record is inRegisterOnly, with no candidates", () => {
    const r = run([invoiceDoc()], []);
    expect(r.inRegisterOnly).toEqual([
      {
        register: {
          index: 0,
          supplierGstin: GSTINS.supplierKa,
          kind: "TAX_INVOICE",
          number: "INV/2026-27/0001",
          date: "2026-04-20",
        },
        candidates: [],
      },
    ]);
  });
  it("the same number from another supplier is no candidate", () => {
    const r = run(
      [invoiceDoc()],
      [record({ supplier: { ...record().supplier, gstin: GSTINS.spareKa } })],
    );
    expect(buckets(r)).toMatchObject({ in2bOnly: 1, inRegisterOnly: 1, possibleMatches: 0 });
    expect(r.in2bOnly[0]?.candidates).toEqual([]);
  });
});

describe("possible matches", () => {
  it("DATE_DIFFERS: same type and number, different date", () => {
    const r = run([invoiceDoc()], [record({ date: "2026-04-21" })]);
    expect(buckets(r)).toMatchObject({
      matched: 0,
      possibleMatches: 1,
      in2bOnly: 0,
      inRegisterOnly: 0,
    });
    expect(r.possibleMatches[0]?.reasons).toEqual(["DATE_DIFFERS"]);
    expect(r.possibleMatches[0]?.differences).toEqual([
      { field: "date", register: "2026-04-20", gstr2b: "2026-04-21" },
    ]);
  });

  it("TYPE_DIFFERS: same number and date, different document type", () => {
    const r = run(
      [regDoc("creditNote")],
      [
        record({
          section: "cdnr",
          documentType: "DEBIT_NOTE",
          number: "CN/0001",
          amounts: {
            value: "1180.00",
            taxableValue: "1000.00",
            igst: "0.00",
            cgst: "90.00",
            sgst: "90.00",
            cess: "0.00",
          },
        }),
      ],
    );
    expect(buckets(r)).toMatchObject({ matched: 0, possibleMatches: 1 });
    expect(r.possibleMatches[0]?.reasons).toEqual(["TYPE_DIFFERS"]);
    expect(r.possibleMatches[0]?.differences).toEqual([
      { field: "documentType", register: "CREDIT_NOTE", gstr2b: "DEBIT_NOTE" },
    ]);
  });

  it("a credit note and a debit note with the same number do not match exactly", () => {
    const r = run(
      [
        regDoc("debitNote", {
          recipient: regDoc("creditNote").recipient,
          placeOfSupply: "29",
          lines: regDoc("creditNote").lines,
          totals: regDoc("creditNote").totals,
        }),
      ],
      [record({ section: "cdnr", documentType: "CREDIT_NOTE", number: "DN/0001" })],
    );
    expect(r.matched).toHaveLength(0);
  });

  it("AMENDED_FROM: a b2ba record whose original is the register document", () => {
    const rec = record({
      section: "b2ba",
      number: "INV/2026-27/001A",
      date: "2026-05-02",
      original: { number: "inv/2026-27/0001", date: "2026-04-20" },
    });
    const r = run([invoiceDoc()], [rec]);
    expect(buckets(r)).toMatchObject({ possibleMatches: 1, matched: 0 });
    expect(r.possibleMatches[0]?.reasons).toEqual(["AMENDED_FROM"]);
    expect(r.possibleMatches[0]?.differences.map((d) => d.field)).toEqual(["number", "date"]);
  });

  it("AMENDED_FROM also covers cdnra", () => {
    const rec = record({
      section: "cdnra",
      documentType: "CREDIT_NOTE",
      number: "CN/0001A",
      date: "2026-05-02",
      original: { number: "CN/0001", date: "2026-04-20", noteType: "C" },
      amounts: {
        value: "1180.00",
        taxableValue: "1000.00",
        igst: "0.00",
        cgst: "90.00",
        sgst: "90.00",
        cess: "0.00",
      },
    });
    const r = run([regDoc("creditNote")], [rec]);
    expect(r.possibleMatches[0]?.reasons).toEqual(["AMENDED_FROM"]);
  });

  it("NUMBER_DIFFERS: same type, equal value and taxable value, same calendar month → suggested", () => {
    const r = run([invoiceDoc()], [record({ number: "INV/2026-27/0099", date: "2026-04-30" })]);
    expect(buckets(r)).toMatchObject({ possibleMatches: 1 });
    expect(r.possibleMatches[0]?.reasons).toEqual(["NUMBER_DIFFERS"]);
    expect(r.possibleMatches[0]?.differences.map((d) => d.field)).toEqual(["number", "date"]);
  });

  it("NUMBER_DIFFERS: next month → not suggested", () => {
    const r = run([invoiceDoc()], [record({ number: "INV/2026-27/0099", date: "2026-05-01" })]);
    expect(buckets(r)).toMatchObject({ possibleMatches: 0, in2bOnly: 1, inRegisterOnly: 1 });
  });

  it("NUMBER_DIFFERS: needs value and taxable value within tolerance", () => {
    const off = run(
      [invoiceDoc()],
      [record({ number: "INV/2026-27/0099", amounts: amounts({ value: "1770.01" }) })],
    );
    expect(buckets(off).possibleMatches).toBe(0);
    const within = run(
      [invoiceDoc()],
      [record({ number: "INV/2026-27/0099", amounts: amounts({ value: "1770.01" }) })],
      { amountTolerance: "0.01" },
    );
    expect(buckets(within).possibleMatches).toBe(1);
    // other tax heads may differ: they are listed, not disqualifying
    const taxOnly = run(
      [invoiceDoc()],
      [record({ number: "INV/2026-27/0099", amounts: amounts({ cgst: "136.00" }) })],
    );
    expect(taxOnly.possibleMatches[0]?.differences.map((d) => d.field)).toEqual(["cgst", "number"]);
  });

  it("NUMBER_LOOSE: INV/001 vs INV-1 is suggested — never matched, even with equal amounts", () => {
    const doc = invoiceDoc({ number: "INV/001" });
    const r = run([doc], [record({ number: "INV-1", date: "2026-07-01" })]);
    expect(buckets(r)).toMatchObject({ matched: 0, matchedWithDifferences: 0, possibleMatches: 1 });
    expect(r.possibleMatches[0]?.reasons).toEqual(["NUMBER_LOOSE"]);
    // same date and amounts, still only a suggestion (here NUMBER_DIFFERS applies as well)
    const same = run([doc], [record({ number: "INV-1" })]);
    expect(buckets(same)).toMatchObject({
      matched: 0,
      matchedWithDifferences: 0,
      possibleMatches: 1,
    });
    expect(same.possibleMatches[0]?.reasons).toEqual(["NUMBER_DIFFERS", "NUMBER_LOOSE"]);
  });

  it("an ambiguous candidate stays in the only buckets, with the candidates listed", () => {
    const d1 = invoiceDoc({ number: "INV/2026-27/0011" });
    const d2 = invoiceDoc({ number: "INV/2026-27/0012" });
    const rec = record({ number: "INV/2026-27/0099" });
    const r = run([d1, d2], [rec]);
    expect(buckets(r)).toMatchObject({ possibleMatches: 0, in2bOnly: 1, inRegisterOnly: 2 });
    expect(r.in2bOnly[0]?.candidates.map((c) => c.number)).toEqual([
      "INV/2026-27/0011",
      "INV/2026-27/0012",
    ]);
    expect(r.inRegisterOnly.map((x) => x.candidates)).toEqual([
      [{ returnPeriod: "042026", path: rec.path }],
      [{ returnPeriod: "042026", path: rec.path }],
    ]);
  });

  it("is also ambiguous the other way round (one document, two records)", () => {
    const r = run(
      [invoiceDoc()],
      [record({ number: "INV/2026-27/0098" }), record({ number: "INV/2026-27/0099" })],
    );
    expect(buckets(r)).toMatchObject({ possibleMatches: 0, in2bOnly: 2, inRegisterOnly: 1 });
    expect(r.inRegisterOnly[0]?.candidates).toHaveLength(2);
    expect(r.in2bOnly.map((x) => x.candidates.length)).toEqual([1, 1]);
  });

  it("only pass-1 leftovers are candidates (an exact pair is never reused)", () => {
    const r = run([invoiceDoc(), invoiceDoc({ number: "INV/2026-27/0099" })], [record()]);
    expect(buckets(r)).toMatchObject({ matched: 1, inRegisterOnly: 1, possibleMatches: 0 });
  });
});

describe("duplicates", () => {
  it("a duplicate in the register is a warning and the extra copy is unmatched", () => {
    const r = run([invoiceDoc(), invoiceDoc()], [record()]);
    expect(buckets(r)).toMatchObject({ matched: 1, inRegisterOnly: 1 });
    expect(r.matched[0]?.register.index).toBe(0);
    expect(r.inRegisterOnly[0]?.register.index).toBe(1);
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: "DUPLICATE_IN_REGISTER",
        severity: "warning",
        path: ["register", 1],
      }),
    ]);
  });
  it("a duplicate in 2B is a warning and the extra copy is unmatched", () => {
    const a = record();
    const b = record({ path: ["data", "docdata", "b2b", 0, "inv", 1] });
    const r = run([invoiceDoc()], [a, b]);
    expect(buckets(r)).toMatchObject({ matched: 1, in2bOnly: 1 });
    expect(r.in2bOnly[0]?.record.path).toEqual(b.path);
    expect(r.issues).toEqual([
      expect.objectContaining({ code: "DUPLICATE_IN_2B", severity: "warning", path: b.path }),
    ]);
  });
  it("duplicates on both sides pair copy-for-copy, in order", () => {
    const r = run(
      [invoiceDoc(), invoiceDoc()],
      [record(), record({ path: ["data", "docdata", "b2b", 0, "inv", 1] })],
    );
    expect(buckets(r)).toMatchObject({ matched: 2, inRegisterOnly: 0, in2bOnly: 0 });
    expect(r.matched.map((p) => p.register.index)).toEqual([0, 1]);
    expect(r.issues.map((i) => i.code)).toEqual(["DUPLICATE_IN_REGISTER", "DUPLICATE_IN_2B"]);
  });
});

describe("excluded register documents", () => {
  it("recipient GSTIN different from the 2B GSTIN", () => {
    const r = run([regDoc("interInvoice")], []);
    expect(r.excluded.map((e) => [e.register.index, e.register.kind, e.reason])).toEqual([
      [0, "TAX_INVOICE", "NOT_OUR_PURCHASE"],
    ]);
    expect(buckets(r).inRegisterOnly).toBe(0);
  });
  it("recipient without a GSTIN", () => {
    const r = run([regDoc("b2cInvoice")], []);
    expect(r.excluded.map((e) => e.reason)).toEqual(["NOT_OUR_PURCHASE"]);
  });
  it("bill of supply", () => {
    const r = run([regDoc("billOfSupply")], []);
    expect(r.excluded.map((e) => e.reason)).toEqual(["KIND_NOT_IN_2B_SECTIONS"]);
  });
  it("a document for another recipient is excluded even if a 2B record shares its key", () => {
    const r = run([regDoc("interInvoice")], [record({ number: "INV/2026-27/0002" })]);
    expect(buckets(r)).toMatchObject({ excluded: 1, matched: 0, in2bOnly: 1 });
  });
  it("the recipient GSTIN is compared case-insensitively", () => {
    const r = reconcile(
      [invoiceDoc()],
      file([record()], { gstin: GSTINS.recipientKa.toLowerCase() }),
    );
    expect(buckets(r).matched).toBe(1);
  });
});

describe("several 2B files", () => {
  it("files with different recipient GSTINs → RECIPIENT_MISMATCH and no reconciliation", () => {
    const r = reconcile(
      [invoiceDoc()],
      [file([record()]), file([record()], { gstin: GSTINS.spareKa })],
    );
    expect(r.issues).toEqual([
      expect.objectContaining({ code: "RECIPIENT_MISMATCH", severity: "error" }),
    ]);
    expect(buckets(r)).toEqual({
      matched: 0,
      matchedWithDifferences: 0,
      possibleMatches: 0,
      in2bOnly: 0,
      inRegisterOnly: 0,
      excluded: 0,
    });
  });

  it("periods are concatenated and each record keeps its returnPeriod", () => {
    const apr = file([record()]);
    const may = file(
      [record({ returnPeriod: "052026", number: "INV/2026-27/0002", date: "2026-05-03" })],
      { returnPeriod: "052026" },
    );
    const r = reconcile(
      [
        invoiceDoc(),
        invoiceDoc({ number: "INV/2026-27/0002", date: "2026-05-03" }),
        invoiceDoc({ number: "INV/2026-27/0003" }),
      ],
      [apr, may],
    );
    expect(buckets(r)).toMatchObject({ matched: 2, inRegisterOnly: 1 });
    expect(r.matched.map((p) => p.gstr2b.returnPeriod)).toEqual(["042026", "052026"]);
  });

  it("unmatched records of several files keep file order", () => {
    const f1 = file([record({ number: "A/1" })]);
    const f2 = file([record({ number: "B/1", returnPeriod: "052026" })], {
      returnPeriod: "052026",
    });
    const r = reconcile([], [f2, f1]);
    expect(r.in2bOnly.map((x) => x.record.number)).toEqual(["B/1", "A/1"]);
  });

  it("no file at all: nothing to filter on, every purchase is register-only", () => {
    const r = reconcile([invoiceDoc(), regDoc("billOfSupply")], []);
    expect(buckets(r)).toMatchObject({ inRegisterOnly: 1, excluded: 1 });
  });

  it("a single file need not be wrapped in an array", () => {
    expect(buckets(reconcile([invoiceDoc()], file([record()]))).matched).toBe(1);
  });
});

describe("ITC neutrality", () => {
  const variants: [string, Partial<Gstr2bRecord>][] = [
    ["itcavl N", { itc: { itcavl: "N", rsn: "P" } }],
    ["itcavl T", { itc: { itcavl: "T" } }],
    ["imsStatus R", { itc: { itcavl: "Y", imsStatus: "R" } }],
    ["diffprcnt", { itc: { itcavl: "Y", diffprcnt: "0.65" } }],
    ["docRejdata", { origin: "docRejdata" }],
    ["itcrev", { origin: "itcrev" }],
    ["docRejdata.itcrev", { origin: "docRejdata.itcrev" }],
    ["isITCRevAmd", { itc: { itcavl: "Y", isITCRevAmd: "Y", remarks: "x" } }],
  ];
  const scenarios: [string, GstDocument[], (over: Partial<Gstr2bRecord>) => Gstr2bRecord[]][] = [
    ["exact", [invoiceDoc()], (o) => [record(o)]],
    [
      "differences",
      [invoiceDoc()],
      (o) => [record({ ...o, amounts: amounts({ cgst: "136.00" }) })],
    ],
    ["possible", [invoiceDoc()], (o) => [record({ ...o, date: "2026-04-21" })]],
    ["2b only", [], (o) => [record(o)]],
    ["register only", [invoiceDoc()], () => []],
  ];
  it.each(scenarios)(
    "%s: flipping ITC fields or origin never changes a bucket",
    (_n, docs, make) => {
      const base = run(docs, make({}));
      for (const [name, over] of variants) {
        const r = run(docs, make(over));
        expect(buckets(r), name).toEqual(buckets(base));
        expect(r.issues, name).toEqual(base.issues);
      }
    },
  );

  it("the itc fields and origin come out byte-identical", () => {
    const itc = {
      itcavl: "N",
      rsn: "P",
      diffprcnt: "0.65",
      imsStatus: "R",
      itcRedReq: "Y",
      declIgst: "1.00",
      remarks: "r",
      isITCRevAmd: "Y",
    } as const;
    const rec = record({ origin: "itcrev", itc });
    for (const docs of [[invoiceDoc()], []]) {
      const r = run(docs, [rec]);
      const out = [...r.matched, ...r.matchedWithDifferences, ...r.possibleMatches]
        .map((p) => p.gstr2b)
        .concat(r.in2bOnly.map((x) => x.record))[0];
      expect(JSON.stringify(out?.itc)).toBe(JSON.stringify(rec.itc));
      expect(out?.origin).toBe("itcrev");
    }
  });

  it("no output key is named like eligible or claimable", () => {
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (typeof v === "object" && v !== null)
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          walk(x);
        }
    };
    walk(run([invoiceDoc(), regDoc("billOfSupply")], [record(), record({ number: "X/1" })]));
    expect([...keys].filter((k) => /eligib|claim|allow/i.test(k))).toEqual([]);
  });
});

describe("invariants and order", () => {
  const registerFromFixtures = Object.keys(fixtures).map((n) => regDoc(n as keyof typeof fixtures));
  const parsed = parseGstr2bJson(gstr2bFixtureText);

  function checkInvariant(docs: GstDocument[], files: ReturnType<typeof file>[], r: ReconResult) {
    const registerSeen = [
      ...r.matched.map((p) => p.register.index),
      ...r.matchedWithDifferences.map((p) => p.register.index),
      ...r.possibleMatches.map((p) => p.register.index),
      ...r.inRegisterOnly.map((x) => x.register.index),
      ...r.excluded.map((x) => x.register.index),
    ].sort((a, b) => a - b);
    expect(registerSeen).toEqual(docs.map((_d, i) => i));
    const recordKeys = (rec: Gstr2bRecord) => `${rec.returnPeriod}|${JSON.stringify(rec.path)}`;
    const seen = [
      ...r.matched.map((p) => recordKeys(p.gstr2b)),
      ...r.matchedWithDifferences.map((p) => recordKeys(p.gstr2b)),
      ...r.possibleMatches.map((p) => recordKeys(p.gstr2b)),
      ...r.in2bOnly.map((x) => recordKeys(x.record)),
    ].sort();
    expect(seen).toEqual(files.flatMap((f) => f.records.map(recordKeys)).sort());
  }

  it("the fixture 2B file parses cleanly and matches the fixture documents exactly", () => {
    expect(parsed.issues).toEqual([]);
    const r = reconcile(registerFromFixtures, must(parsed.value));
    expect(buckets(r)).toMatchObject({
      matched: 6,
      matchedWithDifferences: 0,
      possibleMatches: 0,
      in2bOnly: 0,
    });
    checkInvariant(registerFromFixtures, [must(parsed.value)], r);
    // excluded: other recipients, B2C, exports, bill of supply, composition supplier docs…
    expect(r.excluded.length + r.matched.length + r.inRegisterOnly.length).toBe(
      registerFromFixtures.length,
    );
  });

  it("every document and record is in exactly one bucket, over 300 seeded perturbations", () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const base = must(parsed.value);
    for (let iter = 0; iter < 300; iter++) {
      const docs = registerFromFixtures.filter(() => rnd(4) !== 0);
      if (rnd(3) === 0 && docs[0] !== undefined) docs.push(docs[0]); // duplicate
      const records = base.records
        .filter(() => rnd(5) !== 0)
        .map((rec): Gstr2bRecord => {
          switch (rnd(7)) {
            case 0:
              return { ...rec, date: "2026-04-21" };
            case 1:
              return { ...rec, number: `${rec.number}9` };
            case 2:
              return { ...rec, amounts: { ...rec.amounts, cgst: "1.00" } };
            case 3:
              return {
                ...rec,
                documentType: rec.documentType === "INVOICE" ? "CREDIT_NOTE" : "INVOICE",
              };
            case 4:
              return { ...rec, supplier: { ...rec.supplier, gstin: GSTINS.spareKa } };
            default:
              return rec;
          }
        });
      if (rnd(3) === 0 && records[0] !== undefined)
        records.push({ ...records[0], path: [...records[0].path.slice(0, -1), 99] });
      const f = file(records, {});
      const tol = rnd(2) === 0 ? "0.00" : "1.00";
      const r = reconcile(docs, f, { amountTolerance: tol });
      checkInvariant(docs, [f], r);
      expect(ReconResultSchema.safeParse(r).success).toBe(true);
    }
  });

  it("output order is deterministic: register order for pairs, 2B order for leftovers", () => {
    const docs = [
      invoiceDoc({ number: "INV/2026-27/0030" }),
      invoiceDoc({ number: "INV/2026-27/0010" }),
      invoiceDoc({ number: "INV/2026-27/0020" }),
    ];
    const recs = [
      record({ number: "INV/2026-27/0020" }),
      record({ number: "INV/2026-27/0010" }),
      record({ number: "Z/9", date: "2026-08-01" }),
      record({ number: "A/1", date: "2026-08-02" }),
    ];
    const a = run(docs, recs);
    const b = run(structuredClone(docs), structuredClone(recs));
    expect(a).toEqual(b);
    expect(a.matched.map((p) => p.register.index)).toEqual([1, 2]);
    expect(a.in2bOnly.map((x) => x.record.number)).toEqual(["Z/9", "A/1"]);
    expect(a.inRegisterOnly.map((x) => x.register.index)).toEqual([0]);
  });

  it("does not mutate its inputs", () => {
    const docs = [invoiceDoc()];
    const f = file([record()]);
    const before = JSON.stringify([docs, f]);
    reconcile(docs, f);
    expect(JSON.stringify([docs, f])).toBe(before);
  });

  it("throws only on programmer errors", () => {
    expect(() => reconcile({} as unknown as GstDocument[], file([]))).toThrow(TypeError);
    expect(() => reconcile([], "x" as unknown as Obj as never)).toThrow(TypeError);
  });
});
