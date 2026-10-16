import { describe, expect, it } from "vitest";
import { GSTINS } from "@india-gst-kit/fixtures";
import { Gstr2bRecordSchema, parseGstr2bJson } from "../src/index.js";
import {
  codes,
  errorsOf,
  jsonText,
  parse,
  parseOk,
  raw,
  supplierBlock,
  wireFile,
  wireInvoice,
  wireItem,
  wireNote,
  type Obj,
  AMOUNT_KEYS,
  must,
  omit,
} from "./helpers.js";

const b2b = (inv: Obj, sup: Obj = {}): Obj => ({ b2b: [{ ...supplierBlock(sup), inv: [inv] }] });
const only = (value: ReturnType<typeof parseOk>) => {
  expect(value.records).toHaveLength(1);
  return must(value.records[0]);
};

describe("sections", () => {
  it("b2b invoice", () => {
    const r = only(parseOk(wireFile(b2b(wireInvoice()))));
    expect(r).toMatchObject({
      origin: "docdata",
      section: "b2b",
      returnPeriod: "042026",
      recipientGstin: GSTINS.recipientKa,
      documentType: "INVOICE",
      number: "INV/001",
      date: "2026-04-20",
      supplyType: "R",
      placeOfSupply: "29",
      reverseCharge: "N",
      amountsSource: "document",
      path: ["data", "docdata", "b2b", 0, "inv", 0],
    });
    expect(r.supplier).toEqual({
      gstin: GSTINS.supplierKa,
      tradeName: "Alpha Test Traders Private Limited",
      filingDate: "2026-05-11",
      filingPeriod: "042026",
    });
    expect(r.amounts).toEqual({
      value: "1180.00",
      taxableValue: "1000.00",
      igst: "0.00",
      cgst: "90.00",
      sgst: "90.00",
      cess: "0.00",
    });
    expect(r.original).toBeUndefined();
    expect(Gstr2bRecordSchema.safeParse(r).success).toBe(true);
  });

  it("b2ba amended invoice carries the original and is keyed on the new number", () => {
    const r = only(
      parseOk(
        wireFile({
          b2ba: [
            {
              ...supplierBlock(),
              inv: [wireInvoice({ oinum: "INV/000", oidt: "01-04-2026", isITCRevAmd: "Y" })],
            },
          ],
        }),
      ),
    );
    expect(r).toMatchObject({
      section: "b2ba",
      documentType: "INVOICE",
      number: "INV/001",
      date: "2026-04-20",
      original: { number: "INV/000", date: "2026-04-01" },
      itc: { isITCRevAmd: "Y" },
    });
  });

  it.each([
    ["C", "CREDIT_NOTE"],
    ["D", "DEBIT_NOTE"],
  ])("cdnr note typ %s → %s (supply type from suptyp, rev/pos optional)", (typ, documentType) => {
    const r = only(
      parseOk(
        wireFile({ cdnr: [{ ...supplierBlock(), nt: [wireNote({ typ, suptyp: "SEWP" })] }] }),
      ),
    );
    expect(r).toMatchObject({
      section: "cdnr",
      documentType,
      number: "CN/001",
      supplyType: "SEWP",
    });
    expect(r.placeOfSupply).toBeUndefined();
    expect(r.reverseCharge).toBeUndefined();
  });

  it("cdnra amended note", () => {
    const r = only(
      parseOk(
        wireFile({
          cdnra: [
            {
              ...supplierBlock(),
              nt: [wireNote({ typ: "D", onttyp: "C", ontnum: "CN/000", ontdt: "02-04-2026" })],
            },
          ],
        }),
      ),
    );
    expect(r).toMatchObject({
      section: "cdnra",
      documentType: "DEBIT_NOTE",
      original: { number: "CN/000", date: "2026-04-02", noteType: "C" },
    });
  });

  it("docRejdata records (txval required, no imsStatus, remarks allowed)", () => {
    const rej = {
      b2b: [
        {
          ...supplierBlock(),
          inv: [
            {
              inum: "R/1",
              typ: "R",
              dt: "20-04-2026",
              val: 118,
              pos: "29",
              txval: 100,
              igst: 18,
              remarks: "rejected by recipient",
            },
          ],
        },
      ],
      cdnr: [
        {
          ...supplierBlock(),
          nt: [{ ntnum: "RC/1", typ: "C", dt: "20-04-2026", val: 118, txval: 100, igst: 18 }],
        },
      ],
    };
    const v = parseOk(wireFile({}, { docRejdata: rej }));
    expect(v.records.map((r) => [r.origin, r.section, r.number])).toEqual([
      ["docRejdata", "b2b", "R/1"],
      ["docRejdata", "cdnr", "RC/1"],
    ]);
    expect(must(v.records[0]).itc).toEqual({ remarks: "rejected by recipient" });
    expect(must(v.records[0]).path).toEqual(["data", "docRejdata", "b2b", 0, "inv", 0]);
  });

  it("itcrev records (items only) in all four sections", () => {
    const items = [wireItem()];
    const doc = { dt: "20-04-2026", val: 1180, pos: "29", rev: "N", itcavl: "Y", items };
    const itcrev = {
      b2b: [{ ...supplierBlock(), inv: [{ inum: "I/1", typ: "R", ...doc }] }],
      b2ba: [
        {
          ...supplierBlock(),
          inv: [{ oinum: "I/0", oidt: "01-04-2026", inum: "I/2", typ: "R", ...doc }],
        },
      ],
      cdnr: [
        {
          ...supplierBlock(),
          nt: [{ ntnum: "N/1", typ: "C", dt: "20-04-2026", val: 1180, itcavl: "Y", items }],
        },
      ],
      cdnra: [
        {
          ...supplierBlock(),
          nt: [
            {
              onttyp: "C",
              ontnum: "N/0",
              ontdt: "01-04-2026",
              ntnum: "N/2",
              typ: "D",
              dt: "20-04-2026",
              val: 1180,
              itcavl: "Y",
              isITCRevAmd: "Y",
              items,
            },
          ],
        },
      ],
    };
    const v = parseOk(wireFile({ itcrev }));
    expect(v.records.map((r) => [r.origin, r.section, r.documentType, r.amountsSource])).toEqual([
      ["itcrev", "b2b", "INVOICE", "items"],
      ["itcrev", "b2ba", "INVOICE", "items"],
      ["itcrev", "cdnr", "CREDIT_NOTE", "items"],
      ["itcrev", "cdnra", "DEBIT_NOTE", "items"],
    ]);
    expect(must(v.records[0]).path).toEqual(["data", "docdata", "itcrev", "b2b", 0, "inv", 0]);
    expect(must(v.records[0]).amounts.taxableValue).toBe("1000.00");
  });

  it("docRejdata.itcrev is typed too, with its own origin", () => {
    const items = [wireItem()];
    const v = parseOk(
      wireFile(
        {},
        {
          docRejdata: {
            itcrev: {
              b2b: [
                {
                  ...supplierBlock(),
                  inv: [{ inum: "I/1", typ: "R", dt: "20-04-2026", val: 1180, pos: "29", items }],
                },
              ],
            },
          },
        },
      ),
    );
    expect(v.records.map((r) => [r.origin, r.section])).toEqual([["docRejdata.itcrev", "b2b"]]);
    expect(must(v.records[0]).itc).toEqual({});
  });

  it("orders records: docdata, docRejdata, itcrev; sections b2b, b2ba, cdnr, cdnra; then array order", () => {
    const items = [wireItem()];
    const v = parseOk(
      wireFile(
        {
          cdnr: [{ ...supplierBlock(), nt: [wireNote({ ntnum: "N/1" })] }],
          b2b: [
            { ...supplierBlock(), inv: [wireInvoice({ inum: "A" }), wireInvoice({ inum: "B" })] },
          ],
          itcrev: {
            b2b: [
              {
                ...supplierBlock(),
                inv: [
                  {
                    inum: "T",
                    typ: "R",
                    dt: "20-04-2026",
                    val: 1,
                    pos: "29",
                    rev: "N",
                    itcavl: "Y",
                    items,
                  },
                ],
              },
            ],
          },
        },
        {
          docRejdata: {
            b2b: [
              {
                ...supplierBlock(),
                inv: [{ inum: "J", typ: "R", dt: "20-04-2026", val: 1, pos: "29", txval: 1 }],
              },
            ],
          },
        },
      ),
    );
    expect(v.records.map((r) => r.number)).toEqual(["A", "B", "N/1", "J", "T"]);
  });

  it("keeps fileCount (fc) and the file header", () => {
    const v = parseOk(wireFile(b2b(wireInvoice()), { fc: 2 }));
    expect(v).toMatchObject({
      gstin: GSTINS.recipientKa,
      returnPeriod: "042026",
      version: "4.5",
      generatedOn: "2026-05-14",
      fileCount: "2",
    });
  });
});

