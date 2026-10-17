import { describe, expect, it } from "vitest";
import { validateEwbRequest } from "../src/index.js";
import { GSTINS, edit, expectHit, expectNoHit, hits, mapped } from "./helpers.js";

const base = () => mapped("intraInvoice");
const inter = () => mapped("interInvoice");
const off = { supplierEInvoiceEnabled: false } as const;
const check = (req: unknown, options: Parameters<typeof validateEwbRequest>[1] = off) =>
  validateEwbRequest(req, options);

describe("validateEwbRequest: baseline", () => {
  it("accepts a mapped request with no issues", () => {
    const r = check(base());
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.value).toEqual(base());
  });
  it("does not throw on bad data", () => {
    for (const bad of [undefined, null, 1, "x", [], {}, { itemList: 3 }]) {
      expect(() => validateEwbRequest(bad)).not.toThrow();
      expect(validateEwbRequest(bad).ok).toBe(false);
    }
  });
  it("does not run the rules on a structurally invalid payload, and returns no value", () => {
    const r = check(edit(base(), [[["docNo"], "x".repeat(17)]]));
    expect(r.ok).toBe(false);
    expect(r.value).toBeUndefined();
    expect(r.issues.every((i) => i.rule.startsWith("S-") || i.rule.startsWith("V-"))).toBe(true);
    expectHit(r.issues, "S-SCHEMA", ["docNo"]);
  });
  it("returns the typed value when only rules fail", () => {
    const r = check(edit(base(), [[["docNo"], "INV 1"]]));
    expect(r.ok).toBe(false);
    expect(r.value).toBeDefined();
  });
});

describe("schema (S) rules", () => {
  it("an unknown key is rejected, including the commented-out ship-to fields", () => {
    const r = check({ ...base(), shipToGSTIN: GSTINS.recipientKa });
    expectHit(r.issues, "S-UNKNOWN-KEY", ["shipToGSTIN"]);
    expect(r.issues[0]?.code).toBe("UNEXPECTED_KEY");
  });
  it("a missing required key is reported at its path", () => {
    for (const key of [
      "supplyType",
      "docNo",
      "fromGstin",
      "totInvValue",
      "itemList",
      "transDistance",
    ]) {
      const r = check(edit(base(), [[[key], undefined]]));
      expect(r.ok, key).toBe(false);
      expect(
        r.issues.some((i) => i.path.join(".") === key),
        key,
      ).toBe(true);
    }
  });
  it("an item without hsnCode or taxableAmount is rejected", () => {
    for (const key of ["hsnCode", "taxableAmount"]) {
      const r = check(edit(base(), [[["itemList", 0, key], undefined]]));
      expectHit(r.issues, "S-SCHEMA", ["itemList", 0, key]);
    }
  });
  it("lengths: docNo 17, address 121, place 51, name 101, productDesc 101", () => {
    for (const [path, len] of [
      [["docNo"], 17],
      [["fromAddr1"], 121],
      [["toPlace"], 51],
      [["fromTrdName"], 101],
      [["itemList", 0, "productDesc"], 101],
      [["subSupplyDesc"], 21],
      [["transDocNo"], 16],
    ] as [(string | number)[], number][]) {
      const r = check(edit(base(), [[path, "A".repeat(len)]]));
      expectHit(r.issues, "S-SCHEMA", path);
    }
  });
  it("URP is accepted in fromGstin and toGstin, but not in transporterId", () => {
    expectNoHit(
      check(edit(base(), [[["toGstin"], "URP"]])).issues.filter((i) => i.rule === "S-SCHEMA"),
      "S-SCHEMA",
    );
    const t = check(edit(base(), [[["transporterId"], "URP"]]));
    expectHit(t.issues, "V-T9", ["transporterId"]);
    expect(check(edit(base(), [[["toGstin"], "urp"]])).ok).toBe(false);
  });
  it("supplyType, docType: only the enum values", () => {
    expectHit(check(edit(base(), [[["supplyType"], "X"]])).issues, "V-G1", ["supplyType"]);
    expectHit(check(edit(base(), [[["docType"], "XXX"]])).issues, "V-G1", ["docType"]);
    expectHit(check(edit(base(), [[["transMode"], "5"]])).issues, "S-SCHEMA", ["transMode"]);
  });
  it("a number where a string belongs (in memory) is a schema error", () => {
    const r = check(edit(base(), [[["fromPincode"], 560001]]));
    expectHit(r.issues, "S-SCHEMA", ["fromPincode"]);
  });
});

