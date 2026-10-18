// Source: items are one per distinct rate (Excel template help row 388; T keys items by rate), amounts the documents'
//         own line amounts summed (DEC-5); inter-state items carry IGST, intra-state CGST + SGST (the model's
//         decideTaxSplit, T §4). Spec §4.
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
import { decideTaxSplit, type GstDocument } from "@india-gst-kit/model";
import { D, fmt2, trimDecimal, type Dec } from "./decimal.js";
import type { ExportItemSchema, Item } from "./return-schema.js";
import type { z } from "zod";

export type ExportItem = z.infer<typeof ExportItemSchema>;

export const sum = (xs: readonly string[], sign = 1): Dec =>
  xs.reduce((a, x) => a.plus(new D(x).mul(sign)), new D(0));

/** One item per distinct rate, in order of first appearance. `igstOnly` for sections S5 restricts to iamt/csamt. */
export function itemsOf(doc: GstDocument, igstOnly: boolean): Item[] {
  const inter =
    igstOnly ||
    decideTaxSplit(doc.supplier.stateCode, doc.placeOfSupply, doc.supplyCategory) === "INTER";
  const byRate = new Map<string, GstDocument["lines"]>();
  for (const line of doc.lines) {
    const rate = trimDecimal(line.gstRate);
    byRate.set(rate, [...(byRate.get(rate) ?? []), line]);
  }
  return [...byRate].map(([rate, lines]) => {
    const f = (k: "taxableValue" | "igst" | "cgst" | "sgst" | "cess") =>
      fmt2(sum(lines.map((l) => l[k])));
    return inter
      ? { rate, taxableValue: f("taxableValue"), igst: f("igst"), cess: f("cess") }
      : {
          rate,
          taxableValue: f("taxableValue"),
          cgst: f("cgst"),
          sgst: f("sgst"),
          cess: f("cess"),
        };
  });
}

export function exportItemsOf(doc: GstDocument): ExportItem[] {
  return itemsOf(doc, true).map((i) => ({
    rate: i.rate,
    taxableValue: i.taxableValue,
    igst: i.igst ?? "0.00",
    cess: i.cess,
  }));
}