describe("lossless numbers", () => {
  it("round-trips 9999999999999.99 and pads 1180 to 1180.00", () => {
    const r = only(
      parseOk(
        wireFile(
          b2b(
            wireInvoice({ val: raw("9999999999999.99"), txval: raw("1180"), igst: raw("1180.1") }),
          ),
        ),
      ),
    );
    expect(r.amounts).toMatchObject({
      value: "9999999999999.99",
      taxableValue: "1180.00",
      igst: "1180.10",
    });
  });

  it("accepts negative amounts structurally (source H has no minimum)", () => {
    const r = only(parseOk(wireFile(b2b(wireInvoice({ val: -50.5 })))));
    expect(r.amounts.value).toBe("-50.50");
  });

  it.each([
    ["1e3", "an exponent"],
    ["1180.001", "three decimals"],
    ["10000000000000.00", "above the maximum"],
  ])("rejects %s (%s) in a money field", (literal) => {
    const r = parse(wireFile(b2b(wireInvoice({ val: raw(literal) }))));
    expect(r.ok).toBe(false);
    expect(errorsOf(r.issues).map((i) => i.path.join("."))).toContain(
      "data.docdata.b2b.0.inv.0.val",
    );
  });

  it("a string in a number field is WRONG_TYPE", () => {
    const r = parse(wireFile(b2b(wireInvoice({ val: "1180.00" }))));
    expect(r.ok).toBe(false);
    expect(errorsOf(r.issues)).toEqual([
      expect.objectContaining({
        code: "WRONG_TYPE",
        path: ["data", "docdata", "b2b", 0, "inv", 0, "val"],
      }),
    ]);
  });

  it("a number in a string field is WRONG_TYPE", () => {
    const r = parse(wireFile(b2b(wireInvoice({ inum: 12 }))));
    expect(r.ok).toBe(false);
    expect(errorsOf(r.issues)).toEqual([
      expect.objectContaining({
        code: "WRONG_TYPE",
        path: ["data", "docdata", "b2b", 0, "inv", 0, "inum"],
      }),
    ]);
  });

  it("keeps item rate and number as written", () => {
    const r = only(
      parseOk(wireFile(b2b(wireInvoice({ items: [wireItem({ num: 3, rt: raw("2.50") })] })))),
    );
    expect(r.items).toEqual([
      {
        num: "3",
        rate: "2.50",
        taxableValue: "1000.00",
        igst: "0.00",
        cgst: "90.00",
        sgst: "90.00",
        cess: "0.00",
      },
    ]);
  });

  it("rate: 999.9 is the maximum, negative and 3 decimals are rejected", () => {
    const rt = (v: string) =>
      parse(wireFile(b2b(wireInvoice({ items: [wireItem({ rt: raw(v) })] })))).ok;
    expect(rt("999.9")).toBe(true);
    expect(rt("999.91")).toBe(false);
    expect(rt("-1")).toBe(false);
    expect(rt("1.005")).toBe(false);
  });
});

