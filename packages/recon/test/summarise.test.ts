import { describe, expect, it } from "vitest";
import { reconcile, summarise } from "../src/index.js";
import { file, invoiceDoc, record, regDoc } from "./helpers.js";

describe("summarise", () => {
  it("counts per bucket and totals the signed differences per field as decimal strings", () => {
    const docs = [
      invoiceDoc(),
      invoiceDoc({ number: "INV/2026-27/0002" }),
      invoiceDoc({ number: "INV/2026-27/0003" }),
      invoiceDoc({ number: "INV/2026-27/0004" }),
      regDoc("billOfSupply"),
    ];
    const a = record().amounts;
    const r = reconcile(
      docs,
      file([
        record(),
        record({ number: "INV/2026-27/0002", amounts: { ...a, cgst: "136.50", sgst: "134.00" } }),
        record({ number: "INV/2026-27/0003", amounts: { ...a, cgst: "140.00" } }),
        record({
          number: "INV/2026-27/0003",
          date: "2026-04-21",
          amounts: { ...a, cgst: "135.25" },
        }),
        record({ number: "ONLY/1", date: "2026-09-01" }),
      ]),
    );
    expect(summarise(r)).toEqual({
      counts: {
        matched: 1,
        matchedWithDifferences: 2,
        possibleMatches: 1,
        in2bOnly: 1,
        inRegisterOnly: 0,
        excluded: 1,
      },
      differenceTotals: {
        value: "0.00",
        taxableValue: "0.00",
        igst: "0.00",
        cgst: "6.75",
        sgst: "-1.00",
        cess: "0.00",
      },
    });
  });

  it("sums the amount differences of possible matches too, and ignores non-amount differences", () => {
    const r = reconcile(
      [invoiceDoc()],
      file([record({ date: "2026-04-21", amounts: { ...record().amounts, value: "1771.00" } })]),
    );
    expect(r.possibleMatches).toHaveLength(1);
    expect(summarise(r).differenceTotals.value).toBe("1.00");
  });

  it("reports no ITC figures", () => {
    expect(Object.keys(summarise(reconcile([], file([])))).sort()).toEqual([
      "counts",
      "differenceTotals",
    ]);
  });
});
