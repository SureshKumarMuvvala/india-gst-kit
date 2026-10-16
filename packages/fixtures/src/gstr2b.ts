// Synthetic GSTR-2B (Get All Details, v4.5 shape) built from the same documents as `documents.ts`.
// No real company data: every GSTIN comes from `gstins.ts`, the check sum is a placeholder.
import { fixtures } from "./documents.js";
import { GSTINS } from "./gstins.js";

type Money = string;
interface FixtureDoc {
  number: string;
  date: string;
  placeOfSupply: string;
  reverseCharge: boolean;
  totals: {
    taxableValue: Money;
    igst: Money;
    cgst: Money;
    sgst: Money;
    cess: Money;
    grandTotal: Money;
  };
  lines: readonly {
    lineNo: number;
    gstRate: string;
    taxableValue: Money;
    igst: Money;
    cgst: Money;
    sgst: Money;
    cess: Money;
  }[];
}

/** Fixture documents (recipient = `GSTINS.recipientKa`) that appear in the fixture 2B file, in order. */
export const GSTR2B_INVOICE_FIXTURES = [
  "intraInvoice",
  "intraEqualHalves",
  "zeroRateInvoice",
  "cessInvoice",
  "reverseChargeInvoice",
] as const;
export const GSTR2B_NOTE_FIXTURES = ["creditNote"] as const;

const num = (s: string): number => Number(s);
const ddmmyyyy = (iso: string): string => iso.split("-").reverse().join("-");

function body(d: FixtureDoc) {
  return {
    dt: ddmmyyyy(d.date),
    val: num(d.totals.grandTotal),
    pos: d.placeOfSupply,
    rev: d.reverseCharge ? "Y" : "N",
    itcavl: "Y",
    txval: num(d.totals.taxableValue),
    igst: num(d.totals.igst),
    cgst: num(d.totals.cgst),
    sgst: num(d.totals.sgst),
    cess: num(d.totals.cess),
    items: d.lines.map((l) => ({
      num: l.lineNo,
      rt: num(l.gstRate),
      txval: num(l.taxableValue),
      igst: num(l.igst),
      cgst: num(l.cgst),
      sgst: num(l.sgst),
      cess: num(l.cess),
    })),
  };
}

const supplierBlock = {
  ctin: GSTINS.supplierKa,
  trdnm: "Alpha Test Traders Private Limited",
  supfildt: "11-05-2026",
  supprd: "042026",
};

const invoices = GSTR2B_INVOICE_FIXTURES.map((n) => fixtures[n] as unknown as FixtureDoc);
const notes = GSTR2B_NOTE_FIXTURES.map((n) => fixtures[n] as unknown as FixtureDoc);

/** A valid GSTR-2B response for `GSTINS.recipientKa`, period 04/2026, as a plain object. */
export const gstr2bFixture = {
  chksum: "SYNTHETICFIXTURECHECKSUM0001",
  data: {
    gstin: GSTINS.recipientKa,
    rtnprd: "042026",
    version: "4.5",
    gendt: "14-05-2026",
    docdata: {
      b2b: [
        {
          ...supplierBlock,
          inv: invoices.map((d) => ({ inum: d.number, typ: "R", ...body(d) })),
        },
      ],
      cdnr: [
        {
          ...supplierBlock,
          nt: notes.map((d) => ({ ntnum: d.number, typ: "C", suptyp: "R", ...body(d) })),
        },
      ],
    },
  },
};

/** The same file as JSON text (numbers are written the way the portal writes them). */
export const gstr2bFixtureText: string = JSON.stringify(gstr2bFixture);
