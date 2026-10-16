import { describe, expect, it } from "vitest";
import { computeLineTax, LineSchema, lineTaxIssues } from "../src/index.js";
import { doc, line } from "./helpers.js";

function lineInput(
  name: Parameters<typeof doc>[0] = "intraInvoice",
  i = 0,
): Record<string, unknown> {
  return structuredClone(doc(name).lines[i]) as unknown as Record<string, unknown>;
}
const failsAt = (input: unknown, path: string) => {
  const r = LineSchema.safeParse(input);
  expect(r.success).toBe(false);
  if (!r.success) expect(r.error.issues.map((i) => i.path.join("."))).toContain(path);
};

describe("LineSchema — structure", () => {
  it("accepts a goods line and a service line", () => {
    expect(LineSchema.safeParse(lineInput("intraInvoice", 0)).success).toBe(true);
    expect(LineSchema.safeParse(lineInput("intraInvoice", 1)).success).toBe(true);
  });
  it("applies defaults for discount, cessNonAdvol and cess", () => {
    const input = lineInput();
    delete input["discount"];
    delete input["cess"];
    const out = LineSchema.parse(input);
    expect(out.discount).toBe("0.00");
    expect(out.cess).toBe("0.00");
    expect(out.cessNonAdvol).toBe("0.00");
  });
  it("taxableValue must equal grossAmount − discount", () => {
    failsAt({ ...lineInput(), taxableValue: "999.99" }, "taxableValue");
    expect(
      LineSchema.safeParse({
        ...lineInput(),
        discount: "100.00",
        taxableValue: "900.00",
        lineTotal: "1062.00",
      }).success,
    ).toBe(false); // tax amounts no longer match lineTotal at 900 taxable
  });
  it("discount greater than grossAmount is rejected", () => {
    failsAt({ ...lineInput(), discount: "1000.01", taxableValue: "0.00" }, "discount");
  });
  it("allows a 100 % discount (zero taxable, zero tax)", () => {
    expect(
      LineSchema.safeParse({
        ...lineInput(),
        discount: "1000.00",
        taxableValue: "0.00",
        cgst: "0.00",
        sgst: "0.00",
        lineTotal: "0.00",
      }).success,
    ).toBe(true);
  });
  it("allows zero-value goods lines (zero quantity price)", () => {
    expect(
      LineSchema.safeParse({
        ...lineInput(),
        unitPrice: "0",
        grossAmount: "0.00",
        taxableValue: "0.00",
        cgst: "0.00",
        sgst: "0.00",
        lineTotal: "0.00",
      }).success,
    ).toBe(true);
  });
  it("a goods line without quantity is rejected", () => {
    const l = lineInput();
    delete l["quantity"];
    delete l["unit"];
    delete l["unitPrice"];
    failsAt(l, "quantity");
  });
  it("a service line needs no quantity", () => {
    expect(LineSchema.safeParse(lineInput("intraInvoice", 1)).success).toBe(true);
  });
  it("a service line with a non-99 SAC is rejected", () => {
    failsAt({ ...lineInput("intraInvoice", 1), hsnSac: "8471" }, "hsnSac");
  });
  it("unit without quantity is rejected; quantity without unit or unitPrice is rejected", () => {
    const noQty = lineInput("intraInvoice", 1);
    failsAt({ ...noQty, unit: "NOS" }, "unit");
    const l = lineInput();
    delete l["unit"];
    failsAt(l, "unit");
    const m = lineInput();
    delete m["unitPrice"];
    failsAt(m, "unitPrice");
  });
  it("unit must be an official UQC code", () => {
    failsAt({ ...lineInput(), unit: "XYZ" }, "unit");
  });
  it("grossAmount must equal round2(quantity × unitPrice)", () => {
    failsAt({ ...lineInput(), grossAmount: "1000.01", taxableValue: "1000.01" }, "grossAmount");
    // 3 × 33.333 = 99.999 → 100.00
    const r = LineSchema.safeParse({
      ...lineInput(),
      quantity: "3",
      unitPrice: "33.333",
      grossAmount: "100.00",
      taxableValue: "100.00",
      gstRate: "0",
      cgst: "0.00",
      sgst: "0.00",
      lineTotal: "100.00",
    });
    expect(r.success).toBe(true);
  });
  it("lineNo must be an integer ≥ 1", () => {
    failsAt({ ...lineInput(), lineNo: 0 }, "lineNo");
    failsAt({ ...lineInput(), lineNo: 1.5 }, "lineNo");
  });
  it("lineTotal must equal taxable + cgst + sgst + igst + cess", () => {
    failsAt({ ...lineInput(), lineTotal: "1180.01" }, "lineTotal");
  });
  it("|cgst − sgst| = 0.02 is rejected; 0.01 is accepted", () => {
    failsAt({ ...lineInput(), cgst: "91.00", sgst: "89.00", lineTotal: "1180.00" }, "sgst");
    const ok = LineSchema.safeParse({
      ...lineInput(),
      cgst: "90.01",
      sgst: "90.00",
      lineTotal: "1180.01",
    });
    expect(ok.success).toBe(true);
  });
  it("cgst/sgst and igst cannot both be non-zero", () => {
    failsAt({ ...lineInput(), igst: "10.00", lineTotal: "1190.00" }, "igst");
  });
  it("rejects unknown keys (so a dropped field can never go unnoticed)", () => {
    expect(LineSchema.safeParse({ ...lineInput(), surprise: 1 }).success).toBe(false);
  });
});

