// Synthetic GST documents (no real company data). All amounts are hand-computed; the tests in
// packages/model parse every one of them.
import { GSTINS } from "./gstins.js";

const supplierAddress = {
  line1: "1 Test Street",
  city: "Bengaluru",
  pincode: "560001",
  stateCode: "29",
};
const supplier = {
  legalName: "Alpha Test Traders Private Limited",
  gstin: GSTINS.supplierKa,
  registrationType: "REGULAR",
  stateCode: "29",
  address: supplierAddress,
};
const recipientKa = {
  legalName: "Beta Test Buyers LLP",
  gstin: GSTINS.recipientKa,
  registrationType: "REGULAR",
  stateCode: "29",
  address: { line1: "2 Sample Road", city: "Mysuru", pincode: "570001", stateCode: "29" },
};
const recipientMh = {
  legalName: "Gamma Test Retail Limited",
  gstin: GSTINS.recipientMh,
  registrationType: "REGULAR",
  stateCode: "27",
  address: { line1: "3 Example Lane", city: "Pune", pincode: "411001", stateCode: "27" },
};
const recipientCh = {
  legalName: "Delta Test Chandigarh Traders",
  gstin: GSTINS.recipientCh,
  registrationType: "REGULAR",
  stateCode: "04",
  address: { line1: "4 Sector Road", city: "Chandigarh", pincode: "160017", stateCode: "04" },
};
const unregistered = {
  legalName: "Walk-in Customer",
  registrationType: "UNREGISTERED",
  stateCode: "29",
  address: { line1: "5 Consumer Street", city: "Bengaluru", stateCode: "29" },
};
const sezUnit = {
  legalName: "Epsilon Test SEZ Unit",
  gstin: GSTINS.sezMh,
  registrationType: "SEZ_UNIT",
  stateCode: "27",
  address: { line1: "6 SEZ Park", city: "Navi Mumbai", pincode: "400703", stateCode: "27" },
};
const overseas = {
  legalName: "Zeta Test Overseas Inc",
  registrationType: "OVERSEAS",
  stateCode: "96",
  address: { line1: "7 Foreign Avenue", city: "Springfield", stateCode: "96", country: "US" },
};
const compositionSupplier = {
  legalName: "Eta Test Composition Dealer",
  gstin: GSTINS.compositionDl,
  registrationType: "COMPOSITION",
  stateCode: "07",
  address: { line1: "8 Dealer Market", city: "New Delhi", pincode: "110001", stateCode: "07" },
};

const goodsLine = {
  lineNo: 1,
  description: "Test goods",
  hsnSac: "8471",
  isService: false,
  quantity: "10",
  unit: "NOS",
  unitPrice: "100.00",
  grossAmount: "1000.00",
  discount: "0.00",
  taxableValue: "1000.00",
  gstRate: "18",
  cgst: "90.00",
  sgst: "90.00",
  igst: "0.00",
  cess: "0.00",
  lineTotal: "1180.00",
};
const serviceLine = {
  lineNo: 2,
  description: "Test service",
  hsnSac: "998313",
  isService: true,
  grossAmount: "500.00",
  discount: "0.00",
  taxableValue: "500.00",
  gstRate: "18",
  cgst: "45.00",
  sgst: "45.00",
  igst: "0.00",
  cess: "0.00",
  lineTotal: "590.00",
};

const totals = (o: Record<string, string>) => ({
  lineDiscount: "0.00",
  cess: "0.00",
  otherCharges: "0.00",
  roundOff: "0.00",
  ...o,
});

const head = {
  schemaVersion: "1",
  number: "INV/2026-27/0001",
  date: "2026-04-20",
  reverseCharge: false,
};

const intraInvoice = {
  ...head,
  kind: "TAX_INVOICE",
  supplier,
  recipient: recipientKa,
  placeOfSupply: "29",
  lines: [goodsLine, serviceLine],
  totals: totals({
    taxableValue: "1500.00",
    cgst: "135.00",
    sgst: "135.00",
    igst: "0.00",
    grandTotal: "1770.00",
  }),
};

