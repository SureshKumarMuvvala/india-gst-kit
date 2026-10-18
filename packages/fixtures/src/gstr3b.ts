// Synthetic GSTR-3B fixtures (Track G). No real data: GSTINs only from ./gstins.ts, amounts invented.
import { GSTINS } from "./gstins.js";

const item = (
  taxableValue: string,
  tax: { igst?: string; cgst?: string; sgst?: string },
  rate = "18",
) => ({
  rate,
  taxableValue,
  ...tax,
  cess: "0.00",
});

/**
 * A synthetic `Gstr1Return` (shape of `@india-gst-kit/gstr1`'s Gstr1ReturnSchema) that reaches every mapping row
 * G1–G4 and G6–G10 of docs/specs/gstr3b.md §4.1 once. The filer is `supplierKa` (29), period October 2026.
 * Pass `recipientTypes: { [GSTINS.compositionDl]: "COMPOSITION" }` to place INV-2 in 3.2 composition.
 */
export const gstr1ReturnFixture = {
  gstin: GSTINS.supplierKa,
  period: "102026",
  b2b: [
    {
      ctin: GSTINS.recipientMh,
      invoices: [
        {
          number: "INV-1",
          date: "2026-10-01",
          value: "1180.00",
          pos: "27",
          reverseCharge: false,
          invoiceType: "R",
          items: [item("1000.00", { igst: "180.00" })],
        },
        {
          number: "INV-4",
          date: "2026-10-04",
          value: "354.00",
          pos: "27",
          reverseCharge: true,
          invoiceType: "R",
          items: [item("300.00", { igst: "54.00" })],
        },
      ],
    },
    {
      ctin: GSTINS.compositionDl,
      invoices: [
        {
          number: "INV-2",
          date: "2026-10-02",
          value: "2360.00",
          pos: "07",
          reverseCharge: false,
          invoiceType: "R",
          items: [item("2000.00", { igst: "360.00" })],
        },
      ],
    },
    {
      ctin: GSTINS.recipientKa,
      invoices: [
        {
          number: "INV-3",
          date: "2026-10-03",
          value: "590.00",
          pos: "29",
          reverseCharge: false,
          invoiceType: "R",
          items: [item("500.00", { cgst: "45.00", sgst: "45.00" })],
        },
      ],
    },
    {
      ctin: GSTINS.sezMh,
      invoices: [
        {
          number: "INV-5",
          date: "2026-10-05",
          value: "1180.00",
          pos: "27",
          reverseCharge: false,
          invoiceType: "SEWP",
          items: [item("1000.00", { igst: "180.00" })],
        },
        {
          number: "INV-6",
          date: "2026-10-06",
          value: "400.00",
          pos: "27",
          reverseCharge: false,
          invoiceType: "SEWOP",
          items: [item("400.00", { igst: "0.00" })],
        },
      ],
    },
    {
      ctin: GSTINS.recipientCh,
      invoices: [
        {
          number: "INV-7",
          date: "2026-10-07",
          value: "708.00",
          pos: "04",
          reverseCharge: false,
          invoiceType: "DE",
          items: [item("600.00", { igst: "108.00" })],
        },
      ],
    },
  ],
  b2cl: [
    {
      pos: "27",
      invoices: [
        {
          number: "INV-9",
          date: "2026-10-09",
          value: "177000.00",
          items: [item("150000.00", { igst: "27000.00" })],
        },
      ],
    },
  ],
  b2cs: [
    {
      supplyType: "INTRA",
      pos: "29",
      rate: "18",
      taxableValue: "10000.00",
      cgst: "900.00",
      sgst: "900.00",
      cess: "0.00",
    },
    {
      supplyType: "INTER",
      pos: "33",
      rate: "12",
      taxableValue: "5000.00",
      igst: "600.00",
      cess: "0.00",
    },
  ],
  cdnr: [
    {
      ctin: GSTINS.recipientMh,
      notes: [
        {
          number: "CN-1",
          date: "2026-10-11",
          value: "118.00",
          noteType: "C",
          pos: "27",
          reverseCharge: false,
          invoiceType: "R",
          items: [item("100.00", { igst: "18.00" })],
        },
      ],
    },
    {
      ctin: GSTINS.sezMh,
      notes: [
        {
          number: "DN-1",
          date: "2026-10-12",
          value: "59.00",
          noteType: "D",
          pos: "27",
          reverseCharge: false,
          invoiceType: "SEWP",
          items: [item("50.00", { igst: "9.00" })],
        },
      ],
    },
  ],
  cdnur: [
    {
      number: "CN-2",
      date: "2026-10-13",
      value: "1180.00",
      noteType: "C",
      type: "B2CL",
      pos: "27",
      items: [item("1000.00", { igst: "180.00" })],
    },
    {
      number: "CN-3",
      date: "2026-10-14",
      value: "236.00",
      noteType: "C",
      type: "EXPWP",
      items: [item("200.00", { igst: "36.00" })],
    },
  ],
  exp: [
    {
      exportType: "WPAY",
      invoices: [
        {
          number: "INV-10",
          date: "2026-10-10",
          value: "5900.00",
          items: [{ rate: "18", taxableValue: "5000.00", igst: "900.00", cess: "0.00" }],
        },
      ],
    },
    {
      exportType: "WOPAY",
      invoices: [
        {
          number: "INV-11",
          date: "2026-10-15",
          value: "3000.00",
          items: [{ rate: "0", taxableValue: "3000.00", igst: "0.00", cess: "0.00" }],
        },
      ],
    },
  ],
  hsn: { b2b: [], b2c: [] },
  docIssue: [],
};