describe("V-G1 … V-G4", () => {
  it("V-G1: subSupplyType 1–12", () => {
    expectNoHit(check(base()).issues, "V-G1");
    expectHit(check(edit(base(), [[["subSupplyType"], "13"]])).issues, "V-G1", ["subSupplyType"]);
    expectHit(check(edit(base(), [[["subSupplyType"], ""]])).issues, "V-G1", ["subSupplyType"]);
  });
  it("V-G2: sub-type 8 ⇔ subSupplyDesc", () => {
    const others = [
      [["subSupplyType"], "8"],
      [["docType"], "CHL"],
    ] as const;
    expectHit(check(edit(base(), [...others])).issues, "V-G2", ["subSupplyDesc"]);
    const ok = check(edit(base(), [...others, [["subSupplyDesc"], "Repair"]]));
    expectNoHit(ok.issues, "V-G2");
    expectNoHit(ok.issues, "V-G3");
    expectHit(check(edit(base(), [[["subSupplyDesc"], "Repair"]])).issues, "V-G2", [
      "subSupplyDesc",
    ]);
    expectNoHit(check(base()).issues, "V-G2");
  });
  it("V-G3: the combination is a K3 row; the parties follow the row", () => {
    expectNoHit(check(base()).issues, "V-G3");
    expectHit(check(edit(base(), [[["docType"], "OTH"]])).issues, "V-G3", ["docType"]);
    expectHit(check(edit(base(), [[["docType"], "BOE"]])).issues, "V-G3", ["docType"]);
    expectHit(check(edit(base(), [[["toGstin"], GSTINS.supplierKa]])).issues, "V-G3", ["toGstin"]);
    // Own use (5) / challan: both parties are "Self", so the GSTINs must be equal.
    const own = [
      [["subSupplyType"], "5"],
      [["docType"], "CHL"],
    ] as const;
    expectHit(check(edit(base(), [...own])).issues, "V-G3", ["toGstin"]);
    const same = check(edit(base(), [...own, [["toGstin"], GSTINS.supplierKa]]));
    expectNoHit(same.issues, "V-G3");
    // "Self/Other/URP" puts no constraint on the pair.
    const free = [
      [["subSupplyType"], "8"],
      [["docType"], "OTH"],
      [["subSupplyDesc"], "Repair"],
    ] as const;
    expectNoHit(check(edit(base(), [...free])).issues, "V-G3");
    expectNoHit(check(edit(base(), [...free, [["toGstin"], GSTINS.supplierKa]])).issues, "V-G3");
    // Inward supply: from is "Other GSTIN/URP", to is "Self": different parties.
    const inward = [[["supplyType"], "I"]] as const;
    expectNoHit(check(edit(base(), [...inward])).issues, "V-G3");
    expectHit(check(edit(base(), [...inward, [["toGstin"], GSTINS.supplierKa]])).issues, "V-G3", [
      "toGstin",
    ]);
  });
  it("V-G4: docNo is letters, digits, / and - (1 to 16)", () => {
    expectNoHit(check(edit(base(), [[["docNo"], "AB/12-34"]])).issues, "V-G4");
    for (const bad of ["INV 1", "INV#1", "INV.1", ""]) {
      expectHit(check(edit(base(), [[["docNo"], bad]])).issues, "V-G4", ["docNo"]);
    }
  });
});

describe("V-G5 document date", () => {
  it("is a real calendar date", () => {
    expectNoHit(check(base()).issues, "V-G5");
    expectHit(check(edit(base(), [[["docDate"], "31/02/2026"]])).issues, "V-G5", ["docDate"]);
    expectHit(check(edit(base(), [[["docDate"], "00/04/2026"]])).issues, "V-G5", ["docDate"]);
  });
  it("180 days accepted, 181 rejected (docDate 20/04/2026)", () => {
    expectNoHit(check(base(), { ...off, asOf: "2026-10-17" }).issues, "V-G5");
    expectHit(check(base(), { ...off, asOf: "2026-10-18" }).issues, "V-G5", ["docDate"]);
  });
  it("docDate = asOf accepted, asOf + 1 rejected", () => {
    expectNoHit(check(base(), { ...off, asOf: "2026-04-20" }).issues, "V-G5");
    expectHit(check(base(), { ...off, asOf: "2026-04-19" }).issues, "V-G5", ["docDate"]);
  });
  it("without asOf the age checks are skipped", () => {
    const old = edit(base(), [[["docDate"], "01/01/2019"]]);
    expectNoHit(check(old).issues, "V-G5");
    expectHit(check(old, { ...off, asOf: "2026-01-01" }).issues, "V-G5", ["docDate"]);
  });
});

