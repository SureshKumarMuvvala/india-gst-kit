import { describe, expect, it } from "vitest";
import { toIrnRequest, validateIrnRequest } from "@india-gst-kit/einvoice";
import { shipmentPattern } from "@india-gst-kit/model";
import {
  EwbMovementSchema,
  toEwbByIrnRequest,
  toEwbRequest,
  validateEwbByIrnRequest,
  type EwbIssue,
} from "../src/index.js";
import {
  GSTINS,
  fixtures,
  mapDoc,
  mapped,
  movement,
  parsed,
  variant,
  type FixtureName,
} from "./helpers.js";

const tnSite = {
  legalName: "Chennai Delivery Site",
  address: { line1: "12 Harbour Road", city: "Chennai", pincode: "600002", stateCode: "33" },
};
const depot = {
  legalName: "Alpha Test Traders Depot",
  address: { line1: "11 Depot Lane", city: "Hosur", pincode: "635109", stateCode: "33" },
};
const codes = (issues: readonly EwbIssue[]) => issues.map((i) => i.code);
const TRANSACTION_TYPE = {
  REGULAR: "1",
  BILL_TO_SHIP_TO: "2",
  BILL_FROM_DISPATCH_FROM: "3",
  COMBINATION: "4",
} as const;

describe("toEwbRequest — ship-to / dispatch-from from the document (Track E)", () => {
  it("regular → transactionType 1, to*/from* addresses from the bill parties", () => {
    const r = mapped("intraInvoice");
    expect(r).toMatchObject({
      transactionType: "1",
      fromAddr1: "1 Test Street",
      fromPincode: "560001",
      toAddr1: "2 Sample Road",
      toPincode: "570001",
    });
  });
  it("shipTo only → 2: to* address from shipTo; toGstin / toTrdName / toStateCode from the recipient", () => {
    const res = toEwbRequest(parsed("billToShipTo"), movement());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toMatchObject({
      transactionType: "2",
      toAddr1: "9 Warehouse Road",
      toAddr2: "Unit 4",
      toPlace: "Chennai",
      toPincode: "600001",
      actToStateCode: "33",
      toGstin: GSTINS.recipientKa,
      toTrdName: "Beta Test Buyers LLP",
      toStateCode: "29",
      fromAddr1: "1 Test Street",
    });
  });
  it("dispatchFrom only → 3: from* address from dispatchFrom; fromGstin / fromTrdName / fromStateCode from the supplier", () => {
    const r = mapped("billFromDispatchFrom");
    expect(r).toMatchObject({
      transactionType: "3",
      fromAddr1: "11 Depot Lane",
      fromPlace: "Hosur",
      fromPincode: "635109",
      actFromStateCode: "33",
      fromGstin: GSTINS.supplierKa,
      fromTrdName: "Alpha Test Traders Private Limited",
      fromStateCode: "29",
      toAddr1: "3 Example Lane",
    });
  });
  it("both → 4", () => {
    const r = mapped("shipDispatchCombination");
    expect(r).toMatchObject({
      transactionType: "4",
      fromAddr1: "11 Depot Lane",
      toAddr1: "9 Warehouse Road",
    });
  });
  it("shipTo in another state than the recipient: toStateCode 29, actToStateCode 33, CGST/SGST, no STATE_SPLIT_MISMATCH", () => {
    const res = toEwbRequest(variant("intraInvoice", { shipTo: tnSite }), movement());
    expect(codes(res.issues)).not.toContain("STATE_SPLIT_MISMATCH");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toMatchObject({ toStateCode: "29", actToStateCode: "33" });
    expect(res.value.itemList[0]).toMatchObject({ cgstRate: "9", sgstRate: "9", igstRate: "0" });
  });
  it("dispatchFrom in 33 for a supplier in 29: fromStateCode 29, actFromStateCode 33, split unchanged", () => {
    const r = mapDoc(variant("intraInvoice", { dispatchFrom: depot }));
    expect(r).toMatchObject({ fromStateCode: "29", actFromStateCode: "33", igstValue: "0.00" });
    expect(r.itemList[0]).toMatchObject({ cgstRate: "9", igstRate: "0" });
  });
  it("SEZ recipient with shipTo in another state: toStateCode 99, actToStateCode the ship-to state", () => {
    const r = mapDoc(variant("sezWithoutPayment", { shipTo: tnSite }));
    expect(r).toMatchObject({ toStateCode: "99", actToStateCode: "33", toGstin: GSTINS.sezMh });
  });
  it("B2C recipient without a PIN: maps with a shipTo, MISSING_PIN without", () => {
    expect(toEwbRequest(variant("b2cInvoice", { shipTo: tnSite }), movement()).ok).toBe(true);
    expect(codes(toEwbRequest(parsed("b2cInvoice"), movement()).issues)).toEqual(["MISSING_PIN"]);
  });
  it("export with doc.shipTo = port in 27: toStateCode 99, actToStateCode 27, port address as to*", () => {
    expect(mapped("exportPortShipTo")).toMatchObject({
      subSupplyType: "3",
      toGstin: "URP",
      toStateCode: "99",
      actToStateCode: "27",
      toAddr1: "Gate 3 Port Road",
      toPincode: "400001",
      transactionType: "2",
    });
    expect(codes(toEwbRequest(parsed("exportWithoutPayment"), movement()).issues)).toEqual([
      "EXPORT_NEEDS_PORT_SHIP_TO",
    ]);
  });
  it("shipTo in state 25 → V-G7 error (K2 has no 25)", () => {
    const d = variant("intraInvoice", {
      shipTo: {
        legalName: "Daman Site",
        address: { line1: "1 Coast Road", city: "Daman", pincode: "396210", stateCode: "25" },
      },
    });
    const res = toEwbRequest(d, movement());
    expect(res.ok).toBe(false);
    expect(res.issues.find((i) => i.rule === "V-G7")?.path).toEqual(["actToStateCode"]);
  });
  it("movement.shipTo or movement.dispatchFrom passed to toEwbRequest → ADDRESS_IN_MOVEMENT", () => {
    const withShip = toEwbRequest(parsed("intraInvoice"), {
      ...movement(),
      shipTo: { address: tnSite.address },
    });
    expect(withShip.ok).toBe(false);
    expect(withShip.issues).toEqual([
      expect.objectContaining({ code: "ADDRESS_IN_MOVEMENT", path: ["movement", "shipTo"] }),
    ]);
    const withDispatch = toEwbRequest(parsed("billToShipTo"), {
      ...movement(),
      dispatchFrom: depot,
    });
    expect(withDispatch.ok).toBe(false);
    expect(codes(withDispatch.issues)).toEqual(["ADDRESS_IN_MOVEMENT"]);
    expect(withDispatch.issues[0]?.path).toEqual(["movement", "dispatchFrom"]);
  });
  it("doc.shipTo.gstin present → warning SHIP_TO_GSTIN_NOT_SENT, ok: true, no shipToGSTIN in the output", () => {
    const known = { supplierEInvoiceEnabled: false };
    const res = toEwbRequest(parsed("billToShipTo"), movement(), known);
    expect(res.ok).toBe(true);
    expect(res.issues).toEqual([
      expect.objectContaining({
        code: "SHIP_TO_GSTIN_NOT_SENT",
        path: ["shipTo", "gstin"],
        severity: "warning",
      }),
    ]);
    if (res.ok) expect(JSON.stringify(res.value)).not.toContain("shipToGSTIN");
    expect(toEwbRequest(parsed("billToShipToUnregistered"), movement(), known).issues).toEqual([]);
  });
  it("transactionType equals the model's shipmentPattern mapping for every fixture that maps", () => {
    let mappedCount = 0;
    for (const name of Object.keys(fixtures) as FixtureName[]) {
      const doc = parsed(name);
      const res = toEwbRequest(doc, movement());
      if (!res.ok) continue;
      mappedCount += 1;
      expect(res.value.transactionType, name).toBe(TRANSACTION_TYPE[shipmentPattern(doc)]);
    }
    expect(mappedCount).toBeGreaterThanOrEqual(5);
  });
  it("the Track E fixtures map with ok: true", () => {
    for (const n of [
      "billToShipTo",
      "billToShipToUnregistered",
      "billFromDispatchFrom",
      "shipDispatchCombination",
      "exportPortShipTo",
    ] as const) {
      const res = toEwbRequest(parsed(n), movement());
      expect(res.ok, `${n}: ${JSON.stringify(res.issues)}`).toBe(true);
    }
  });
});