describe("lineTaxIssues — tax arithmetic by mode", () => {
  it("INTRA line is valid under remainder-to-sgst and under equal-halves", () => {
    expect(lineTaxIssues(line("b2cInvoice"), "INTRA")).toEqual([]); // 2.51 / 2.50
    expect(lineTaxIssues(line("intraEqualHalves"), "INTRA")).toEqual([]); // 2.50 / 2.50
  });
  it("both conventions produced by computeLineTax validate", () => {
    const base = line("b2cInvoice");
    for (const convention of ["remainder-to-sgst", "equal-halves"] as const) {
      const t = computeLineTax(base.taxableValue, base.gstRate, "INTRA", { convention });
      expect(lineTaxIssues({ ...base, ...t }, "INTRA")).toEqual([]);
    }
  });
  it("cgst + sgst off by 0.02 is rejected", () => {
    const l = line("intraInvoice");
    const issues = lineTaxIssues({ ...l, cgst: "90.01", sgst: "90.01" }, "INTRA");
    expect(issues.map((i) => i.field)).toContain("cgst");
  });
  it("INTRA with a non-zero igst is rejected", () => {
    const issues = lineTaxIssues({ ...line("intraInvoice"), igst: "180.00" }, "INTRA");
    expect(issues.map((i) => i.field)).toContain("igst");
  });
  it("INTER requires igst = T exactly and zero cgst/sgst", () => {
    const l = line("interInvoice");
    expect(lineTaxIssues(l, "INTER")).toEqual([]);
    expect(lineTaxIssues({ ...l, igst: "161.99" }, "INTER").map((i) => i.field)).toContain("igst");
    expect(lineTaxIssues({ ...l, cgst: "1.00" }, "INTER").map((i) => i.field)).toContain("cgst");
    expect(lineTaxIssues({ ...l, sgst: "1.00" }, "INTER").map((i) => i.field)).toContain("sgst");
  });
  it("ZERO mode requires every tax amount (incl. cess) to be zero while gstRate is kept", () => {
    const l = line("sezWithoutPayment");
    expect(l.gstRate).toBe("18");
    expect(lineTaxIssues(l, "ZERO")).toEqual([]);
    expect(lineTaxIssues({ ...l, cess: "1.00" }, "ZERO").map((i) => i.field)).toContain("cess");
    expect(lineTaxIssues({ ...l, igst: "1.00" }, "ZERO").map((i) => i.field)).toContain("igst");
  });
  it("cess = round2(taxable × cessRate / 100) + cessNonAdvol", () => {
    const l = line("cessInvoice");
    expect(l.cess).toBe("121.00");
    expect(lineTaxIssues(l, "INTRA")).toEqual([]);
    expect(lineTaxIssues({ ...l, cess: "120.00" }, "INTRA").map((i) => i.field)).toContain("cess");
    expect(lineTaxIssues({ ...l, cessNonAdvol: "2.00" }, "INTRA").map((i) => i.field)).toContain(
      "cess",
    );
  });
  it("without cessRate, cess must equal cessNonAdvol", () => {
    const l = line("intraInvoice");
    expect(lineTaxIssues({ ...l, cess: "1.00" }, "INTRA").map((i) => i.field)).toContain("cess");
    expect(lineTaxIssues({ ...l, cessNonAdvol: "1.00", cess: "1.00" }, "INTRA")).toEqual([]);
  });
  it("zero rate with zero tax is valid on INTRA and INTER", () => {
    const l = line("zeroRateInvoice");
    expect(lineTaxIssues(l, "INTRA")).toEqual([]);
    expect(lineTaxIssues(l, "INTER")).toEqual([]);
  });
});