describe("V-G6, V-G7 parties", () => {
  const wrongDigit =
    GSTINS.recipientKa.slice(0, 14) + (GSTINS.recipientKa.endsWith("4") ? "5" : "4");
  it("V-G6: structure and check digit; URP passes", () => {
    expectNoHit(check(base()).issues, "V-G6");
    expectNoHit(check(edit(base(), [[["toGstin"], "URP"]])).issues, "V-G6");
    expectHit(check(edit(base(), [[["toGstin"], wrongDigit]])).issues, "V-G6", ["toGstin"]);
    expectHit(check(edit(base(), [[["fromGstin"], wrongDigit]])).issues, "V-G6", ["fromGstin"]);
    expectHit(
      check(edit(base(), [[["toGstin"], "99" + GSTINS.recipientKa.slice(2)]])).issues,
      "V-G6",
      ["toGstin"],
    );
  });
  it('V-G6: gstinCheckDigit "off" skips the check digit but not the structure', () => {
    const o = { ...off, gstinCheckDigit: "off" } as const;
    expectNoHit(check(edit(base(), [[["toGstin"], wrongDigit]]), o).issues, "V-G6");
    expectHit(
      check(edit(base(), [[["toGstin"], "99" + GSTINS.recipientKa.slice(2)]]), o).issues,
      "V-G6",
      ["toGstin"],
    );
  });
  it("V-G7: all four state codes are in K2 (25 and 28 are not)", () => {
    expectNoHit(check(base()).issues, "V-G7");
    for (const key of ["fromStateCode", "actFromStateCode", "toStateCode", "actToStateCode"]) {
      expectHit(check(edit(base(), [[[key], "28"]])).issues, "V-G7", [key]);
      expectHit(check(edit(base(), [[[key], "25"]])).issues, "V-G7", [key]);
    }
  });
  it("V-G7: the bill-from / bill-to state equals the GSTIN prefix, or 99", () => {
    expectHit(check(edit(base(), [[["toStateCode"], "27"]])).issues, "V-G7", ["toStateCode"]);
    expectHit(check(edit(base(), [[["fromStateCode"], "27"]])).issues, "V-G7", ["fromStateCode"]);
    expectNoHit(check(edit(base(), [[["toStateCode"], "99"]])).issues, "V-G7");
    expectNoHit(check(edit(base(), [[["toStateCode"], "96"]])).issues, "V-G7");
    // URP has no prefix to compare.
    expectNoHit(
      check(
        edit(base(), [
          [["toGstin"], "URP"],
          [["toStateCode"], "27"],
        ]),
      ).issues,
      "V-G7",
    );
  });
});

describe("V-G8 PIN codes", () => {
  it("both PINs must be 6 digits", () => {
    expectNoHit(check(base()).issues, "V-G8");
    expectHit(check(edit(base(), [[["toPincode"], "99999"]])).issues, "V-G8", ["toPincode"]);
    expectHit(check(edit(base(), [[["toPincode"], "1000000"]])).issues, "V-G8", ["toPincode"]);
  });
  it("a PIN outside the state's range is a warning only", () => {
    const r = check(edit(base(), [[["toPincode"], "411001"]]));
    expectHit(r.issues, "V-G8", ["toPincode"], "warning");
    expect(r.ok).toBe(true);
    expectHit(
      check(edit(base(), [[["fromPincode"], "110001"]])).issues,
      "V-G8",
      ["fromPincode"],
      "warning",
    );
  });
  it("no warning for a state without ranges (99)", () => {
    // Track E: the export port ship-to is on the document (spec §3), not in the movement.
    const r = check(
      mapped("exportPortShipTo", {
        transport: {
          distanceKm: "150",
          mode: "ROAD",
          vehicleNo: "KA01AB1234",
          vehicleType: "REGULAR",
        },
      } as never),
    );
    expectNoHit(r.issues, "V-G8");
  });
});

