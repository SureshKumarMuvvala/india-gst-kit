import { describe, expect, it } from "vitest";
import { serializeEwbRequest, toEwbRequest, type EwbIssue } from "../src/index.js";
import {
  GSTINS,
  fixtures,
  mapDoc,
  mapped,
  movement,
  must,
  parseDoc,
  parsed,
  parties,
  portAddress,
  variant,
  type FixtureName,
} from "./helpers.js";

const shipTo = {
  address: { line1: "10 Delivery Lane", city: "Mysuru", pincode: "570002", stateCode: "29" },
};
const dispatchFrom = {
  name: "Alpha Test Warehouse",
  address: { line1: "9 Depot Road", city: "Hosur", pincode: "560002", stateCode: "29" },
};
const withMovement = (extra: Record<string, unknown>, patch: Record<string, unknown> = {}) => ({
  ...movement(patch),
  ...extra,
});
const codes = (issues: readonly EwbIssue[]) => issues.map((i) => i.code);

describe("toEwbRequest: intra-state B2B", () => {
  const r = mapped("intraInvoice");
  it("splits the rate into CGST/SGST halves and keeps the recipient state", () => {
    expect(r.itemList[0]).toMatchObject({ cgstRate: "9", sgstRate: "9", igstRate: "0" });
    expect(r.toStateCode).toBe("29");
    expect(r.transactionType).toBe("1");
    expect(r.cgstValue).toBe("135.00");
    expect(r.igstValue).toBe("0.00");
  });
  it("reformats the date and writes state codes as integers", () => {
    expect(r.docDate).toBe("20/04/2026");
    expect(r.fromStateCode).toBe("29");
    expect(r).toMatchObject({ supplyType: "O", subSupplyType: "1", docType: "INV" });
    expect(r).toMatchObject({ fromGstin: GSTINS.supplierKa, toGstin: GSTINS.recipientKa });
    const delhi = mapped("compositionBillOfSupply");
    expect(delhi.fromStateCode).toBe("7");
    expect(serializeEwbRequest(delhi)).toContain('"fromStateCode":7,');
    expect(serializeEwbRequest(delhi)).not.toContain('"fromStateCode":"07"');
  });
  it("maps header, parties, totals and the item", () => {
    expect(r).toMatchObject({
      docNo: "INV/2026-27/0001",
      fromTrdName: "Alpha Test Traders Private Limited",
      fromAddr1: "1 Test Street",
      fromPlace: "Bengaluru",
      fromPincode: "560001",
      actFromStateCode: "29",
      toTrdName: "Beta Test Buyers LLP",
      toAddr1: "2 Sample Road",
      toPlace: "Mysuru",
      toPincode: "570001",
      actToStateCode: "29",
      totalValue: "1500.00",
      sgstValue: "135.00",
      cessValue: "0.00",
      otherValue: "0.00",
      totInvValue: "1770.00",
    });
    expect(r.itemList[0]).toEqual({
      productDesc: "Test goods",
      hsnCode: "8471",
      quantity: "10",
      qtyUnit: "NOS",
      taxableAmount: "1000.00",
      sgstRate: "9",
      cgstRate: "9",
      igstRate: "0",
      cessRate: "0",
      cessNonadvol: "0",
    });
    expect("productName" in must(r.itemList[0])).toBe(false);
    expect("subSupplyDesc" in r).toBe(false);
  });
  it("uses the trade name when there is one", () => {
    const doc = parseDoc({
      ...fixtures.intraInvoice,
      supplier: { ...parties.supplier, tradeName: "Alpha Trading" },
    });
    expect(mapDoc(doc).fromTrdName).toBe("Alpha Trading");
  });
  it("returns the e-invoice status warning and does not change the input", () => {
    const doc = parsed("intraInvoice");
    const before = structuredClone(doc);
    const res = toEwbRequest(doc, movement());
    expect(res.ok).toBe(true);
    expect(res.issues.map((i) => i.rule)).toEqual(["V-G17"]);
    expect(doc).toEqual(before);
    expect(toEwbRequest(doc, movement(), { supplierEInvoiceEnabled: false }).issues).toEqual([]);
  });
});