describe("by IRN — movement dispatch-from / ship-to (Track E)", () => {
  const IRN = "a".repeat(64);
  it("DispDtls gets movement.dispatchFrom.legalName as Nm; ExpShipDtls has no Gstin or name", () => {
    const r = toEwbByIrnRequest(IRN, {
      ...movement(),
      dispatchFrom: depot,
      shipTo: { address: tnSite.address },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.DispDtls?.Nm).toBe("Alpha Test Traders Depot");
    expect(r.value.ExpShipDtls).toEqual({
      Addr1: "12 Harbour Road",
      Loc: "Chennai",
      Pin: "600002",
      Stcd: "33",
    });
  });
  it("movement.shipTo with a legalName or gstin is rejected (unknown key)", () => {
    expect(EwbMovementSchema.safeParse({ ...movement(), shipTo: tnSite }).success).toBe(false);
    expect(
      EwbMovementSchema.safeParse({
        ...movement(),
        shipTo: { gstin: GSTINS.shipToTn, address: tnSite.address },
      }).success,
    ).toBe(false);
  });
  it("ExpShipDtls.Addr1 of 2 characters → schema error (I min 3); valid in the IRN's ShipDtls (C min 1) — D12", () => {
    const short = { ...tnSite.address, line1: "A1" };
    const byIrn = validateEwbByIrnRequest({
      Irn: IRN,
      Distance: "100",
      ExpShipDtls: {
        Addr1: short.line1,
        Loc: short.city,
        Pin: short.pincode,
        Stcd: short.stateCode,
      },
    });
    expect(byIrn.ok).toBe(false);
    expect(byIrn.issues.map((i) => i.path.join("."))).toContain("ExpShipDtls.Addr1");
    const irn = toIrnRequest(variant("intraInvoice", { shipTo: { ...tnSite, address: short } }));
    expect(irn.ok).toBe(true);
    if (irn.ok) expect(validateIrnRequest(irn.value).ok).toBe(true);
  });
});