describe("V-G9 tax split", () => {
  it("intra: IGST value and rate must be 0", () => {
    expectNoHit(check(base()).issues, "V-G9");
    expectHit(check(edit(base(), [[["igstValue"], "10.00"]])).issues, "V-G9", ["igstValue"]);
    expectHit(check(edit(base(), [[["itemList", 0, "igstRate"], "18"]])).issues, "V-G9", [
      "itemList",
      0,
      "igstRate",
    ]);
  });
  it("inter: CGST and SGST values and rates must be 0", () => {
    expectNoHit(check(inter()).issues, "V-G9");
    expectHit(check(edit(inter(), [[["cgstValue"], "5.00"]])).issues, "V-G9", ["cgstValue"]);
    expectHit(check(edit(inter(), [[["sgstValue"], "5.00"]])).issues, "V-G9", ["sgstValue"]);
    expectHit(check(edit(inter(), [[["itemList", 1, "cgstRate"], "9"]])).issues, "V-G9", [
      "itemList",
      1,
      "cgstRate",
    ]);
    expectHit(check(edit(inter(), [[["itemList", 0, "sgstRate"], "9"]])).issues, "V-G9", [
      "itemList",
      0,
      "sgstRate",
    ]);
  });
  it("SEZ (toStateCode 99) is inter-state; zero-rated IGST rate with zero value passes", () => {
    const sez = mapped("sezWithoutPayment");
    expect(check(sez).issues).toEqual([]);
    expectHit(check(edit(sez, [[["cgstValue"], "1.00"]])).issues, "V-G9", ["cgstValue"]);
  });
  it("is skipped when a state code is invalid (V-G7 reports it)", () => {
    expectNoHit(
      check(
        edit(base(), [
          [["toStateCode"], "28"],
          [["igstValue"], "5.00"],
        ]),
      ).issues,
      "V-G9",
    );
  });
});

describe("V-G10 total value", () => {
  it("sum = totInvValue + 2.00 accepted, + 2.01 rejected", () => {
    expectNoHit(check(edit(base(), [[["totInvValue"], "1768.00"]])).issues, "V-G10");
    expectHit(check(edit(base(), [[["totInvValue"], "1767.99"]])).issues, "V-G10", ["totInvValue"]);
  });
  it("includes cess, cess non-advol and other values (negative other reduces the sum)", () => {
    expectHit(check(edit(base(), [[["cessNonAdvolValue"], "5.00"]])).issues, "V-G10", [
      "totInvValue",
    ]);
    expectNoHit(
      check(
        edit(base(), [
          [["cessNonAdvolValue"], "5.00"],
          [["otherValue"], "-5.00"],
        ]),
      ).issues,
      "V-G10",
    );
  });
  it("is skipped with rspHsnRelaxation", () => {
    const bad = edit(base(), [[["totInvValue"], "100.00"]]);
    expectHit(check(bad).issues, "V-G10", ["totInvValue"]);
    expectNoHit(check(bad, { ...off, rspHsnRelaxation: true }).issues, "V-G10");
  });
});