describe("toEwbRequest: tax heads", () => {
  it("inter-state B2B: IGST only", () => {
    const r = mapped("interInvoice");
    expect(r.itemList[0]).toMatchObject({ cgstRate: "0", sgstRate: "0", igstRate: "18" });
    expect(r).toMatchObject({ igstValue: "252.00", cgstValue: "0.00", sgstValue: "0.00" });
    expect(r.toStateCode).toBe("27");
  });
  it("a UT recipient (inter-state): IGST, state code as integer", () => {
    const r = mapped("utPlaceOfSupply");
    expect(r.toStateCode).toBe("4");
    expect(r.igstValue).toBe("180.00");
  });
  it("an intra-UT supply: sgstValue carries the UTGST", () => {
    const doc = parseDoc({
      ...fixtures.intraInvoice,
      supplier: {
        ...parties.supplier,
        gstin: GSTINS.spareCh,
        stateCode: "04",
        address: { line1: "11 UT Road", city: "Chandigarh", pincode: "160022", stateCode: "04" },
      },
      recipient: parties.recipientCh,
      placeOfSupply: "04",
    });
    const r = mapDoc(doc);
    expect(r).toMatchObject({ fromStateCode: "4", toStateCode: "4", sgstValue: "135.00" });
    expect(r.itemList[0]).toMatchObject({ cgstRate: "9", sgstRate: "9", igstRate: "0" });
  });
  it("a zero-rated intra-state supply maps zero rates", () => {
    expect(mapped("zeroRateInvoice").itemList[0]).toMatchObject({ cgstRate: "0", sgstRate: "0" });
  });
  it("cess: cessValue = totals.cess, cessNonAdvolValue 0.00, item cessNonadvol 0", () => {
    const r = mapped("cessInvoice");
    expect(r).toMatchObject({ cessValue: "121.00", cessNonAdvolValue: "0.00" });
    expect(r.itemList[0]).toMatchObject({ cessRate: "12", cessNonadvol: "0", cgstRate: "14" });
  });
  it("otherValue = otherCharges + roundOff, including a negative result", () => {
    const totals = (o: string, ro: string, g: string) => ({
      ...fixtures.intraInvoice.totals,
      otherCharges: o,
      roundOff: ro,
      grandTotal: g,
    });
    const both = parseDoc({
      ...fixtures.intraInvoice,
      totals: totals("10.00", "-0.40", "1779.60"),
    });
    expect(mapDoc(both)).toMatchObject({ otherValue: "9.60", totInvValue: "1779.60" });
    const neg = parseDoc({ ...fixtures.intraInvoice, totals: totals("0.00", "-0.40", "1769.60") });
    expect(mapDoc(neg).otherValue).toBe("-0.40");
  });
  it("bill of supply → BIL with all rates 0, even when intra-state", () => {
    const inter = mapped("compositionBillOfSupply");
    expect(inter.docType).toBe("BIL");
    expect(inter.itemList[0]).toMatchObject({ cgstRate: "0", sgstRate: "0", igstRate: "0" });
    const intra = parseDoc({
      ...fixtures.billOfSupply,
      lines: [{ ...fixtures.billOfSupply.lines[0], hsnSac: "1713" }],
    });
    expect(mapDoc(intra).itemList[0]).toMatchObject({
      cgstRate: "0",
      sgstRate: "0",
      igstRate: "0",
    });
    expect(mapDoc(intra).docType).toBe("BIL");
  });
});