describe("dates and periods", () => {
  const dt = (v: string) => parse(wireFile(b2b(wireInvoice({ dt: v }))));
  it("accepts 29-02-2024 and outputs ISO", () => {
    const r = dt("29-02-2024");
    expect(r.ok).toBe(true);
    expect(r.value?.records[0]?.date).toBe("2024-02-29");
  });
  it.each(["29-02-2025", "31-04-2026", "32-01-2026", "2026-04-20", "00-01-2026", "20-13-2026", ""])(
    "rejects %j",
    (v) => {
      const r = dt(v);
      expect(r.ok).toBe(false);
      expect(errorsOf(r.issues).map((i) => i.path.at(-1))).toContain("dt");
    },
  );
  it("rejects period 132026 (rtnprd, supprd) and accepts 122026", () => {
    expect(parse(wireFile(b2b(wireInvoice()), { rtnprd: "132026" })).ok).toBe(false);
    expect(parse(wireFile(b2b(wireInvoice(), { supprd: "132026" }))).ok).toBe(false);
    expect(parse(wireFile(b2b(wireInvoice(), { supprd: "122026" }))).ok).toBe(true);
  });
  it("exposes supplier filing period as published", () => {
    expect(only(parseOk(wireFile(b2b(wireInvoice())))).supplier.filingPeriod).toBe("042026");
  });
});