const interInvoice = {
  ...head,
  number: "INV/2026-27/0002",
  kind: "TAX_INVOICE",
  supplier,
  recipient: recipientMh,
  placeOfSupply: "27",
  lines: [
    {
      ...goodsLine,
      discount: "100.00",
      taxableValue: "900.00",
      cgst: "0.00",
      sgst: "0.00",
      igst: "162.00",
      lineTotal: "1062.00",
    },
    { ...serviceLine, cgst: "0.00", sgst: "0.00", igst: "90.00" },
  ],
  totals: totals({
    taxableValue: "1400.00",
    cgst: "0.00",
    sgst: "0.00",
    igst: "252.00",
    lineDiscount: "100.00",
    grandTotal: "1652.00",
  }),
};

// 100.10 @ 5 %: total tax 5.005 -> 5.01.
const oddPaisaLine = {
  lineNo: 1,
  description: "Odd paisa goods",
  hsnSac: "6109",
  isService: false,
  quantity: "1",
  unit: "NOS",
  unitPrice: "100.10",
  grossAmount: "100.10",
  discount: "0.00",
  taxableValue: "100.10",
  gstRate: "5",
};

const b2cInvoice = {
  ...head,
  number: "B2C/0001",
  kind: "TAX_INVOICE",
  supplier,
  recipient: unregistered,
  placeOfSupply: "29",
  lines: [
    {
      ...oddPaisaLine,
      cgst: "2.51",
      sgst: "2.50",
      igst: "0.00",
      cess: "0.00",
      lineTotal: "105.11",
    },
  ],
  totals: totals({
    taxableValue: "100.10",
    cgst: "2.51",
    sgst: "2.50",
    igst: "0.00",
    grandTotal: "105.11",
  }),
};

const intraEqualHalves = {
  ...head,
  number: "INV/2026-27/0003",
  kind: "TAX_INVOICE",
  supplier,
  recipient: recipientKa,
  placeOfSupply: "29",
  lines: [
    {
      ...oddPaisaLine,
      cgst: "2.50",
      sgst: "2.50",
      igst: "0.00",
      cess: "0.00",
      lineTotal: "105.10",
    },
  ],
  totals: totals({
    taxableValue: "100.10",
    cgst: "2.50",
    sgst: "2.50",
    igst: "0.00",
    grandTotal: "105.10",
  }),
};

const billOfSupply = {
  ...head,
  number: "BOS/0001",
  kind: "BILL_OF_SUPPLY",
  supplier,
  recipient: recipientKa,
  placeOfSupply: "29",
  lines: [
    {
      lineNo: 1,
      description: "Exempt goods",
      hsnSac: "0713",
      isService: false,
      quantity: "2",
      unit: "KGS",
      unitPrice: "100.00",
      grossAmount: "200.00",
      discount: "0.00",
      taxableValue: "200.00",
      gstRate: "0",
      cgst: "0.00",
      sgst: "0.00",
      igst: "0.00",
      cess: "0.00",
      lineTotal: "200.00",
    },
  ],
  totals: totals({
    taxableValue: "200.00",
    cgst: "0.00",
    sgst: "0.00",
    igst: "0.00",
    grandTotal: "200.00",
  }),
};

const creditNote = {
  ...head,
  number: "CN/0001",
  kind: "CREDIT_NOTE",
  originalDocument: { number: "INV/2026-27/0001", date: "2026-04-10" },
  supplier,
  recipient: recipientKa,
  placeOfSupply: "29",
  lines: [goodsLine],
  totals: totals({
    taxableValue: "1000.00",
    cgst: "90.00",
    sgst: "90.00",
    igst: "0.00",
    grandTotal: "1180.00",
  }),
};

