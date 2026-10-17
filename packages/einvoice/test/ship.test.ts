import { describe, expect, it } from "vitest";
import {
  serializeIrnRequest,
  toIrnRequest,
  validateIrnRequest,
  type IrnIssue,
} from "../src/index.js";
import { GSTINS, hits, mapDoc, mapped, parsed, variant } from "./helpers.js";

const chennai = { line1: "9 Warehouse Road", city: "Chennai", pincode: "600001", stateCode: "33" };
const where = (issues: readonly IrnIssue[]) => issues.map((i) => `${i.rule}@${i.path.join(".")}`);

describe("toIrnRequest — ship-to / dispatch-from (Track E, spec §3.1)", () => {
  it("bill-to–ship-to: ShipDtls from shipTo, in schema key order; no DispDtls", () => {
    const r = mapped("billToShipTo");
    expect(r.ShipDtls).toEqual({
      Gstin: GSTINS.shipToTn,
      LglNm: "Theta Test Consignee Private Limited",
      TrdNm: "Theta Consignee",
      Addr1: "9 Warehouse Road",
      Addr2: "Unit 4",
      Loc: "Chennai",
      Pin: "600001",
      Stcd: "33",
    });
    expect(r).not.toHaveProperty("DispDtls");
    const text = serializeIrnRequest(r);
    expect(text).toContain(
      `"ShipDtls":{"Gstin":"${GSTINS.shipToTn}","LglNm":"Theta Test Consignee Private Limited","TrdNm":"Theta Consignee","Addr1":"9 Warehouse Road","Addr2":"Unit 4","Loc":"Chennai","Pin":600001,"Stcd":"33"}`,
    );
  });
  it("shipTo without gstin / tradeName / line2: Gstin, TrdNm and Addr2 omitted (never URP or empty)", () => {
    const r = mapped("billToShipToUnregistered");
    expect(r.ShipDtls).toEqual({
      LglNm: "Beta Test Buyers Project Site",
      Addr1: "10 Site Road",
      Loc: "Hubballi",
      Pin: "580020",
      Stcd: "29",
    });
    expect(serializeIrnRequest(r)).not.toContain('""');
  });
  it("bill-from–dispatch-from: DispDtls from dispatchFrom; no ShipDtls", () => {
    const r = mapped("billFromDispatchFrom");
    expect(r.DispDtls).toEqual({
      Nm: "Alpha Test Traders Depot",
      Addr1: "11 Depot Lane",
      Loc: "Hosur",
      Pin: "635109",
      Stcd: "33",
    });
    expect(r).not.toHaveProperty("ShipDtls");
    expect(serializeIrnRequest(r)).toContain('"Pin":635109,"Stcd":"33"}');
  });
  it("combination: both blocks; regular document: neither", () => {
    const c = mapped("shipDispatchCombination");
    expect(c.ShipDtls).toBeDefined();
    expect(c.DispDtls).toBeDefined();
    const r = mapped("intraInvoice");
    expect(r).not.toHaveProperty("ShipDtls");
    expect(r).not.toHaveProperty("DispDtls");
  });
  it("Stcd is 2-digit", () => {
    const d = variant("intraInvoice", {
      shipTo: {
        legalName: "Punjab Site",
        address: { line1: "1 Mall Road", city: "Ludhiana", pincode: "141001", stateCode: "03" },
      },
    });
    expect(mapDoc(d).ShipDtls?.Stcd).toBe("03");
  });
  it("BuyerDtls and Pos are unchanged by shipTo: supplier 29, POS 29, shipTo in 33 → CGST/SGST", () => {
    const plain = mapped("intraInvoice");
    const d = variant("intraInvoice", { shipTo: { legalName: "TN Site", address: chennai } });
    const r = mapDoc(d);
    expect(r.BuyerDtls).toEqual(plain.BuyerDtls);
    expect(r.BuyerDtls.Pos).toBe("29");
    expect(r.ItemList[0]?.CgstAmt).toBe("90.00");
    expect(r.ItemList[0]?.IgstAmt).toBe("0.00");
    expect(hits(validateIrnRequest(r).issues, "V11")).toEqual([]);
  });
  it("export with a port shipTo in 27: no Gstin; buyer URP/96/96/999999; V30 passes with EwbDtls", () => {
    const r = mapped("exportPortShipTo");
    expect(r.ShipDtls).toEqual({
      LglNm: "Mumbai Port Export Terminal",
      Addr1: "Gate 3 Port Road",
      Loc: "Mumbai",
      Pin: "400001",
      Stcd: "27",
    });
    expect(r.BuyerDtls).toMatchObject({ Gstin: "URP", Stcd: "96", Pos: "96", Pin: "999999" });
    const withEwb = validateIrnRequest({ ...r, EwbDtls: { Distance: "30" } });
    expect(hits(withEwb.issues, "V30")).toEqual([]);
  });
  it("credit note with shipTo → ShipDtls emitted", () => {
    const d = variant("creditNote", { shipTo: { legalName: "TN Site", address: chennai } });
    expect(mapDoc(d).ShipDtls?.LglNm).toBe("TN Site");
  });
  it("length limits are reported, not truncated", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ shipTo: { legalName: "L".repeat(101), address: chennai } }, "S-SCHEMA@ShipDtls.LglNm"],
      [
        { shipTo: { legalName: "TN Site", address: { ...chennai, city: "Ab" } } },
        "S-SCHEMA@ShipDtls.Loc",
      ],
      [{ dispatchFrom: { legalName: "Ab", address: chennai } }, "S-SCHEMA@DispDtls.Nm"],
      [
        { dispatchFrom: { legalName: "Depot", address: { ...chennai, pincode: "099999" } } },
        "S-SCHEMA@DispDtls.Pin",
      ],
    ];
    for (const [patch, expected] of cases) {
      const r = toIrnRequest(variant("intraInvoice", patch));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(where(r.issues)).toContain(expected);
    }
  });
  it("the Track E fixtures pass validation with no issues at all", () => {
    for (const n of [
      "billToShipTo",
      "billToShipToUnregistered",
      "billFromDispatchFrom",
      "shipDispatchCombination",
      "exportPortShipTo",
    ] as const) {
      expect(validateIrnRequest(mapped(n)).issues, n).toEqual([]);
    }
    expect(parsed("billToShipTo").shipTo?.gstin).toBe(GSTINS.shipToTn);
  });
});