describe("enums", () => {
  const inv = (over: Obj) => parse(wireFile(b2b(wireInvoice(over))));
  it.each(["Y", "N", "T"])("itcavl %s accepted", (v) => {
    expect(inv({ itcavl: v }).ok).toBe(true);
  });
  it("itcavl X rejected", () => {
    expect(inv({ itcavl: "X" }).ok).toBe(false);
  });
  it.each(["A", "R", "N"])("imsStatus %s accepted", (v) => {
    const r = inv({ imsStatus: v });
    expect(r.value?.records[0]?.itc.imsStatus).toBe(v);
  });
  it("imsStatus P rejected", () => {
    expect(inv({ imsStatus: "P" }).ok).toBe(false);
  });
  it.each([
    [0.65, "0.65"],
    [1, "1"],
  ])("diffprcnt %s accepted as %s", (v, out) => {
    expect(inv({ diffprcnt: v }).value?.records[0]?.itc.diffprcnt).toBe(out);
  });
  it.each([0.5, 0.6, 2, 0])("diffprcnt %s rejected", (v) => {
    expect(inv({ diffprcnt: v }).ok).toBe(false);
  });
  it("diffprcnt as a string is WRONG_TYPE", () => {
    expect(codes(errorsOf(inv({ diffprcnt: "0.65" }).issues))).toEqual(["WRONG_TYPE"]);
  });
  it.each(["R", "DE", "SEWP", "SEWOP", "SEZNAO", "SEZWPAO", "SEZWOPAO", "CBW"])(
    "invoice typ %s accepted and passed through raw",
    (v) => {
      expect(inv({ typ: v }).value?.records[0]?.supplyType).toBe(v);
    },
  );
  it("invoice typ XX rejected", () => {
    expect(inv({ typ: "XX" }).ok).toBe(false);
  });
  it.each(["C", "D"])("note typ %s accepted", (v) => {
    expect(parse(wireFile({ cdnr: [{ ...supplierBlock(), nt: [wireNote({ typ: v })] }] })).ok).toBe(
      true,
    );
  });
  it("note typ X rejected", () => {
    expect(
      parse(wireFile({ cdnr: [{ ...supplierBlock(), nt: [wireNote({ typ: "X" })] }] })).ok,
    ).toBe(false);
  });
  it.each(["R", "DE", "SEWP", "SEWOP", "CBW"])("note suptyp %s accepted; SEZNAO rejected", (v) => {
    expect(
      parse(wireFile({ cdnr: [{ ...supplierBlock(), nt: [wireNote({ suptyp: v })] }] })).ok,
    ).toBe(true);
    expect(
      parse(wireFile({ cdnr: [{ ...supplierBlock(), nt: [wireNote({ suptyp: "SEZNAO" })] }] })).ok,
    ).toBe(false);
  });
  it("isITCRevAmd accepts only Y", () => {
    const ba = (v: string) =>
      parse(
        wireFile({
          b2ba: [
            {
              ...supplierBlock(),
              inv: [wireInvoice({ oinum: "O/1", oidt: "01-04-2026", isITCRevAmd: v })],
            },
          ],
        }),
      ).ok;
    expect(ba("Y")).toBe(true);
    expect(ba("N")).toBe(false);
  });
  it("rev and pos", () => {
    expect(inv({ rev: "X" }).ok).toBe(false);
    expect(inv({ pos: "98" }).ok).toBe(false);
    expect(inv({ pos: "97" }).ok).toBe(true);
  });
});