/** The 3.1 (a), 3.1 (b) and 3.2 figures `gstr1ReturnFixture` derives to (worked by hand in the gstr3b tests). */
export const gstr3bExpectedOutward = {
  t31a: {
    taxableValue: "168300.00",
    igst: "28050.00",
    cgst: "945.00",
    sgst: "945.00",
    cess: "0.00",
  },
  t31b: { taxableValue: "9250.00", igst: "1053.00", cess: "0.00" },
  t32unreg: [
    { pos: "27", taxableValue: "149000.00", igst: "26820.00" },
    { pos: "33", taxableValue: "5000.00", igst: "600.00" },
  ],
  t32comp: [{ pos: "07", taxableValue: "2000.00", igst: "360.00" }],
} as const;

const h5 = (txval: number, iamt: number, camt: number, samt: number, csamt: number) => ({
  txval,
  iamt,
  camt,
  samt,
  csamt,
});
const h4 = (iamt: number, camt: number, samt: number, csamt: number) => ({
  iamt,
  camt,
  samt,
  csamt,
});
const g4 = { igst: 0, cgst: 0, sgst: 0, cess: 0 };

/**
 * One Auto Calc block: subtotals, plus the zero `det` rows the source requires where it has `anyOf det | det_q` (3.1 (d)
 * and the ITC boxes). 3.2 arrays need 1–40 rows, so the empty UIN-holder node is left out.
 */
function block() {
  return {
    gstin: GSTINS.supplierKa,
    ret_period: "102026",
    sup_details: {
      osup_3_1a: { subtotal: h5(168300, 28050, 945, 945, 0) },
      osup_3_1b: { subtotal: { txval: 9250, iamt: 1053, csamt: 0 } },
      osup_3_1c: { subtotal: { txval: 0 } },
      isup_3_1d: { subtotal: h5(0, 0, 0, 0, 0), det: { itcavl: { txval: 0, ...g4 } } },
      osup_3_1e: { subtotal: { txval: 0 } },
      esup_3_1_1b: { subtotal: { txval: 0 } },
      esup_3_1_1a: { subtotal: h5(0, 0, 0, 0, 0) },
    },
    inter_sup: {
      osup_unreg_3_2: {
        subtotal: [
          { pos: "27", txval: 149000, iamt: 26820 },
          { pos: "33", txval: 5000, iamt: 600 },
        ],
      },
      osup_comp_3_2: { subtotal: [{ pos: "07", txval: 2000, iamt: 360 }] },
    },
    elgitc: {
      itc4a1: { subtotal: { iamt: 0, csamt: 0 }, det: { itcavl: { igst: 0, cess: 0 } } },
      itc4a3: { subtotal: h4(0, 0, 0, 0), det: { itcavl: g4 } },
      itc4a4: { subtotal: h4(0, 0, 0, 0), det: { itcavl: g4 } },
      itc4a5: { subtotal: h4(0, 0, 0, 0), det: { itcavl: g4 } },
      itc4b2: { subtotal: h4(0, 0, 0, 0), det: { itcrev: g4 } },
      itc4d2: { subtotal: h4(0, 0, 0, 0), det: { itcunavl: g4 } },
    },
  };
}

/** A synthetic "Get ITC Liability Auto Calc Details" v7.1 response matching `gstr1ReturnFixture` (no ITC). */
export const gstr3bAutoCalcFixture = {
  r3bautopop: {
    r1fildt: "11-11-2026",
    r2bgendt: "14-11-2026",
    r3bgendt: "15-11-2026",
    liabitc: block(),
    liabitcr1: block(),
  },
};
export const gstr3bAutoCalcFixtureText: string = JSON.stringify(gstr3bAutoCalcFixture);
