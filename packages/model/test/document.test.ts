import { describe, expect, it } from "vitest";
import { FIXTURE_NAMES, type FixtureName } from "@india-gst-kit/fixtures";
import { GstDocumentSchema, parseGstDocument } from "../src/index.js";
import { doc, expectIssueAt, expectValid, issuePaths } from "./helpers.js";

describe("valid documents", () => {
  it.each(FIXTURE_NAMES)("fixture %s parses", (name: FixtureName) => {
    expectValid(doc(name));
  });
  it("valid: intra tax invoice, inter, B2C, bill of supply, credit/debit notes, composition BoS + CN, UT place of supply, zero rate", () => {
    for (const n of [
      "intraInvoice",
      "interInvoice",
      "b2cInvoice",
      "billOfSupply",
      "creditNote",
      "debitNote",
      "compositionBillOfSupply",
      "compositionCreditNote",
      "utPlaceOfSupply",
      "zeroRateInvoice",
    ] as const) {
      expect(GstDocumentSchema.safeParse(doc(n)).success, n).toBe(true);
    }
  });
  it("an INTRA line is valid under either split convention", () => {
    expectValid(doc("b2cInvoice")); // remainder-to-sgst
    expectValid(doc("intraEqualHalves")); // equal-halves
  });
  it("applies defaults: supplyCategory DOMESTIC, reverseCharge false, address country IN", () => {
    const d = doc("intraInvoice");
    delete (d as { supplyCategory?: unknown }).supplyCategory;
    delete (d as { reverseCharge?: unknown }).reverseCharge;
    const r = parseGstDocument(d);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.supplyCategory).toBe("DOMESTIC");
      expect(r.data.reverseCharge).toBe(false);
      expect(r.data.supplier.address.country).toBe("IN");
      expect(r.data.totals.otherCharges).toBe("0.00");
    }
  });
  it("otherCharges and roundOff flow into grandTotal", () => {
    const d = doc("intraInvoice");
    d.totals.otherCharges = "10.50";
    d.totals.roundOff = "-0.50";
    d.totals.grandTotal = "1780.00";
    expectValid(d);
  });
  it("accepts a leap-day document date", () => {
    const d = doc("intraInvoice");
    d.date = "2028-02-29";
    expectValid(d);
    d.date = "2026-02-29";
    expectIssueAt(d, "date");
  });
  it("accepts very large values (15 integer digits, no overflow)", () => {
    const d = doc("interInvoice");
    d.lines = [
      {
        lineNo: 1,
        description: "Huge",
        hsnSac: "8471",
        isService: false,
        quantity: "800",
        unit: "NOS",
        unitPrice: "999999999999.00",
        grossAmount: "799999999999200.00",
        discount: "0.00",
        taxableValue: "799999999999200.00",
        gstRate: "18",
        cgst: "0.00",
        sgst: "0.00",
        igst: "143999999999856.00",
        cess: "0.00",
        lineTotal: "943999999999056.00",
      },
    ];
    d.totals = {
      taxableValue: "799999999999200.00",
      cgst: "0.00",
      sgst: "0.00",
      igst: "143999999999856.00",
      cess: "0.00",
      lineDiscount: "0.00",
      otherCharges: "0.00",
      roundOff: "0.00",
      grandTotal: "943999999999056.00",
    };
    expectValid(d);
  });
  it("reverse charge is a flag only; tax amounts are still validated", () => {
    expectValid(doc("reverseChargeInvoice"));
    const d = doc("reverseChargeInvoice");
    const l = d.lines[0];
    if (!l) throw new Error("no line");
    l.igst = "5.00";
    expectIssueAt(d, "lines.0.igst");
  });
});