describe("required fields (path asserted)", () => {
  const missing = (value: unknown, path: (string | number)[]) => {
    const r = parse(value);
    expect(r.ok).toBe(false);
    expect(errorsOf(r.issues).map((i) => i.path)).toContainEqual(path);
  };
  const drop = (o: Obj, k: string): Obj => omit(o, k);

  it("b2b inv", () => {
    for (const k of ["inum", "typ", "dt", "val", "pos", "rev", "itcavl"])
      missing(wireFile(b2b(drop(wireInvoice(), k))), ["data", "docdata", "b2b", 0, "inv", 0, k]);
  });
  it("b2ba inv", () => {
    const full = wireInvoice({ oinum: "O/1", oidt: "01-04-2026" });
    for (const k of ["oinum", "oidt", "inum", "typ", "dt", "val", "pos", "rev", "itcavl"])
      missing(wireFile({ b2ba: [{ ...supplierBlock(), inv: [drop(full, k)] }] }), [
        "data",
        "docdata",
        "b2ba",
        0,
        "inv",
        0,
        k,
      ]);
  });
  it("cdnr nt", () => {
    for (const k of ["ntnum", "typ", "dt", "val", "itcavl"])
      missing(wireFile({ cdnr: [{ ...supplierBlock(), nt: [drop(wireNote(), k)] }] }), [
        "data",
        "docdata",
        "cdnr",
        0,
        "nt",
        0,
        k,
      ]);
  });
  it("cdnra nt", () => {
    const full = wireNote({ onttyp: "C", ontnum: "O/1", ontdt: "01-04-2026" });
    for (const k of ["onttyp", "ontnum", "ontdt", "ntnum", "typ", "dt", "val", "itcavl"])
      missing(wireFile({ cdnra: [{ ...supplierBlock(), nt: [drop(full, k)] }] }), [
        "data",
        "docdata",
        "cdnra",
        0,
        "nt",
        0,
        k,
      ]);
  });
  it("supplier block, item and header", () => {
    for (const k of ["ctin", "supprd", "supfildt"])
      missing(wireFile({ b2b: [{ ...drop(supplierBlock(), k), inv: [wireInvoice()] }] }), [
        "data",
        "docdata",
        "b2b",
        0,
        k,
      ]);
    missing(wireFile({ b2b: [supplierBlock()] }), ["data", "docdata", "b2b", 0, "inv"]);
    for (const k of ["num", "rt", "txval"])
      missing(wireFile(b2b(wireInvoice({ items: [drop(wireItem(), k)] }))), [
        "data",
        "docdata",
        "b2b",
        0,
        "inv",
        0,
        "items",
        0,
        k,
      ]);
    missing(wireFile(b2b(wireInvoice()), { gstin: undefined }), ["data", "gstin"]);
    missing(wireFile(b2b(wireInvoice()), { rtnprd: undefined }), ["data", "rtnprd"]);
    missing({ data: (wireFile(b2b(wireInvoice())) as { data: unknown }).data }, ["chksum"]);
    missing({ chksum: "ABC" }, ["data"]);
  });
  it("docRejdata inv requires txval and pos", () => {
    const rej = { inum: "R/1", typ: "R", dt: "20-04-2026", val: 1, pos: "29", txval: 1 };
    for (const k of ["inum", "typ", "dt", "val", "pos", "txval"])
      missing(
        wireFile({}, { docRejdata: { b2b: [{ ...supplierBlock(), inv: [drop(rej, k)] }] } }),
        ["data", "docRejdata", "b2b", 0, "inv", 0, k],
      );
  });
});

describe("unknown keys", () => {
  it("at the root is an error", () => {
    const r = parse(wireFile(b2b(wireInvoice()), {}, { extra: 1 }));
    expect(r.ok).toBe(false);
    expect(r.issues).toContainEqual(
      expect.objectContaining({ code: "UNEXPECTED_KEY", severity: "error", path: ["extra"] }),
    );
  });
  it("in a record is a warning; the known keys still parse and raw keeps the key", () => {
    const r = parse(wireFile(b2b(wireInvoice({ novel: "x" }))));
    expect(r.ok).toBe(true);
    expect(r.issues).toContainEqual(
      expect.objectContaining({
        code: "UNEXPECTED_KEY",
        severity: "warning",
        path: ["data", "docdata", "b2b", 0, "inv", 0, "novel"],
      }),
    );
    expect(r.value?.records).toHaveLength(1);
    const rawInv = (r.raw as { data: { docdata: { b2b: { inv: Obj[] }[] } } }).data.docdata.b2b[0]
      ?.inv[0];
    expect(rawInv).toHaveProperty("novel", "x");
  });
  it("in data and in the supplier block is a warning", () => {
    const r = parse(wireFile(b2b(wireInvoice(), { newField: 1 }), { another: "x" }));
    expect(r.ok).toBe(true);
    expect(r.issues.map((i) => i.path.join("."))).toEqual(
      expect.arrayContaining(["data.another", "data.docdata.b2b.0.newField"]),
    );
  });
});