const debitNote = {
  ...head,
  number: "DN/0001",
  kind: "DEBIT_NOTE",
  originalDocument: { number: "INV/2026-27/0002", date: "2026-04-20" },
  supplier,
  recipient: recipientMh,
  placeOfSupply: "27",
  lines: [{ ...serviceLine, lineNo: 1, cgst: "0.00", sgst: "0.00", igst: "90.00" }],
  totals: totals({
    taxableValue: "500.00",
    cgst: "0.00",
    sgst: "0.00",
    igst: "90.00",
    grandTotal: "590.00",
  }),
};

const compositionLine = {
  lineNo: 1,
  description: "Composition dealer goods",
  hsnSac: "1905",
  isService: false,
  quantity: "5",
  unit: "PCS",
  unitPrice: "40.00",
  grossAmount: "200.00",
  discount: "0.00",
  taxableValue: "200.00",
  gstRate: "0",
  cgst: "0.00",
  sgst: "0.00",
  igst: "0.00",
  cess: "0.00",
  lineTotal: "200.00",
};
const compositionTotals = totals({
  taxableValue: "200.00",
  cgst: "0.00",
  sgst: "0.00",
  igst: "0.00",
  grandTotal: "200.00",
});

const compositionBillOfSupply = {
  ...head,
  number: "COMP/0001",
  kind: "BILL_OF_SUPPLY",
  supplier: compositionSupplier,
  recipient: recipientMh,
  placeOfSupply: "27",
  lines: [compositionLine],
  totals: compositionTotals,
};

const compositionCreditNote = {
  ...compositionBillOfSupply,
  number: "COMP/CN/0001",
  kind: "CREDIT_NOTE",
  originalDocument: { number: "COMP/0001", date: "2026-04-10" },
};

// Chandigarh (04) is a UTGST territory; the sgst field would hold UTGST on an intra-UT supply.
// Here the supply is inter-state (supplier 29 -> POS 04), so IGST applies.
const utPlaceOfSupply = {
  ...head,
  number: "INV/2026-27/0004",
  kind: "TAX_INVOICE",
  supplier,
  recipient: recipientCh,
  placeOfSupply: "04",
  lines: [{ ...goodsLine, cgst: "0.00", sgst: "0.00", igst: "180.00" }],
  totals: totals({
    taxableValue: "1000.00",
    cgst: "0.00",
    sgst: "0.00",
    igst: "180.00",
    grandTotal: "1180.00",
  }),
};

const zeroRateInvoice = {
  ...head,
  number: "INV/2026-27/0005",
  kind: "TAX_INVOICE",
  supplier,
  recipient: recipientKa,
  placeOfSupply: "29",
  lines: [{ ...goodsLine, gstRate: "0", cgst: "0.00", sgst: "0.00", lineTotal: "1000.00" }],
  totals: totals({
    taxableValue: "1000.00",
    cgst: "0.00",
    sgst: "0.00",
    igst: "0.00",
    grandTotal: "1000.00",
  }),
};

// 28 % + 12 % ad valorem cess + 1.00 specific cess: cess = 120.00 + 1.00 = 121.00.
const cessInvoice = {
  ...head,
  number: "INV/2026-27/0006",
  kind: "TAX_INVOICE",
  supplier,
  recipient: recipientKa,
  placeOfSupply: "29",
  lines: [
    {
      ...goodsLine,
      gstRate: "28",
      cgst: "140.00",
      sgst: "140.00",
      cessRate: "12",
      cessNonAdvol: "1.00",
      cess: "121.00",
      lineTotal: "1401.00",
    },
  ],
  totals: totals({
    taxableValue: "1000.00",
    cgst: "140.00",
    sgst: "140.00",
    igst: "0.00",
    cess: "121.00",
    grandTotal: "1401.00",
  }),
};

const sezWithoutPayment = {
  ...head,
  number: "SEZ/0001",
  kind: "TAX_INVOICE",
  supplyCategory: "SEZ_WITHOUT_PAYMENT",
  supplier,
  recipient: sezUnit,
  placeOfSupply: "27",
  lines: [{ ...goodsLine, cgst: "0.00", sgst: "0.00", igst: "0.00", lineTotal: "1000.00" }],
  totals: totals({
    taxableValue: "1000.00",
    cgst: "0.00",
    sgst: "0.00",
    igst: "0.00",
    grandTotal: "1000.00",
  }),
};

