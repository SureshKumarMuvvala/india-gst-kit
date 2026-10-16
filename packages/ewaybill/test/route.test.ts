import { describe, expect, it } from "vitest";
import { ewbRoute } from "../src/index.js";
import { fixtures, parseDoc, parsed, variant } from "./helpers.js";

const on = { supplierEInvoiceEnabled: true };

describe("ewbRoute", () => {
  it("B2B tax invoice, e-invoice enabled, dated 2020-10-01 → IRN; 2020-09-30 → GENERATE", () => {
    expect(ewbRoute(variant("intraInvoice", { date: "2020-10-01" }), on).route).toBe("IRN");
    expect(ewbRoute(variant("intraInvoice", { date: "2020-09-30" }), on)).toEqual({
      route: "GENERATE",
      reasons: [],
    });
  });
  it("export with e-invoice enabled → IRN", () => {
    expect(ewbRoute(parsed("exportWithoutPayment"), on).route).toBe("IRN");
  });
  it("B2C, or a bill of supply, with e-invoice enabled → GENERATE", () => {
    expect(ewbRoute(parsed("b2cInvoice"), on).route).toBe("GENERATE");
    expect(ewbRoute(parsed("compositionBillOfSupply"), on).route).toBe("GENERATE");
    expect(ewbRoute(parsed("billOfSupply"), on).route).toBe("GENERATE");
  });
  it("e-invoice not enabled → GENERATE, no reasons", () => {
    expect(ewbRoute(parsed("intraInvoice"), { supplierEInvoiceEnabled: false })).toEqual({
      route: "GENERATE",
      reasons: [],
    });
  });
  it("unknown e-invoice status → GENERATE plus an EINVOICE_STATUS_UNKNOWN warning", () => {
    for (const o of [undefined, {}]) {
      const r = ewbRoute(parsed("intraInvoice"), o);
      expect(r.route).toBe("GENERATE");
      expect(r.reasons).toHaveLength(1);
      expect(r.reasons[0]).toMatchObject({ code: "EINVOICE_STATUS_UNKNOWN", severity: "warning" });
    }
  });
  it("no warning when the IRN conditions do not hold anyway", () => {
    expect(ewbRoute(parsed("b2cInvoice")).reasons).toEqual([]);
    expect(ewbRoute(variant("intraInvoice", { date: "2020-09-30" })).reasons).toEqual([]);
  });
  it("credit and debit notes → NONE", () => {
    for (const name of ["creditNote", "debitNote", "compositionCreditNote"] as const) {
      const r = ewbRoute(parsed(name), on);
      expect(r.route, name).toBe("NONE");
      expect(r.reasons[0]).toMatchObject({ code: "NOT_EWB_DOCUMENT", severity: "error" });
    }
  });
  it("every line a service → NONE; one goods line is enough", () => {
    const source = fixtures.intraInvoice;
    const services = parseDoc({
      ...source,
      lines: [{ ...source.lines[1], lineNo: 1 }],
      totals: {
        ...source.totals,
        taxableValue: "500.00",
        cgst: "45.00",
        sgst: "45.00",
        grandTotal: "590.00",
      },
    });
    expect(ewbRoute(services).route).toBe("NONE");
    expect(ewbRoute(parsed("intraInvoice"), { supplierEInvoiceEnabled: false }).route).toBe(
      "GENERATE",
    );
  });
});
