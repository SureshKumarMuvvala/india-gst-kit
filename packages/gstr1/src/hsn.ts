// Source: GST Offline Tool 3.2.4 (sources/gstr1/offline-tool/code-excerpts.md §3 hsn: row key hsn_sc + rt + uqc, services
//         "NA"/0, length 6 digits if AATO > ₹5 Cr else 4), Excel template V2.2 help rows 239–242
//         (sources/gstr1/excel-template-v2.2-help-excerpt.txt), S5 `#hsnamt` / `#hsnqty` (negatives allowed, qty multipleOf 0.01).
//         The B2B / B2C split is the owner's decision DEC-1: no source states it.
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
import type { GstDocument } from "@india-gst-kit/model";
import type { Placement } from "./classify.js";
import { D, fmt2, trimDecimal, type Dec } from "./decimal.js";
import type { HsnRow } from "./return-schema.js";
import { issue, type Gstr1Issue } from "./types.js";

export interface Placed {
  doc: GstDocument;
  placement: Placement;
}

interface Acc {
  code: string;
  uqc: string;
  rate: string;
  quantity: Dec;
  taxableValue: Dec;
  igst: Dec;
  cgst: Dec;
  sgst: Dec;
  cess: Dec;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Table 12 rows, split into B2B (documents with a GSTIN recipient: b2b, cdnr) and B2C (everything else). */
export function hsnRows(
  placed: readonly Placed[],
  aatoAbove5Cr: boolean,
): { b2b: HsnRow[]; b2c: HsnRow[]; issues: Gstr1Issue[] } {
  const issues: Gstr1Issue[] = [];
  const minDigits = aatoAbove5Cr ? 6 : 4;
  const buckets = { b2b: new Map<string, Acc>(), b2c: new Map<string, Acc>() };

  for (const { doc, placement } of placed) {
    const bucket =
      placement.section === "b2b" || placement.section === "cdnr" ? buckets.b2b : buckets.b2c;
    const sign = doc.kind === "CREDIT_NOTE" ? -1 : 1;
    doc.lines.forEach((line, i) => {
      if (line.hsnSac.length < minDigits) {
        issues.push(
          issue("HSN_LENGTH", `HSN/SAC ${line.hsnSac} needs at least ${minDigits} digits`, {
            documentNumber: doc.number,
            path: ["lines", i, "hsnSac"],
          }),
        );
      }
      const uqc = line.isService ? "NA" : (line.unit ?? "NA");
      const rate = trimDecimal(line.gstRate);
      const key = `${line.hsnSac}|${rate}|${uqc}`;
      let acc = bucket.get(key);
      if (acc === undefined) {
        const zero = new D(0);
        acc = {
          code: line.hsnSac,
          uqc,
          rate,
          quantity: zero,
          taxableValue: zero,
          igst: zero,
          cgst: zero,
          sgst: zero,
          cess: zero,
        };
        bucket.set(key, acc);
      }
      const signed = (s: string) => new D(s).mul(sign);
      if (!line.isService && line.quantity !== undefined)
        acc.quantity = acc.quantity.plus(signed(line.quantity));
      acc.taxableValue = acc.taxableValue.plus(signed(line.taxableValue));
      acc.igst = acc.igst.plus(signed(line.igst));
      acc.cgst = acc.cgst.plus(signed(line.cgst));
      acc.sgst = acc.sgst.plus(signed(line.sgst));
      acc.cess = acc.cess.plus(signed(line.cess));
    });
  }

  const finish = (name: "b2b" | "b2c"): HsnRow[] =>
    [...buckets[name].values()]
      .sort(
        (a, b) =>
          compare(a.code, b.code) || new D(a.rate).comparedTo(b.rate) || compare(a.uqc, b.uqc),
      )
      .map((a, i) => {
        if (!a.quantity.mul(100).isInteger()) {
          issues.push(
            issue(
              "QTY_PRECISION",
              `quantity ${a.quantity.toFixed()} of HSN ${a.code} is not a multiple of 0.01`,
              {
                path: ["hsn", name, i, "quantity"],
              },
            ),
          );
        }
        return {
          code: a.code,
          uqc: a.uqc,
          quantity: a.quantity.isZero() ? "0" : a.quantity.toFixed(),
          rate: a.rate,
          taxableValue: fmt2(a.taxableValue),
          igst: fmt2(a.igst),
          cgst: fmt2(a.cgst),
          sgst: fmt2(a.sgst),
          cess: fmt2(a.cess),
        };
      });

  return { b2b: finish("b2b"), b2c: finish("b2c"), issues };
}