const exportWithoutPayment = {
  ...head,
  number: "EXP/0001",
  kind: "TAX_INVOICE",
  supplyCategory: "EXPORT_WITHOUT_PAYMENT",
  supplier,
  recipient: overseas,
  placeOfSupply: "96",
  lines: [{ ...goodsLine, cgst: "0.00", sgst: "0.00", igst: "0.00", lineTotal: "1000.00" }],
  totals: totals({
    taxableValue: "1000.00",
    cgst: "0.00",
    sgst: "0.00",
    igst: "0.00",
    grandTotal: "1000.00",
  }),
};

// Track E: ship-to / dispatch-from. Place of supply stays an explicit input; the tax split is
// supplier state vs place of supply whatever the ship/dispatch states are (model spec §5.7).
const shipToTn = {
  legalName: "Theta Test Consignee Private Limited",
  tradeName: "Theta Consignee",
  gstin: GSTINS.shipToTn,
  address: {
    line1: "9 Warehouse Road",
    line2: "Unit 4",
    city: "Chennai",
    pincode: "600001",
    stateCode: "33",
  },
};
const shipToSite = {
  legalName: "Beta Test Buyers Project Site",
  address: { line1: "10 Site Road", city: "Hubballi", pincode: "580020", stateCode: "29" },
};
const dispatchDepot = {
  legalName: "Alpha Test Traders Depot",
  address: { line1: "11 Depot Lane", city: "Hosur", pincode: "635109", stateCode: "33" },
};
const mumbaiPort = {
  legalName: "Mumbai Port Export Terminal",
  address: { line1: "Gate 3 Port Road", city: "Mumbai", pincode: "400001", stateCode: "27" },
};

const billToShipTo = {
  ...intraInvoice,
  number: "INV/2026-27/0008",
  lines: [goodsLine],
  totals: totals({
    taxableValue: "1000.00",
    cgst: "90.00",
    sgst: "90.00",
    igst: "0.00",
    grandTotal: "1180.00",
  }),
  shipTo: shipToTn,
};
const billToShipToUnregistered = {
  ...billToShipTo,
  number: "INV/2026-27/0009",
  shipTo: shipToSite,
};
const billFromDispatchFrom = {
  ...interInvoice,
  number: "INV/2026-27/0010",
  dispatchFrom: dispatchDepot,
};
const shipDispatchCombination = {
  ...billToShipTo,
  number: "INV/2026-27/0011",
  dispatchFrom: dispatchDepot,
};
const exportPortShipTo = { ...exportWithoutPayment, number: "EXP/0002", shipTo: mumbaiPort };

const reverseChargeInvoice = { ...intraInvoice, number: "INV/2026-27/0007", reverseCharge: true };

export const fixtures = {
  intraInvoice,
  interInvoice,
  b2cInvoice,
  intraEqualHalves,
  billOfSupply,
  creditNote,
  debitNote,
  compositionBillOfSupply,
  compositionCreditNote,
  utPlaceOfSupply,
  zeroRateInvoice,
  cessInvoice,
  sezWithoutPayment,
  exportWithoutPayment,
  reverseChargeInvoice,
  billToShipTo,
  billToShipToUnregistered,
  billFromDispatchFrom,
  shipDispatchCombination,
  exportPortShipTo,
} as const satisfies Record<string, unknown>;

export type FixtureName = keyof typeof fixtures;
export const FIXTURE_NAMES = Object.keys(fixtures) as FixtureName[];

/** Parties, exported for tests that build variations. */
export const parties = {
  supplier,
  recipientKa,
  recipientMh,
  recipientCh,
  unregistered,
  sezUnit,
  overseas,
  compositionSupplier,
};
