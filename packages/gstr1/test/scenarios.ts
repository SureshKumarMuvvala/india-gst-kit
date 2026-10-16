import type { Gstr1Input } from "../src/index.js";
import { mkDoc, parties, unregMh, type DocSpec } from "./helpers.js";
import type { GstDocument } from "@india-gst-kit/model";

/** A mixed synthetic period (102026): b2b intra/inter, SEZ, b2cl, b2cs, export, cdnr, cdnur B2CL, b2cs credit note. */
export function goldenDocs(): GstDocument[] {
  const L = (taxable: string, o: Record<string, unknown> = {}) => ({ taxable, ...o });
  return [
    mkDoc({
      number: "INV/G1",
      date: "2026-10-02",
      lines: [
        L("1000.00", { hsn: "8471", qty: "10" }),
        L("500.00", { service: true }),
        L("200.00", { hsn: "1001", qty: "4", rate: "5" }),
      ],
    }),
    mkDoc({
      number: "INV/G2",
      date: "2026-10-03",
      recipient: parties.recipientMh,
      reverseCharge: true,
      lines: [L("2000.00", { hsn: "8471", qty: "4", rate: "12" })],
    }),
    mkDoc({
      number: "INV/G3",
      date: "2026-10-04",
      recipient: parties.sezUnit,
      category: "SEZ_WITH_PAYMENT",
      lines: [L("3000.00", { hsn: "8471", qty: "3" })],
    }),
    mkDoc({
      number: "INV/G4",
      date: "2026-10-04",
      recipient: parties.sezUnit,
      category: "SEZ_WITHOUT_PAYMENT",
      lines: [L("1000.00", { hsn: "8471", qty: "1" })],
    }),
    mkDoc({
      number: "INV/G5",
      date: "2026-10-05",
      recipient: unregMh,
      lines: [L("150000.00", { hsn: "2001", qty: "1", rate: "0" })],
    }),
    mkDoc({
      number: "INV/G6",
      date: "2026-10-05",
      recipient: parties.unregistered,
      lines: [L("1000.00", { hsn: "8471", qty: "2" })],
    }),
    mkDoc({
      number: "INV/G7",
      date: "2026-10-06",
      recipient: unregMh,
      lines: [L("2000.00", { hsn: "1001", qty: "2", rate: "5" })],
    }),
    mkDoc({
      number: "EXP/G1",
      date: "2026-10-07",
      recipient: parties.overseas,
      category: "EXPORT_WITH_PAYMENT",
      pos: "96",
      lines: [L("4000.00", { hsn: "8471", qty: "8" })],
    }),
    mkDoc({
      number: "EXP/G2",
      date: "2026-10-07",
      recipient: parties.overseas,
      category: "EXPORT_WITHOUT_PAYMENT",
      pos: "96",
      lines: [L("1000.00", { hsn: "8471", qty: "1" })],
    }),
    mkDoc({
      kind: "CREDIT_NOTE",
      number: "CN/G1",
      date: "2026-10-08",
      original: { number: "INV/G1", date: "2026-10-02" },
      lines: [L("100.00", { hsn: "8471", qty: "1" })],
    }),
    mkDoc({
      kind: "DEBIT_NOTE",
      number: "DN/G1",
      date: "2026-10-09",
      recipient: parties.recipientMh,
      original: { number: "INV/G2", date: "2026-10-03" },
      lines: [L("50.00", { hsn: "8471", qty: "1", rate: "12" })],
    }),
    mkDoc({
      kind: "CREDIT_NOTE",
      number: "CN/G2",
      date: "2026-10-10",
      recipient: unregMh,
      original: { number: "INV/G5", date: "2026-10-05" },
      lines: [L("5000.00", { hsn: "2001", qty: "1", rate: "0" })],
    }),
    mkDoc({
      kind: "CREDIT_NOTE",
      number: "CN/G3",
      date: "2026-10-11",
      recipient: parties.unregistered,
      original: { number: "INV/G6", date: "2026-10-05" },
      lines: [L("200.00", { hsn: "8471", qty: "1" })],
    }),
  ];
}

/** Named document sets, run through every conformance and parity test. */
export const SCENARIOS: Record<string, { documents: GstDocument[]; extra?: Partial<Gstr1Input> }> =
  {
    empty: { documents: [] },
    golden: { documents: goldenDocs() },
    b2bOnly: { documents: [mkDoc()] },
    reverseCharge: { documents: [mkDoc({ reverseCharge: true })] },
    oddPaisa: {
      documents: [mkDoc({ lines: [1, 2, 3].map(() => ({ taxable: "0.05" })) })],
    },
    b2csNetNegative: {
      documents: [
        mkDoc({ number: "S/1", recipient: unregMh, lines: [{ taxable: "500.00", rate: "0" }] }),
        mkDoc({
          kind: "CREDIT_NOTE",
          number: "S/C1",
          recipient: unregMh,
          original: { number: "S/1", date: "2026-10-05" },
          lines: [{ taxable: "800.00", rate: "0" }],
        }),
      ],
    },
    exportNotes: {
      documents: (["EXPORT_WITH_PAYMENT", "EXPORT_WITHOUT_PAYMENT"] as const).map((category, i) =>
        mkDoc({
          kind: i === 0 ? "CREDIT_NOTE" : "DEBIT_NOTE",
          number: `XN/${i}`,
          recipient: parties.overseas,
          category,
          pos: "96",
          original: { number: "X/1", date: "2026-10-01" },
        }),
      ),
    },
    earlierPeriod: { documents: [mkDoc({ date: "2026-07-15" }), mkDoc({ number: "INV/2" })] },
    overrideDocIssue: {
      documents: [mkDoc()],
      extra: {
        options: {
          docIssue: [
            { type: "TAX_INVOICE", from: "A/1", to: "A/10", total: 10, cancelled: 2, netIssued: 8 },
          ],
        },
      },
    },
    multiRate: {
      documents: [
        mkDoc({
          lines: [
            { taxable: "1000.00", rate: "18" },
            { taxable: "1000.00", rate: "18.000" },
            { taxable: "1000.00", rate: "5" },
            { taxable: "1000.00", rate: "0.25" },
            { taxable: "1000.00", rate: "40" },
          ],
        }),
      ],
    },
    lateOriginalNote: {
      documents: [
        mkDoc({
          kind: "CREDIT_NOTE",
          number: "CN/L",
          recipient: unregMh,
          original: { number: "B/L", date: "2024-09-10" },
          lines: [{ taxable: "1000.00", rate: "0" }],
        }),
      ],
      extra: {
        options: {
          originalInvoices: [
            {
              document: mkDoc({
                number: "B/L",
                date: "2024-09-10",
                recipient: unregMh,
                lines: [{ taxable: "150000.00", rate: "0" }],
              }),
              period: "092024",
            },
          ],
        },
      },
    },
  };

export type { DocSpec };