describe("V-G11 … V-G17", () => {
  it("V-G11: 1 to 250 items", () => {
    const item = base().itemList[0];
    const many = (n: number) =>
      edit(base(), [[["itemList"], Array.from({ length: n }, () => item)]]);
    expectNoHit(check(many(250)).issues, "V-G11");
    expectHit(check(many(251)).issues, "V-G11", ["itemList"]);
    expectHit(check(many(0)).issues, "V-G11", ["itemList"]);
  });
  it("V-G11: hsnCode is a whole number of at most 8 digits", () => {
    expectNoHit(check(edit(base(), [[["itemList", 0, "hsnCode"], "12345678"]])).issues, "V-G11");
    expectHit(check(edit(base(), [[["itemList", 0, "hsnCode"], "123456789"]])).issues, "V-G11", [
      "itemList",
      0,
      "hsnCode",
    ]);
    expectHit(check(edit(base(), [[["itemList", 0, "hsnCode"], "1.5"]])).issues, "V-G11", [
      "itemList",
      0,
      "hsnCode",
    ]);
    expectHit(check(edit(base(), [[["itemList", 0, "hsnCode"], "0"]])).issues, "V-G11", [
      "itemList",
      0,
      "hsnCode",
    ]);
  });
  it("V-G11: at least one HSN is not a 99… service code", () => {
    const services = edit(base(), [[["itemList", 0, "hsnCode"], "998313"]]);
    expectHit(check(services).issues, "V-G11", ["itemList"]);
    expectNoHit(check(base()).issues, "V-G11");
  });
  it("V-G12: qtyUnit is in the unit master; quantity beyond Decimal(8,2) is a warning", () => {
    expectNoHit(check(base()).issues, "V-G12");
    expectHit(check(edit(base(), [[["itemList", 0, "qtyUnit"], "XYZ"]])).issues, "V-G12", [
      "itemList",
      0,
      "qtyUnit",
    ]);
    for (const q of ["1.234", "1000000", "999999.995"]) {
      const r = check(edit(base(), [[["itemList", 0, "quantity"], q]]));
      expectHit(r.issues, "V-G12", ["itemList", 0, "quantity"], "warning");
      expect(r.ok, q).toBe(true);
    }
    expectNoHit(check(edit(base(), [[["itemList", 0, "quantity"], "999999.99"]])).issues, "V-G12");
  });
  it("V-G13: money at most 2 decimal places, rates at most 3", () => {
    expectNoHit(check(base()).issues, "V-G13");
    expectNoHit(check(edit(base(), [[["itemList", 0, "cgstRate"], "9.001"]])).issues, "V-G13");
    expectHit(check(edit(base(), [[["totalValue"], "1500.001"]])).issues, "V-G13", ["totalValue"]);
    expectHit(check(edit(base(), [[["itemList", 0, "taxableAmount"], "1.001"]])).issues, "V-G13", [
      "itemList",
      0,
      "taxableAmount",
    ]);
    expectHit(check(edit(base(), [[["itemList", 0, "cgstRate"], "9.0001"]])).issues, "V-G13", [
      "itemList",
      0,
      "cgstRate",
    ]);
  });
  it("V-G14: the GSTR-1 fields are present", () => {
    expectNoHit(check(base()).issues, "V-G14");
    for (const key of [
      "totalValue",
      "cgstValue",
      "sgstValue",
      "igstValue",
      "cessValue",
      "otherValue",
    ]) {
      expectHit(check(edit(base(), [[[key], undefined]])).issues, "V-G14", [key]);
    }
    for (const key of ["cgstRate", "sgstRate", "igstRate", "cessRate", "cessNonadvol"]) {
      expectHit(check(edit(base(), [[["itemList", 1, key], undefined]])).issues, "V-G14", [
        "itemList",
        1,
        key,
      ]);
    }
  });
  it("V-G15: characters outside the stated sets are warnings only", () => {
    expectNoHit(check(base()).issues, "V-G15");
    const addr = check(edit(base(), [[["fromAddr1"], "7th block, Main (Rd)"]]));
    expectHit(addr.issues, "V-G15", ["fromAddr1"], "warning");
    expect(addr.ok).toBe(true);
    expectNoHit(check(edit(base(), [[["toAddr2"], "Plot #4-2/B"]])).issues, "V-G15");
    expectHit(
      check(edit(base(), [[["toPlace"], "Pune 1"]])).issues,
      "V-G15",
      ["toPlace"],
      "warning",
    );
    expectHit(
      check(edit(base(), [[["toAddr2"], "Plot 4, B"]])).issues,
      "V-G15",
      ["toAddr2"],
      "warning",
    );
  });
  it("V-G16: transactionType is 1 to 4", () => {
    expectNoHit(check(base()).issues, "V-G16");
    expectHit(check(edit(base(), [[["transactionType"], "0"]])).issues, "V-G16", [
      "transactionType",
    ]);
    expectHit(check(edit(base(), [[["transactionType"], "5"]])).issues, "S-SCHEMA", [
      "transactionType",
    ]);
  });
  it("V-G17: an e-invoice-enabled supplier must use the IRN route", () => {
    const on = check(base(), { supplierEInvoiceEnabled: true });
    expect(on.ok).toBe(false);
    expect(hits(on.issues, "V-G17")).toEqual([
      expect.objectContaining({ code: "USE_IRN_ROUTE", severity: "error", path: [] }),
    ]);
    expectNoHit(check(base(), { supplierEInvoiceEnabled: false }).issues, "V-G17");
    const unknown = validateEwbRequest(base());
    expect(unknown.ok).toBe(true);
    expect(hits(unknown.issues, "V-G17")).toEqual([
      expect.objectContaining({ code: "EINVOICE_STATUS_UNKNOWN", severity: "warning" }),
    ]);
  });
  it("V-G17: only for tax invoices from 01/10/2020, B2B supply or export", () => {
    const on = { supplierEInvoiceEnabled: true } as const;
    expectNoHit(check(edit(base(), [[["docDate"], "30/09/2020"]]), on).issues, "V-G17");
    expectHit(check(edit(base(), [[["docDate"], "01/10/2020"]]), on).issues, "V-G17", []);
    expectNoHit(check(edit(base(), [[["docType"], "BIL"]]), on).issues, "V-G17");
    expectNoHit(check(edit(base(), [[["toGstin"], "URP"]]), on).issues, "V-G17");
    expectNoHit(check(edit(base(), [[["toGstin"], "URP"]])).issues, "V-G17");
    const exportReq = edit(base(), [
      [["subSupplyType"], "3"],
      [["toGstin"], "URP"],
    ]);
    expectHit(check(exportReq, on).issues, "V-G17", []);
  });
});