describe("toEwbRequest: parties and movement", () => {
  it("B2C: toGstin URP; a recipient without a PIN and no shipTo → MISSING_PIN", () => {
    const doc = parsed("b2cInvoice");
    const bad = toEwbRequest(doc, movement());
    expect(bad.ok).toBe(false);
    expect(bad.issues).toHaveLength(1);
    expect(bad.issues[0]).toMatchObject({
      code: "MISSING_PIN",
      path: ["recipient", "address", "pincode"],
    });
    const good = toEwbRequest(doc, withMovement({ shipTo }));
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.value).toMatchObject({
        toGstin: "URP",
        toPincode: "570002",
        transactionType: "2",
      });
    }
  });
  it("a supplier or dispatch address without a PIN → MISSING_PIN", () => {
    const noPin = parseDoc({
      ...fixtures.intraInvoice,
      supplier: {
        ...parties.supplier,
        address: { line1: "1 Test Street", city: "Bengaluru", stateCode: "29" },
      },
    });
    expect(toEwbRequest(noPin, movement()).issues[0]).toMatchObject({
      code: "MISSING_PIN",
      path: ["supplier", "address", "pincode"],
    });
    const dispatchNoPin = withMovement({
      dispatchFrom: {
        name: "X Depot",
        address: { line1: "9 Depot Road", city: "Hosur", stateCode: "29" },
      },
    });
    expect(toEwbRequest(parsed("intraInvoice"), dispatchNoPin).issues[0]).toMatchObject({
      code: "MISSING_PIN",
      path: ["movement", "dispatchFrom", "address", "pincode"],
    });
  });
  it("SEZ with and without payment: toStateCode 99, actToStateCode the actual state, IGST rates", () => {
    const without = mapped("sezWithoutPayment");
    expect(without).toMatchObject({
      toStateCode: "99",
      actToStateCode: "27",
      toGstin: GSTINS.sezMh,
    });
    expect(without.itemList[0]).toMatchObject({ cgstRate: "0", sgstRate: "0", igstRate: "18" });
    expect(without.igstValue).toBe("0.00");
    const withPay = parseDoc({
      ...fixtures.sezWithoutPayment,
      supplyCategory: "SEZ_WITH_PAYMENT",
      lines: [{ ...fixtures.sezWithoutPayment.lines[0], igst: "180.00", lineTotal: "1180.00" }],
      totals: { ...fixtures.sezWithoutPayment.totals, igst: "180.00", grandTotal: "1180.00" },
    });
    const r = mapDoc(withPay);
    expect(r).toMatchObject({ toStateCode: "99", actToStateCode: "27", igstValue: "180.00" });
    expect(r.itemList[0]?.igstRate).toBe("18");
  });
  it("export: subSupplyType 3, toStateCode 99, the port address as to*", () => {
    const r = mapDoc(
      parsed("exportWithoutPayment"),
      withMovement({ shipTo: { address: portAddress } }),
    );
    expect(r).toMatchObject({
      subSupplyType: "3",
      toGstin: "URP",
      toStateCode: "99",
      toTrdName: "Zeta Test Overseas Inc",
      toAddr1: "Container Freight Station",
      toPlace: "Chennai",
      toPincode: "600001",
      actToStateCode: "33",
      transactionType: "2",
    });
  });
  it("export without shipTo → EXPORT_NEEDS_PORT_SHIP_TO", () => {
    const res = toEwbRequest(parsed("exportWithoutPayment"), movement());
    expect(res.ok).toBe(false);
    expect(codes(res.issues)).toEqual(["EXPORT_NEEDS_PORT_SHIP_TO"]);
  });
  it("shipTo only → type 2; dispatchFrom only → 3; both → 4, with addresses from them", () => {
    expect(mapped("intraInvoice", withMovement({ shipTo })).transactionType).toBe("2");
    const ship = mapped("intraInvoice", withMovement({ shipTo }));
    expect(ship).toMatchObject({
      toAddr1: "10 Delivery Lane",
      toPincode: "570002",
      toGstin: GSTINS.recipientKa,
    });
    expect(ship.fromAddr1).toBe("1 Test Street");
    const disp = mapped("intraInvoice", withMovement({ dispatchFrom }));
    expect(disp.transactionType).toBe("3");
    expect(disp).toMatchObject({
      fromAddr1: "9 Depot Road",
      fromPlace: "Hosur",
      fromPincode: "560002",
    });
    const both = mapped("intraInvoice", withMovement({ dispatchFrom, shipTo }));
    expect(both).toMatchObject({
      transactionType: "4",
      fromAddr1: "9 Depot Road",
      toAddr1: "10 Delivery Lane",
      fromGstin: GSTINS.supplierKa,
      fromTrdName: "Alpha Test Traders Private Limited",
      toTrdName: "Beta Test Buyers LLP",
    });
  });
  it("actToStateCode / actFromStateCode follow shipTo / dispatchFrom", () => {
    const r = mapped(
      "interInvoice",
      withMovement({
        shipTo: {
          address: { line1: "12 Port Road", city: "Chennai", pincode: "600001", stateCode: "33" },
        },
        dispatchFrom: { name: "Depot", address: { ...dispatchFrom.address, stateCode: "29" } },
      }),
    );
    expect(r).toMatchObject({ toStateCode: "27", actToStateCode: "33", fromStateCode: "29" });
  });
});