describe("invalid documents — each asserts the issue path", () => {
  it("note without originalDocument", () => {
    const d = doc("creditNote");
    delete d.originalDocument;
    expectIssueAt(d, "originalDocument");
    const e = doc("debitNote");
    delete e.originalDocument;
    expectIssueAt(e, "originalDocument");
  });
  it("invoice / bill of supply with originalDocument", () => {
    const d = doc("intraInvoice");
    d.originalDocument = { number: "X1", date: "2026-04-01" };
    expectIssueAt(d, "originalDocument");
    const b = doc("billOfSupply");
    b.originalDocument = { number: "X1", date: "2026-04-01" };
    expectIssueAt(b, "originalDocument");
  });
  it("original date after the note date", () => {
    const d = doc("creditNote");
    d.originalDocument = { number: "INV/1", date: "2026-04-21" };
    expectIssueAt(d, "originalDocument.date");
  });
  it("original date equal to the note date is allowed", () => {
    const d = doc("creditNote");
    d.originalDocument = { number: "INV/1", date: d.date };
    expectValid(d);
  });
  it("IGST on an intra-state supply", () => {
    const d = doc("intraInvoice");
    const l = d.lines[0];
    if (!l) throw new Error("no line");
    Object.assign(l, { cgst: "0.00", sgst: "0.00", igst: "180.00" });
    expectIssueAt(d, "lines.0.igst");
  });
  it("CGST on an inter-state supply", () => {
    const d = doc("interInvoice");
    const l = d.lines[1];
    if (!l) throw new Error("no line");
    Object.assign(l, { cgst: "45.00", sgst: "45.00", igst: "0.00" });
    expectIssueAt(d, "lines.1.cgst");
  });
  it("same-state supply with SEZ/export category is treated as inter-state", () => {
    const d = doc("intraInvoice");
    d.supplyCategory = "SEZ_WITH_PAYMENT";
    expectIssueAt(d, "lines.0.cgst"); // CGST not allowed on SEZ supply
  });
  it("totals off by 0.01 (each field)", () => {
    for (const f of [
      "taxableValue",
      "cgst",
      "sgst",
      "igst",
      "cess",
      "lineDiscount",
      "grandTotal",
    ] as const) {
      const d = doc("intraInvoice");
      const cur = d.totals[f];
      const [i = "0", c = "00"] = cur.split(".");
      d.totals[f] = `${i}.${String(Number(c) + 1).padStart(2, "0")}`;
      expectIssueAt(d, `totals.${f}`);
    }
  });
  it("roundOff of 1.00 or more (either sign)", () => {
    const d = doc("intraInvoice");
    d.totals.roundOff = "1.00";
    d.totals.grandTotal = "1771.00";
    expectIssueAt(d, "totals.roundOff");
    d.totals.roundOff = "-1.00";
    d.totals.grandTotal = "1769.00";
    expectIssueAt(d, "totals.roundOff");
    d.totals.roundOff = "0.99";
    d.totals.grandTotal = "1770.99";
    expectValid(d);
  });
  it("otherCharges not reflected in grandTotal", () => {
    const d = doc("intraInvoice");
    d.totals.otherCharges = "10.00";
    expectIssueAt(d, "totals.grandTotal");
  });
  it("unknown top-level key (e.g. documentDiscount) is rejected, not silently dropped", () => {
    const d = { ...doc("intraInvoice"), documentDiscount: "10.00" };
    const r = GstDocumentSchema.safeParse(d);
    expect(r.success).toBe(false);
    const t = { ...doc("intraInvoice").totals, documentDiscount: "10.00" };
    expect(GstDocumentSchema.safeParse({ ...doc("intraInvoice"), totals: t }).success).toBe(false);
  });
  it("supplier without GSTIN", () => {
    const d = doc("intraInvoice");
    delete (d.supplier as { gstin?: string }).gstin;
    expectIssueAt(d, "supplier.gstin");
  });
  it("supplier registration type not allowed (UNREGISTERED / OVERSEAS)", () => {
    const d = doc("intraInvoice");
    (d.supplier as { registrationType: string }).registrationType = "UNREGISTERED";
    expectIssueAt(d, "supplier.registrationType");
  });
  it("GSTIN / state mismatch", () => {
    const d = doc("intraInvoice");
    d.supplier.stateCode = "27";
    d.supplier.address.stateCode = "27";
    expectIssueAt(d, "supplier.stateCode");
    const e = doc("intraInvoice");
    e.recipient.stateCode = "27";
    expectIssueAt(e, "recipient.stateCode");
  });
  it("address state differs from party state", () => {
    const d = doc("intraInvoice");
    d.recipient.address.stateCode = "27";
    expectIssueAt(d, "recipient.address.stateCode");
  });
  it("invalid GSTIN (bad check digit)", () => {
    const d = doc("intraInvoice");
    d.recipient.gstin = "29CCCCC2222C1Z5";
    expectIssueAt(d, "recipient.gstin");
  });
  it("recipient gstin ⇔ registered type", () => {
    const d = doc("intraInvoice");
    delete (d.recipient as { gstin?: string }).gstin;
    expectIssueAt(d, "recipient.gstin");
    const b = doc("b2cInvoice");
    b.recipient.gstin = "29CCCCC2222C1Z4";
    expectIssueAt(b, "recipient.registrationType");
  });
  it("composition supplier issuing a TAX_INVOICE", () => {
    const d = doc("compositionBillOfSupply");
    d.kind = "TAX_INVOICE";
    expectIssueAt(d, "kind");
  });
  it("composition supplier charging tax on a credit note", () => {
    const d = doc("compositionCreditNote");
    const l = d.lines[0];
    if (!l) throw new Error("no line");
    Object.assign(l, { igst: "10.00", lineTotal: "210.00" });
    d.totals.igst = "10.00";
    d.totals.grandTotal = "210.00";
    expectIssueAt(d, "lines.0.igst");
  });
  it("bill of supply with tax", () => {
    const d = doc("billOfSupply");
    const l = d.lines[0];
    if (!l) throw new Error("no line");
    Object.assign(l, { cgst: "18.00", sgst: "18.00", lineTotal: "236.00" });
    expectIssueAt(d, "lines.0.cgst");
  });
  it("same GSTIN on both sides", () => {
    const d = doc("intraInvoice");
    Object.assign(d.recipient, { gstin: d.supplier.gstin });
    expectIssueAt(d, "recipient.gstin");
  });
  it("non-contiguous lineNo", () => {
    const d = doc("intraInvoice");
    const l = d.lines[1];
    if (!l) throw new Error("no line");
    l.lineNo = 3;
    expectIssueAt(d, "lines.1.lineNo");
    const dup = doc("intraInvoice");
    const l2 = dup.lines[1];
    if (!l2) throw new Error("no line");
    l2.lineNo = 1;
    expectIssueAt(dup, "lines.1.lineNo");
  });
  it("empty lines", () => {
    const d = doc("intraInvoice");
    d.lines = [];
    expectIssueAt(d, "lines");
  });
  it("export/SEZ without payment with non-zero tax", () => {
    const d = doc("exportWithoutPayment");
    const l = d.lines[0];
    if (!l) throw new Error("no line");
    Object.assign(l, { igst: "180.00", lineTotal: "1180.00" });
    expectIssueAt(d, "lines.0.igst");
    const s = doc("sezWithoutPayment");
    const sl = s.lines[0];
    if (!sl) throw new Error("no line");
    Object.assign(sl, { igst: "180.00", lineTotal: "1180.00" });
    expectIssueAt(s, "lines.0.igst");
  });
  it("place of supply 25 (withdrawn) and unknown codes", () => {
    const d = doc("intraInvoice");
    d.placeOfSupply = "25";
    expectIssueAt(d, "placeOfSupply");
    d.placeOfSupply = "28";
    expectIssueAt(d, "placeOfSupply");
    d.placeOfSupply = "9";
    expectIssueAt(d, "placeOfSupply");
  });
  it("document number rules (≤16 chars, charset, no leading 0 / '/' / '-')", () => {
    for (const n of ["0001", "/ABC", "-ABC", "A".repeat(17), "INV 1", "", "INV#1"]) {
      const d = doc("intraInvoice");
      d.number = n;
      expectIssueAt(d, "number");
    }
    for (const n of ["1", "A", "INV/2026-27/0001", "A".repeat(16)]) {
      const d = doc("intraInvoice");
      d.number = n;
      expectValid(d);
    }
  });
  it("notes longer than 500 chars", () => {
    const d = doc("intraInvoice");
    d.notes = "x".repeat(501);
    expectIssueAt(d, "notes");
  });
  it("wrong schemaVersion", () => {
    const d = { ...doc("intraInvoice"), schemaVersion: "2" };
    expect(issuePaths(d)).toContain("schemaVersion");
  });
  it("issues are distinct: a doc with two faults reports both", () => {
    const d = doc("intraInvoice");
    d.totals.grandTotal = "1.00";
    d.supplier.stateCode = "27";
    const paths = issuePaths(d);
    expect(paths).toContain("totals.grandTotal");
    expect(paths).toContain("supplier.stateCode");
  });
});