describe("GSTINs", () => {
  it("accepts a lower-case ctin and upper-cases it (raw keeps the published text)", () => {
    const r = parse(wireFile(b2b(wireInvoice(), { ctin: GSTINS.supplierKa.toLowerCase() })));
    expect(r.ok).toBe(true);
    expect(r.value?.records[0]?.supplier.gstin).toBe(GSTINS.supplierKa);
    expect(r.issues).toEqual([]);
    expect(jsonText(r.raw)).toContain(GSTINS.supplierKa.toLowerCase());
  });
  it("upper-cases the recipient GSTIN", () => {
    const r = parse(wireFile(b2b(wireInvoice()), { gstin: GSTINS.recipientKa.toLowerCase() }));
    expect(r.value?.gstin).toBe(GSTINS.recipientKa);
    expect(r.value?.records[0]?.recipientGstin).toBe(GSTINS.recipientKa);
  });
  it("accepts a non-resident (NR) ctin, with no check-digit issue", () => {
    const r = parse(wireFile(b2b(wireInvoice(), { ctin: "1234abc12345NRA" })));
    expect(r.ok).toBe(true);
    expect(r.value?.records[0]?.supplier.gstin).toBe("1234ABC12345NRA");
    expect(r.issues).toEqual([]);
  });
  it("an NR pattern is not allowed for the recipient gstin", () => {
    expect(parse(wireFile(b2b(wireInvoice()), { gstin: "1234ABC12345NRA" })).ok).toBe(false);
  });
  it("a wrong check digit is only an info CTIN_CHECK_DIGIT", () => {
    const bad = `${GSTINS.supplierKa.slice(0, 14)}Z`;
    const r = parse(wireFile(b2b(wireInvoice(), { ctin: bad })));
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: "CTIN_CHECK_DIGIT",
        severity: "info",
        path: ["data", "docdata", "b2b", 0, "ctin"],
      }),
    ]);
    expect(r.value?.records[0]?.supplier.gstin).toBe(bad);
  });
  it.each(["29AAAAA0000A1Z", "29AAAAA0000A0ZY", "29AAAAA0000A1KY", "2AAAAAA0000A1ZYY"])(
    "rejects %s (source H pattern)",
    (ctin) => {
      expect(parse(wireFile(b2b(wireInvoice(), { ctin }))).ok).toBe(false);
    },
  );
});

describe("amounts", () => {
  it("uses document level when txval is present (and ignores items for the amounts)", () => {
    const r = only(
      parseOk(
        wireFile(b2b(wireInvoice({ items: [wireItem({ txval: 1000, cgst: 90, sgst: 90 })] }))),
      ),
    );
    expect(r.amountsSource).toBe("document");
    expect(r.items).toHaveLength(1);
  });

  it("sums items when txval is absent; absent tax fields are 0.00", () => {
    const noTotals = omit(wireInvoice(), ...AMOUNT_KEYS);
    const r = only(
      parseOk(
        wireFile(
          b2b({
            ...noTotals,
            items: [
              { num: 1, rt: 18, txval: 600, cgst: 54, sgst: 54 },
              { num: 2, rt: 5, txval: 400.5, igst: 20.03, cess: 1 },
            ],
          }),
        ),
      ),
    );
    expect(r.amountsSource).toBe("items");
    expect(r.amounts).toEqual({
      value: "1180.00",
      taxableValue: "1000.50",
      igst: "20.03",
      cgst: "54.00",
      sgst: "54.00",
      cess: "1.00",
    });
    expect(r.items[0]).toEqual({
      num: "1",
      rate: "18",
      taxableValue: "600.00",
      cgst: "54.00",
      sgst: "54.00",
    });
  });

  it("absent document-level taxes with txval present count as 0.00", () => {
    const rest = omit(wireInvoice(), "igst", "cgst", "sgst", "cess");
    const r = only(parseOk(wireFile(b2b(rest))));
    expect(r.amounts).toMatchObject({ igst: "0.00", cgst: "0.00", sgst: "0.00", cess: "0.00" });
  });

  it("a mismatch between the levels is a warning ITEMS_TOTAL_MISMATCH; 2B is reported as published", () => {
    const r = parse(wireFile(b2b(wireInvoice({ items: [wireItem({ txval: 999.99 })] }))));
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: "ITEMS_TOTAL_MISMATCH",
        severity: "warning",
        path: ["data", "docdata", "b2b", 0, "inv", 0],
      }),
    ]);
    expect(r.value?.records[0]?.amounts.taxableValue).toBe("1000.00");
  });

  it("matching levels give no warning", () => {
    expect(parse(wireFile(b2b(wireInvoice({ items: [wireItem()] })))).issues).toEqual([]);
  });

  it("neither items nor txval is the error NO_AMOUNTS", () => {
    const bare = omit(wireInvoice(), ...AMOUNT_KEYS);
    const r = parse(wireFile(b2b(bare)));
    expect(r.ok).toBe(false);
    expect(r.value).toBeUndefined();
    expect(r.issues).toContainEqual(
      expect.objectContaining({
        code: "NO_AMOUNTS",
        severity: "error",
        path: ["data", "docdata", "b2b", 0, "inv", 0],
      }),
    );
  });

  it("ITC fields are copied verbatim", () => {
    const r = only(
      parseOk(
        wireFile({
          cdnr: [
            {
              ...supplierBlock(),
              nt: [
                wireNote({
                  itcavl: "N",
                  rsn: "P",
                  diffprcnt: 0.65,
                  imsStatus: "R",
                  itcRedReq: "Y",
                  declIgst: 1,
                  declCgst: 2.5,
                  declSgst: 3,
                  declCess: 0,
                  remarks: "note",
                }),
              ],
            },
          ],
        }),
      ),
    );
    expect(r.itc).toEqual({
      itcavl: "N",
      rsn: "P",
      diffprcnt: "0.65",
      imsStatus: "R",
      itcRedReq: "Y",
      declIgst: "1.00",
      declCgst: "2.50",
      declSgst: "3.00",
      declCess: "0.00",
      remarks: "note",
    });
  });
});