describe("toEwbRequest: transport", () => {
  it("maps road details", () => {
    expect(mapped("intraInvoice")).toMatchObject({
      transMode: "1",
      transDistance: "150",
      vehicleNo: "KA01AB1234",
      vehicleType: "R",
    });
  });
  it("maps rail details, transport document date reformatted, transporter and name", () => {
    const r = mapped(
      "intraInvoice",
      movement({
        mode: "RAIL",
        vehicleNo: undefined,
        vehicleType: undefined,
        transportDocNo: "P1234",
        transportDocDate: "2026-04-21",
        transporterId: GSTINS.spareKa,
        transporterName: "Test Carriers",
      }),
    );
    expect(r).toMatchObject({
      transMode: "2",
      transDocNo: "P1234",
      transDocDate: "21/04/2026",
      transporterId: GSTINS.spareKa,
      transporterName: "Test Carriers",
    });
    expect("vehicleNo" in r).toBe(false);
  });
  it("maps ship with an ODC vehicle", () => {
    const r = mapped(
      "intraInvoice",
      movement({ mode: "SHIP", vehicleType: "ODC", transportDocNo: "SH1" }),
    );
    expect(r).toMatchObject({ transMode: "4", vehicleType: "O" });
  });
  it("Part-A only (transporter ID, no mode): no vehicle or document fields", () => {
    const r = mapped(
      "intraInvoice",
      movement({
        mode: undefined,
        vehicleNo: undefined,
        vehicleType: undefined,
        transporterId: GSTINS.spareKa,
      }),
    );
    for (const k of ["transMode", "vehicleNo", "vehicleType", "transDocNo", "transDocDate"]) {
      expect(k in r, k).toBe(false);
    }
    expect(r.transporterId).toBe(GSTINS.spareKa);
  });
  it("transport details the movement gives without a mode are reported (V-T1), never dropped", () => {
    const res = toEwbRequest(
      parsed("intraInvoice"),
      movement({
        mode: undefined,
        vehicleNo: undefined,
        vehicleType: undefined,
        transporterId: GSTINS.spareKa,
        transportDocNo: "D1",
        transportDocDate: "2026-04-21",
      }),
    );
    expect(res.ok).toBe(false);
    const paths = res.issues.filter((i) => i.rule === "V-T1").map((i) => i.path.join("."));
    expect(paths.sort()).toEqual(["transDocDate", "transDocNo"]);
  });
  it("a transport mismatch is reported by the transport rules, not the mapper", () => {
    const res = toEwbRequest(parsed("intraInvoice"), movement({ vehicleNo: undefined }));
    expect(res.ok).toBe(false);
    expect(res.issues.find((i) => i.rule === "V-T2")).toMatchObject({ path: ["vehicleNo"] });
  });
  it("a malformed movement → BAD_MOVEMENT, not a throw", () => {
    for (const bad of [
      undefined,
      {},
      movement({ vehicleNo: "ka 01" }),
      movement({ distanceKm: "12.5" }),
      { ...movement(), extra: 1 },
    ]) {
      const res = toEwbRequest(parsed("intraInvoice"), bad as never);
      expect(res.ok).toBe(false);
      expect(res.issues.length).toBeGreaterThan(0);
      expect(res.issues.every((i) => i.code === "BAD_MOVEMENT")).toBe(true);
      expect(res.issues.every((i) => i.path[0] === "movement")).toBe(true);
    }
  });
});

