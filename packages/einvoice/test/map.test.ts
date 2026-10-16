import { describe, expect, it } from "vitest";
import {
  parseIrnRequestJson,
  serializeIrnRequest,
  toIrnRequest,
  validateIrnRequest,
} from "../src/index.js";
import {
  fixtures,
  GSTINS,
  hits,
  mapDoc,
  mapped,
  parseDoc,
  parsed,
  parties,
  variant,
  type FixtureName,
} from "./helpers.js";

const intraLine1 = {
  SlNo: "1",
  PrdDesc: "Test goods",
  IsServc: "N",
  HsnCd: "8471",
  Qty: "10",
  Unit: "NOS",
  UnitPrice: "100.00",
  TotAmt: "1000.00",
  Discount: "0.00",
  AssAmt: "1000.00",
  GstRt: "18",
  IgstAmt: "0.00",
  CgstAmt: "90.00",
  SgstAmt: "90.00",
  CesRt: "0",
  CesAmt: "0.00",
  CesNonAdvlAmt: "0.00",
  StateCesRt: "0",
  StateCesAmt: "0.00",
  StateCesNonAdvlAmt: "0.00",
  OthChrg: "0.00",
  TotItemVal: "1180.00",
};

describe("toIrnRequest — mapping", () => {
  it("intra-state B2B invoice: CGST/SGST, SupTyp B2B, Typ INV, Dt reformatted, Stcd 2-digit", () => {
    expect(mapped("intraInvoice")).toEqual({
      Version: "1.1",
      TranDtls: { TaxSch: "GST", SupTyp: "B2B", RegRev: "N", IgstOnIntra: "N" },
      DocDtls: { Typ: "INV", No: "INV/2026-27/0001", Dt: "20/04/2026" },
      SellerDtls: {
        Gstin: GSTINS.supplierKa,
        LglNm: "Alpha Test Traders Private Limited",
        Addr1: "1 Test Street",
        Loc: "Bengaluru",
        Pin: "560001",
        Stcd: "29",
      },
      BuyerDtls: {
        Gstin: GSTINS.recipientKa,
        LglNm: "Beta Test Buyers LLP",
        Pos: "29",
        Addr1: "2 Sample Road",
        Loc: "Mysuru",
        Pin: "570001",
        Stcd: "29",
      },
      ItemList: [
        intraLine1,
        {
          SlNo: "2",
          PrdDesc: "Test service",
          IsServc: "Y",
          HsnCd: "998313",
          UnitPrice: "500.00",
          TotAmt: "500.00",
          Discount: "0.00",
          AssAmt: "500.00",
          GstRt: "18",
          IgstAmt: "0.00",
          CgstAmt: "45.00",
          SgstAmt: "45.00",
          CesRt: "0",
          CesAmt: "0.00",
          CesNonAdvlAmt: "0.00",
          StateCesRt: "0",
          StateCesAmt: "0.00",
          StateCesNonAdvlAmt: "0.00",
          OthChrg: "0.00",
          TotItemVal: "590.00",
        },
      ],
      ValDtls: {
        AssVal: "1500.00",
        CgstVal: "135.00",
        SgstVal: "135.00",
        IgstVal: "0.00",
        CesVal: "0.00",
        StCesVal: "0.00",
        Discount: "0.00",
        OthChrg: "0.00",
        RndOffAmt: "0.00",
        TotInvVal: "1770.00",
      },
    });
  });

  it("inter-state B2B invoice: IGST only", () => {
    const req = mapped("interInvoice");
    expect(req.BuyerDtls.Pos).toBe("27");
    expect(req.BuyerDtls.Stcd).toBe("27");
    for (const item of req.ItemList) {
      expect(item.CgstAmt).toBe("0.00");
      expect(item.SgstAmt).toBe("0.00");
    }
    expect(req.ItemList.map((i) => i.IgstAmt)).toEqual(["162.00", "90.00"]);
    expect(req.ValDtls.IgstVal).toBe("252.00");
  });

  it("UT place of supply: SgstAmt carries UTGST", () => {
    const ctSupplier = {
      ...parties.recipientCh,
      registrationType: "REGULAR",
    };
    const ctBuyer = {
      ...parties.recipientCh,
      legalName: "Theta Test Chandigarh Buyers",
      gstin: GSTINS.spareCh,
    };
    const base = fixtures.intraInvoice;
    const line = { ...base.lines[0], cgst: "90.00", sgst: "90.00" };
    const doc = parseDoc({
      ...base,
      supplier: ctSupplier,
      recipient: ctBuyer,
      placeOfSupply: "04",
      lines: [line],
      totals: {
        ...base.totals,
        taxableValue: "1000.00",
        cgst: "90.00",
        sgst: "90.00",
        grandTotal: "1180.00",
      },
    });
    const req = mapDoc(doc);
    expect(req.SellerDtls.Stcd).toBe("04");
    expect(req.BuyerDtls.Pos).toBe("04");
    expect(req.ItemList[0]?.SgstAmt).toBe("90.00");
    expect(req.ValDtls.SgstVal).toBe("90.00");
  });

  it("credit note: CRN with PrecDocDtls; debit note: DBN", () => {
    const crn = mapped("creditNote");
    expect(crn.DocDtls.Typ).toBe("CRN");
    expect(crn.RefDtls?.PrecDocDtls).toEqual([{ InvNo: "INV/2026-27/0001", InvDt: "10/04/2026" }]);
    const dbn = mapped("debitNote");
    expect(dbn.DocDtls.Typ).toBe("DBN");
    expect(dbn.RefDtls?.PrecDocDtls).toEqual([{ InvNo: "INV/2026-27/0002", InvDt: "20/04/2026" }]);
  });

  it("an invoice has no RefDtls unless it has notes", () => {
    expect(mapped("intraInvoice").RefDtls).toBeUndefined();
  });

  describe("category mapping", () => {
    const inter = fixtures.interInvoice;
    it("SEZ with payment → SEZWP", () => {
      const req = mapDoc(
        variant("interInvoice", { supplyCategory: "SEZ_WITH_PAYMENT", recipient: parties.sezUnit }),
      );
      expect(req.TranDtls.SupTyp).toBe("SEZWP");
      expect(req.ItemList[0]?.IgstAmt).toBe("162.00");
    });
    it("SEZ without payment → SEZWOP", () => {
      expect(mapped("sezWithoutPayment").TranDtls.SupTyp).toBe("SEZWOP");
    });
    it("export with payment → EXPWP", () => {
      const req = mapDoc(
        variant("interInvoice", {
          supplyCategory: "EXPORT_WITH_PAYMENT",
          recipient: parties.overseas,
          placeOfSupply: "96",
        }),
      );
      expect(req.TranDtls.SupTyp).toBe("EXPWP");
      expect(inter.lines.length).toBe(2);
    });
    it("export without payment → EXPWOP", () => {
      expect(mapped("exportWithoutPayment").TranDtls.SupTyp).toBe("EXPWOP");
    });
    it("deemed export (inter-state) → DEXP", () => {
      const req = mapDoc(variant("interInvoice", { supplyCategory: "DEEMED_EXPORT" }));
      expect(req.TranDtls.SupTyp).toBe("DEXP");
    });
    it("deemed export within one state is intra-state (CGST/SGST), as the model and D-Q3 agree", () => {
      const req = mapDoc(variant("intraInvoice", { supplyCategory: "DEEMED_EXPORT" }));
      expect(req.TranDtls.SupTyp).toBe("DEXP");
      expect(req.ItemList[0]?.CgstAmt).toBe("90.00");
      expect(req.ItemList[0]?.IgstAmt).toBe("0.00");
    });
  });

  it("export: URP / 96 / 96 / 999999", () => {
    const b = mapped("exportWithoutPayment").BuyerDtls;
    expect(b).toMatchObject({ Gstin: "URP", Pos: "96", Stcd: "96", Pin: "999999" });
    expect(b.LglNm).toBe("Zeta Test Overseas Inc");
  });

  it("reverse charge: RegRev Y", () => {
    expect(mapped("reverseChargeInvoice").TranDtls.RegRev).toBe("Y");
    expect(mapped("intraInvoice").TranDtls.RegRev).toBe("N");
  });

  it("cess split: CesAmt = cess − cessNonAdvol", () => {
    const item = mapped("cessInvoice").ItemList[0];
    expect(item).toMatchObject({
      CesRt: "12",
      CesAmt: "120.00",
      CesNonAdvlAmt: "1.00",
      TotItemVal: "1401.00",
    });
    expect(mapped("cessInvoice").ValDtls.CesVal).toBe("121.00");
  });

  it("ValDtls.Discount is 0.00 even when lines carry discounts (no double subtraction)", () => {
    const req = mapped("interInvoice");
    expect(req.ItemList[0]?.Discount).toBe("100.00");
    expect(req.ItemList[0]?.AssAmt).toBe("900.00");
    expect(req.ValDtls.Discount).toBe("0.00");
    expect(req.ValDtls.TotInvVal).toBe("1652.00");
  });

  it("OthChrg, RndOffAmt and TotInvVal are carried over; notes → InvRm", () => {
    const base = fixtures.intraInvoice;
    const req = mapDoc(
      variant("intraInvoice", {
        totals: { ...base.totals, otherCharges: "10.00", roundOff: "-0.50", grandTotal: "1779.50" },
        notes: "Thank you for the order",
      }),
    );
    expect(req.ValDtls).toMatchObject({
      OthChrg: "10.00",
      RndOffAmt: "-0.50",
      TotInvVal: "1779.50",
    });
    expect(req.RefDtls?.InvRm).toBe("Thank you for the order");
    expect(validateIrnRequest(req).ok).toBe(true);
  });

  it("trade name, address line 2 and recipient PIN are optional", () => {
    const base = fixtures.intraInvoice;
    const doc = parseDoc({
      ...base,
      supplier: {
        ...base.supplier,
        tradeName: "Alpha Traders",
        address: { ...base.supplier.address, line2: "Second floor" },
      },
    });
    const s = mapDoc(doc).SellerDtls;
    expect(s.TrdNm).toBe("Alpha Traders");
    expect(s.Addr2).toBe("Second floor");
    const noPin = parseDoc({
      ...base,
      recipient: {
        ...base.recipient,
        address: { line1: "2 Sample Road", city: "Mysuru", stateCode: "29" },
      },
    });
    expect("Pin" in mapDoc(noPin).BuyerDtls).toBe(false);
  });

  it("service line without quantity: UnitPrice = TotAmt, no Qty/Unit", () => {
    const service = mapped("intraInvoice").ItemList[1];
    expect(service).toBeDefined();
    expect(service?.UnitPrice).toBe(service?.TotAmt);
    expect(service).not.toHaveProperty("Qty");
    expect(service).not.toHaveProperty("Unit");
  });

  describe("rejections (NOT_EINVOICEABLE)", () => {
    function codes(doc: ReturnType<typeof parsed>) {
      const r = toIrnRequest(doc);
      expect(r.ok).toBe(false);
      return r.ok ? [] : r.issues;
    }
    it("bill of supply", () => {
      const issues = codes(parsed("billOfSupply"));
      expect(issues.map((i) => i.code)).toContain("NOT_EINVOICEABLE");
      expect(issues.map((i) => i.path.join("."))).toContain("kind");
    });
    it("B2C (no recipient GSTIN, not an export)", () => {
      const issues = codes(parsed("b2cInvoice"));
      expect(issues.map((i) => i.path.join("."))).toContain("recipient.gstin");
    });
    it("SEZ-unit supplier", () => {
      const base = fixtures.intraInvoice;
      const doc = parseDoc({
        ...base,
        supplier: { ...base.supplier, registrationType: "SEZ_UNIT" },
      });
      expect(codes(doc).map((i) => i.path.join("."))).toContain("supplier.registrationType");
    });
    it("composition supplier", () => {
      const issues = codes(parsed("compositionCreditNote"));
      expect(issues.map((i) => i.path.join("."))).toContain("supplier.registrationType");
    });
    it("missing seller PIN", () => {
      const base = fixtures.intraInvoice;
      const doc = parseDoc({
        ...base,
        supplier: {
          ...base.supplier,
          address: { line1: "1 Test Street", city: "Bengaluru", stateCode: "29" },
        },
      });
      expect(codes(doc).map((i) => i.path.join("."))).toContain("supplier.address.pincode");
    });
    it("export to a GSTIN holder", () => {
      const doc = variant("exportWithoutPayment", { recipient: parties.recipientMh });
      expect(codes(doc).map((i) => i.path.join("."))).toContain("recipient.gstin");
    });
    it("reports every problem at once, with stable rule ids", () => {
      const issues = codes(parsed("compositionBillOfSupply"));
      expect(issues.every((i) => i.severity === "error")).toBe(true);
      expect(new Set(issues.map((i) => i.rule)).size).toBe(issues.length);
      expect(issues.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("tight IRN length limits are reported by validation, never silently truncated", () => {
    const base = fixtures.intraInvoice;
    const doc = parseDoc({ ...base, supplier: { ...base.supplier, legalName: "Ab" } });
    const r = toIrnRequest(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.map((i) => `${i.rule}@${i.path.join(".")}`)).toContain(
        "S-SCHEMA@SellerDtls.LglNm",
      );
    }
  });

  it("the Version option is passed through (and then fails V1)", () => {
    const r = toIrnRequest(parsed("intraInvoice"), { version: "1.0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(hits(r.issues, "V1").length).toBe(1);
  });

  const MAPPABLE: FixtureName[] = [
    "intraInvoice",
    "interInvoice",
    "intraEqualHalves",
    "creditNote",
    "debitNote",
    "utPlaceOfSupply",
    "zeroRateInvoice",
    "cessInvoice",
    "sezWithoutPayment",
    "exportWithoutPayment",
    "reverseChargeInvoice",
  ];
  const UNMAPPABLE: FixtureName[] = [
    "b2cInvoice",
    "billOfSupply",
    "compositionBillOfSupply",
    "compositionCreditNote",
  ];

  it.each(MAPPABLE)("fixture %s maps with ok: true and serialises to valid JSON", (name) => {
    const r = toIrnRequest(parsed(name));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = serializeIrnRequest(r.value);
    expect(() => JSON.parse(text) as unknown).not.toThrow();
    const back = parseIrnRequestJson(text);
    expect(back.issues).toEqual([]);
    expect(back.value).toEqual(r.value);
    expect(validateIrnRequest(r.value).ok).toBe(true);
  });

  it.each(UNMAPPABLE)("fixture %s is rejected", (name) => {
    expect(toIrnRequest(parsed(name)).ok).toBe(false);
  });

  it("every fixture is accounted for", () => {
    expect([...MAPPABLE, ...UNMAPPABLE].sort()).toEqual(Object.keys(fixtures).sort());
  });

  it("the output never contains Irn", () => {
    for (const name of MAPPABLE) {
      expect(mapped(name)).not.toHaveProperty("Irn");
      expect(serializeIrnRequest(mapped(name))).not.toContain('"Irn"');
    }
  });
});