describe("invoice numbers (invnum)", () => {
  const num = (inum: string) => parse(wireFile(b2b(wireInvoice({ inum }))));
  it("accepts 0012 and a 16-character number", () => {
    expect(num("0012").value?.records[0]?.number).toBe("0012");
    expect(num("A".repeat(16)).ok).toBe(true);
  });
  it.each(["000", "A B", "A".repeat(17), "", "A_B"])("rejects %j", (v) => {
    expect(num(v).ok).toBe(false);
  });
});

describe("untyped sections", () => {
  it("are kept in raw and do not affect parsing", () => {
    const text = jsonText(
      wireFile(
        {
          ...b2b(wireInvoice()),
          isd: [{ anything: 1.5 }],
          isda: [],
          impg: [{ boe: "x", n: 2 }],
          impgsez: [],
          ecom: [{ x: 1 }],
          ecoma: [],
        },
        {
          itcsumm: { a: 1 },
          cpsumm: { b: [1, 2] },
          cpSummRej: { c: "x" },
          docRejdata: { isd: [{ y: 2 }] },
        },
      ),
    );
    const r = parseGstr2bJson(text);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.value?.records).toHaveLength(1);
    const raw = r.raw as { data: Obj };
    expect(raw.data).toHaveProperty("itcsumm", { a: 1 });
    expect((raw.data["docdata"] as Obj)["isd"]).toEqual([{ anything: 1.5 }]);
  });
});

describe("version and misc", () => {
  it("version 4.4 is a SCHEMA_VERSION warning, still parsed", () => {
    const r = parse(wireFile(b2b(wireInvoice()), { version: "4.4" }));
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([
      expect.objectContaining({ code: "SCHEMA_VERSION", severity: "warning" }),
    ]);
    expect(r.value?.version).toBe("4.4");
    expect(r.value?.records).toHaveLength(1);
  });
  it("version 4.5 gives no issue", () => {
    expect(parse(wireFile(b2b(wireInvoice()))).issues).toEqual([]);
  });
  it("an empty docdata gives a file with no records", () => {
    expect(parseOk(wireFile({})).records).toEqual([]);
  });
  it("bad JSON is BAD_JSON, never a throw", () => {
    const r = parseGstr2bJson("{");
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatchObject({ code: "BAD_JSON", severity: "error" });
    expect(r.value).toBeUndefined();
  });
  it("a non-object root is a schema error", () => {
    expect(parseGstr2bJson("[]").ok).toBe(false);
    expect(parseGstr2bJson("null").ok).toBe(false);
  });
  it("throws only on programmer errors", () => {
    expect(() => parseGstr2bJson(5 as unknown as string)).toThrow(TypeError);
  });
  it("raw is the JSON as published", () => {
    const r = parse(wireFile(b2b(wireInvoice())));
    expect((r.raw as { chksum: string }).chksum).toBe("SYNTHETICCHECKSUM1");
  });
});