describe("toEwbRequest: lines", () => {
  it("a service line without quantity has no quantity or qtyUnit", () => {
    const item = mapped("intraInvoice").itemList[1];
    expect(item).toBeDefined();
    expect("quantity" in must(item)).toBe(false);
    expect("qtyUnit" in must(item)).toBe(false);
    expect(item).toMatchObject({ hsnCode: "998313", productDesc: "Test service" });
  });
  it("a description over 100 characters is a validation error, never truncated", () => {
    const long = "x".repeat(150);
    const doc = parseDoc({
      ...fixtures.intraInvoice,
      lines: [
        { ...fixtures.intraInvoice.lines[0], description: long },
        fixtures.intraInvoice.lines[1],
      ],
    });
    const res = toEwbRequest(doc, movement());
    expect(res.ok).toBe(false);
    expect(res.issues[0]).toMatchObject({ rule: "S-SCHEMA", path: ["itemList", 0, "productDesc"] });
    expect(JSON.stringify(res)).not.toContain("value");
  });
  it("HSN 0101 → HSN_LEADING_ZERO; the HSN is never changed", () => {
    const doc = parseDoc({
      ...fixtures.intraInvoice,
      lines: [
        { ...fixtures.intraInvoice.lines[0], hsnSac: "0101" },
        fixtures.intraInvoice.lines[1],
      ],
    });
    const res = toEwbRequest(doc, movement());
    expect(res.ok).toBe(false);
    expect(res.issues).toEqual([
      expect.objectContaining({
        code: "HSN_LEADING_ZERO",
        path: ["lines", 0, "hsnSac"],
        severity: "error",
      }),
    ]);
    expect(codes(toEwbRequest(parsed("billOfSupply"), movement()).issues)).toEqual([
      "HSN_LEADING_ZERO",
    ]);
  });
  it("recipient state ≠ place of supply → STATE_SPLIT_MISMATCH", () => {
    const doc = parseDoc({
      ...fixtures.intraInvoice,
      recipient: parties.recipientMh,
      placeOfSupply: "29",
    });
    const res = toEwbRequest(doc, movement());
    expect(res.ok).toBe(false);
    expect(codes(res.issues)).toEqual(["STATE_SPLIT_MISMATCH"]);
    // The reverse: recipient in the supplier's state, place of supply elsewhere.
    const reverse = parseDoc({
      ...fixtures.interInvoice,
      recipient: parties.recipientKa,
      placeOfSupply: "27",
    });
    expect(codes(toEwbRequest(reverse, movement()).issues)).toEqual(["STATE_SPLIT_MISMATCH"]);
  });
  const manyLines = (n: number) => {
    const line = fixtures.intraInvoice.lines[0];
    const money = (v: number) => v.toFixed(2);
    return parseDoc({
      ...fixtures.intraInvoice,
      lines: Array.from({ length: n }, (_, i) => ({ ...line, lineNo: i + 1 })),
      totals: {
        ...fixtures.intraInvoice.totals,
        taxableValue: money(n * 1000),
        cgst: money(n * 90),
        sgst: money(n * 90),
        grandTotal: money(n * 1180),
      },
    });
  };
  it("251 lines → V-G11 error; 250 lines map", () => {
    const res = toEwbRequest(manyLines(251), movement());
    expect(res.ok).toBe(false);
    expect(res.issues.find((i) => i.rule === "V-G11")).toMatchObject({ path: ["itemList"] });
    expect(toEwbRequest(manyLines(250), movement()).ok).toBe(true);
  });
  it("USE_IRN_ROUTE when the supplier is e-invoice enabled; NOT_EWB_DOCUMENT for a credit note", () => {
    const irn = toEwbRequest(parsed("intraInvoice"), movement(), { supplierEInvoiceEnabled: true });
    expect(irn.ok).toBe(false);
    expect(codes(irn.issues)).toEqual(["USE_IRN_ROUTE"]);
    const none = toEwbRequest(parsed("creditNote"), movement());
    expect(none.ok).toBe(false);
    expect(codes(none.issues)).toEqual(["NOT_EWB_DOCUMENT"]);
  });
});

describe("toEwbRequest: output hygiene", () => {
  it("never emits empty strings, shipToGSTIN, dispatchFromGSTIN or their trade names", () => {
    const text = serializeEwbRequest(
      mapped(
        "intraInvoice",
        withMovement({ dispatchFrom, shipTo }, { transporterName: undefined }),
      ),
    );
    expect(text).not.toMatch(/:""/);
    for (const k of [
      "shipToGSTIN",
      "shipToTrdName",
      "dispatchFromGSTIN",
      "dispatchFromTradeName",
    ]) {
      expect(text).not.toContain(k);
    }
  });
  it("omits an address line 2 that is empty", () => {
    const doc = parseDoc({
      ...fixtures.intraInvoice,
      supplier: { ...parties.supplier, address: { ...parties.supplier.address, line2: "" } },
    });
    expect("fromAddr2" in mapDoc(doc)).toBe(false);
  });
  it("maps every goods fixture that is an e-way bill document, given a valid movement", () => {
    const needsShipTo = new Set<FixtureName>(["b2cInvoice"]);
    const names: FixtureName[] = [
      "intraInvoice",
      "interInvoice",
      "b2cInvoice",
      "intraEqualHalves",
      "compositionBillOfSupply",
      "utPlaceOfSupply",
      "zeroRateInvoice",
      "cessInvoice",
      "sezWithoutPayment",
      "exportWithoutPayment",
      "reverseChargeInvoice",
    ];
    for (const name of names) {
      const mv =
        name === "exportWithoutPayment"
          ? withMovement({ shipTo: { address: portAddress } })
          : needsShipTo.has(name)
            ? withMovement({ shipTo })
            : movement();
      const res = toEwbRequest(parsed(name), mv);
      expect(res.ok, `${name}: ${JSON.stringify(res.issues)}`).toBe(true);
    }
    // The other fixtures are not e-way bill documents, or carry a leading-zero HSN.
    for (const name of ["creditNote", "debitNote", "compositionCreditNote"] as const) {
      expect(codes(toEwbRequest(parsed(name), movement()).issues)).toEqual(["NOT_EWB_DOCUMENT"]);
    }
    expect(codes(toEwbRequest(variant("billOfSupply", {}), movement()).issues)).toEqual([
      "HSN_LEADING_ZERO",
    ]);
  });
});
