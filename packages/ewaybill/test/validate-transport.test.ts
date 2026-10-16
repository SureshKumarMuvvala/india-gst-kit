import { describe, expect, it } from "vitest";
import { validateEwbByIrnRequest, validateEwbDtls, validateEwbRequest } from "../src/index.js";
import { GSTINS, edit, expectHit, expectNoHit, hits, mapped } from "./helpers.js";

const off = { supplierEInvoiceEnabled: false } as const;
const base = () => mapped("intraInvoice");

// The same transport scenario on the three routes: H (Generate), I (EWB by IRN) and C (EwbDtls).
type Fields = {
  mode?: string;
  id?: string;
  vehNo?: string;
  vehType?: string;
  docNo?: string;
  docDate?: string;
  distance?: string;
};

function h(f: Fields, extra: Parameters<typeof edit>[1] = []) {
  const set = (k: string, v: string | undefined): Parameters<typeof edit>[1][number] => [[k], v];
  return validateEwbRequest(
    edit(base(), [
      set("transMode", f.mode),
      set("transporterId", f.id),
      set("vehicleNo", f.vehNo),
      set("vehicleType", f.vehType),
      set("transDocNo", f.docNo),
      set("transDocDate", f.docDate),
      set("transDistance", f.distance ?? "150"),
      ...extra,
    ]),
    off,
  );
}
const irnBlock = (f: Fields): Record<string, string> => {
  const o: Record<string, string | undefined> = {
    TransMode: f.mode,
    TransId: f.id,
    VehNo: f.vehNo,
    VehType: f.vehType,
    TransDocNo: f.docNo,
    TransDocDt: f.docDate,
    Distance: f.distance ?? "150",
  };
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >;
};
const i = (f: Fields, o: Parameters<typeof validateEwbByIrnRequest>[1] = {}) =>
  validateEwbByIrnRequest(irnBlock(f), o);
const c = (f: Fields, o: Parameters<typeof validateEwbDtls>[1] = {}) =>
  validateEwbDtls(irnBlock(f), o);

const ROAD: Fields = { mode: "1", vehNo: "KA01AB1234", vehType: "R" };
const SHIP_DOC: Fields = { mode: "4", docNo: "SH123", docDate: "21/04/2026" };

describe("V-T1 Part-A only", () => {
  const partA: Fields = { id: GSTINS.spareKa };
  it("passes with a transporter ID and nothing else", () => {
    expectNoHit(h(partA).issues, "V-T1");
    expectNoHit(i(partA).issues, "V-T1");
    expectNoHit(c(partA).issues, "V-T1");
    expect(h(partA).ok).toBe(true);
  });
  it("fails without a transporter ID", () => {
    expectHit(h({}).issues, "V-T1", ["transporterId"]);
    expectHit(i({}).issues, "V-T1", ["TransId"]);
    expectHit(c({}).issues, "V-T1", ["TransId"]);
  });
  it("fails when vehicle or document fields are present without a mode", () => {
    const f: Fields = {
      ...partA,
      vehNo: "KA01AB1234",
      vehType: "R",
      docNo: "D1",
      docDate: "21/04/2026",
    };
    for (const [r, keys] of [
      [h(f), ["vehicleNo", "vehicleType", "transDocNo", "transDocDate"]],
      [i(f), ["VehNo", "VehType", "TransDocNo", "TransDocDt"]],
      [c(f), ["VehNo", "VehType", "TransDocNo", "TransDocDt"]],
    ] as const) {
      for (const k of keys) expectHit(r.issues, "V-T1", [k]);
    }
  });
});

describe("V-T2 Road", () => {
  it("passes with vehicle number and type; the transport document is optional", () => {
    for (const r of [h(ROAD), i(ROAD), c(ROAD)]) expectNoHit(r.issues, "V-T2");
    const withDoc = { ...ROAD, docNo: "LR1", docDate: "21/04/2026" };
    for (const r of [h(withDoc), i(withDoc), c(withDoc)]) expectNoHit(r.issues, "V-T2");
  });
  it("fails without a vehicle number or without a vehicle type", () => {
    const noNo: Fields = { mode: "1", vehType: "R" };
    const noType: Fields = { mode: "1", vehNo: "KA01AB1234" };
    expectHit(h(noNo).issues, "V-T2", ["vehicleNo"]);
    expectHit(i(noNo).issues, "V-T2", ["VehNo"]);
    expectHit(c(noNo).issues, "V-T2", ["VehNo"]);
    expectHit(h(noType).issues, "V-T2", ["vehicleType"]);
    expectHit(i(noType).issues, "V-T2", ["VehType"]);
    expectHit(c(noType).issues, "V-T2", ["VehType"]);
  });
  it("H: the vehicle type is R or O (I and C enforce it in the schema)", () => {
    expectHit(h({ ...ROAD, vehType: "X" }).issues, "V-T2", ["vehicleType"]);
    expectHit(i({ ...ROAD, vehType: "X" }).issues, "S-SCHEMA", ["VehType"]);
    expectNoHit(h({ ...ROAD, vehType: "O" }).issues, "V-T2");
  });
});

describe("V-T3 Rail and Air", () => {
  const rail: Fields = { mode: "2", docNo: "P12345", docDate: "21/04/2026" };
  const air: Fields = { mode: "3", docNo: "AWB1", docDate: "21/04/2026" };
  it("passes with document number and date and no vehicle", () => {
    for (const f of [rail, air]) for (const r of [h(f), i(f), c(f)]) expectNoHit(r.issues, "V-T3");
  });
  it("fails without the document number or date (also on H, which states only the number)", () => {
    for (const f of [{ mode: "2" }, { mode: "3" }]) {
      expectHit(h(f).issues, "V-T3", ["transDocNo"]);
      expectHit(h(f).issues, "V-T3", ["transDocDate"]);
      expectHit(i(f).issues, "V-T3", ["TransDocNo"]);
      expectHit(c(f).issues, "V-T3", ["TransDocDt"]);
    }
  });
  it("fails with a vehicle number or type", () => {
    const f = { ...air, vehNo: "KA01AB1234", vehType: "R" };
    expectHit(h(f).issues, "V-T3", ["vehicleNo"]);
    expectHit(h(f).issues, "V-T3", ["vehicleType"]);
    expectHit(i(f).issues, "V-T3", ["VehNo"]);
    expectHit(c(f).issues, "V-T3", ["VehType"]);
  });
});

describe("V-T4 Ship differs per route (spec §13 D1)", () => {
  const vehicleOnly: Fields = { mode: "4", vehNo: "KA01AB1234", vehType: "O" };
  const both: Fields = { ...SHIP_DOC, vehNo: "KA01AB1234", vehType: "O" };
  it("document number and date, no vehicle: valid on every route", () => {
    for (const r of [h(SHIP_DOC), i(SHIP_DOC), c(SHIP_DOC)]) expectNoHit(r.issues, "V-T4");
  });
  it("vehicle only: H fails (document required); I fails; C passes (vehicle number alone is enough)", () => {
    expectHit(h(vehicleOnly).issues, "V-T4", ["transDocNo"]);
    expectHit(i(vehicleOnly).issues, "V-T4", ["TransDocNo"]);
    expectNoHit(c(vehicleOnly).issues, "V-T4");
    expect(c(vehicleOnly).ok).toBe(true);
  });
  it("document and ODC vehicle: H and C pass; I fails (vehicle must be absent)", () => {
    expectNoHit(h(both).issues, "V-T4");
    expectNoHit(c(both).issues, "V-T4");
    expectHit(i(both).issues, "V-T4", ["VehNo"]);
    expectHit(i(both).issues, "V-T4", ["VehType"]);
  });
  it("H: an ODC vehicle type needs a vehicle number", () => {
    expectHit(h({ ...SHIP_DOC, vehType: "O" }).issues, "V-T4", ["vehicleNo"]);
    expectNoHit(h({ ...SHIP_DOC, vehType: "R" }).issues, "V-T4");
  });
  it("I: the document date is required too", () => {
    expectHit(i({ mode: "4", docNo: "SH1" }).issues, "V-T4", ["TransDocDt"]);
    expectNoHit(h({ mode: "4", docNo: "SH1" }).issues, "V-T4");
  });
  it("C: neither vehicle nor document pair fails; the vehicle type must be O", () => {
    expectHit(c({ mode: "4" }).issues, "V-T4", ["VehNo"]);
    expectHit(c({ mode: "4", docNo: "SH1" }).issues, "V-T4", ["VehNo"]);
    expectHit(c({ mode: "4", vehNo: "KA01AB1234", vehType: "R" }).issues, "V-T4", ["VehType"]);
    expectHit(c({ mode: "4", vehNo: "KA01AB1234" }).issues, "V-T4", ["VehType"]);
    expectHit(c({ ...SHIP_DOC, vehType: "R" }).issues, "V-T4", ["VehType"]);
  });
});

describe("V-T5 Rail document prefix", () => {
  const rail = (docNo: string): Fields => ({ mode: "2", docNo, docDate: "21/04/2026" });
  it("P, F and L pass", () => {
    for (const n of ["PSBC123", "FSBC123", "LABCD123"]) {
      expectNoHit(h(rail(n)).issues, "V-T5");
      expectNoHit(i(rail(n)).issues, "V-T5");
    }
  });
  it("is an error on H and a warning on I and C", () => {
    expectHit(h(rail("X123")).issues, "V-T5", ["transDocNo"], "error");
    expectHit(i(rail("X123")).issues, "V-T5", ["TransDocNo"], "warning");
    expectHit(c(rail("X123")).issues, "V-T5", ["TransDocNo"], "warning");
    expect(i(rail("X123")).ok).toBe(true);
    expect(c(rail("X123")).ok).toBe(true);
    expect(h(rail("X123")).ok).toBe(false);
  });
  it("does not apply to other modes", () => {
    expectNoHit(h({ mode: "3", docNo: "X1", docDate: "21/04/2026" }).issues, "V-T5");
  });
});

describe("V-T6 vehicle-number shapes", () => {
  it("a matching shape passes; others are warnings only", () => {
    expectNoHit(h(ROAD).issues, "V-T6");
    const bad = { ...ROAD, vehNo: "ABCD" };
    expectHit(i(bad).issues, "V-T6", ["VehNo"], "warning");
    expectHit(c(bad).issues, "V-T6", ["VehNo"], "warning");
    expect(i(bad).ok).toBe(true);
    // H needs at least 7 characters (schema), so use a 7-character number that has no shape.
    expectHit(h({ ...ROAD, vehNo: "ABCDEFG" }).issues, "V-T6", ["vehicleNo"], "warning");
    expect(h({ ...ROAD, vehNo: "ABCDEFG" }).ok).toBe(true);
    expectHit(i({ ...ROAD, vehNo: "ka01ab1234" }).issues, "V-T6", ["VehNo"], "warning");
  });
  it("lengths: H 7–15 and I/C 4–20 (schema)", () => {
    expectHit(h({ ...ROAD, vehNo: "ABC123" }).issues, "S-SCHEMA", ["vehicleNo"]);
    expectHit(h({ ...ROAD, vehNo: "A".repeat(16) }).issues, "S-SCHEMA", ["vehicleNo"]);
    expectNoHit(i({ ...ROAD, vehNo: "ABC1" }).issues, "S-SCHEMA");
    expectHit(i({ ...ROAD, vehNo: "ABC" }).issues, "S-SCHEMA", ["VehNo"]);
    expectHit(c({ ...ROAD, vehNo: "A".repeat(21) }).issues, "S-SCHEMA", ["VehNo"]);
  });
});

describe("V-T7 transport document date", () => {
  const rail = (date: string): Fields => ({ mode: "2", docNo: "P1", docDate: date });
  it("H: not before the document date (20/04/2026)", () => {
    expectNoHit(h(rail("20/04/2026")).issues, "V-T7");
    expectNoHit(h(rail("21/04/2026")).issues, "V-T7");
    expectHit(h(rail("19/04/2026")).issues, "V-T7", ["transDocDate"]);
  });
  it("must be a real DD/MM/YYYY date", () => {
    expectHit(h(rail("31/02/2026")).issues, "V-T7", ["transDocDate"]);
    expectHit(h(rail("2026-04-21")).issues, "V-T7", ["transDocDate"]);
  });
  it("I and C compare with the docDate option; without it only the format is checked", () => {
    const f = rail("19/04/2026");
    expectHit(i(f, { docDate: "2026-04-20" }).issues, "V-T7", ["TransDocDt"]);
    expectHit(c(f, { docDate: "2026-04-20" }).issues, "V-T7", ["TransDocDt"]);
    expectNoHit(i(f).issues, "V-T7");
    expectNoHit(c(f).issues, "V-T7");
    expectNoHit(i(rail("20/04/2026"), { docDate: "2026-04-20" }).issues, "V-T7");
    expectHit(i(rail("99/99/2026")).issues, "V-T7", ["TransDocDt"]);
  });
});

describe("V-T8 distance", () => {
  const road = (distance: string): Fields => ({ ...ROAD, distance });
  it("4000 accepted, 4001 rejected", () => {
    expectNoHit(h(road("4000")).issues, "V-T8");
    expectHit(h(road("4001")).issues, "V-T8", ["transDistance"]);
    expectNoHit(i(road("4000")).issues, "V-T8");
    expectHit(i(road("4001")).issues, "V-T8", ["Distance"]);
    expectHit(c(road("4001")).issues, "V-T8", ["Distance"]);
  });
  it("0 lets the portal compute it", () => {
    expectNoHit(h(road("0")).issues, "V-T8");
    expectNoHit(i(road("0")).issues, "V-T8");
  });
  it("must be a whole number", () => {
    for (const bad of ["abc", "12.5", "-1", "", "1e3", " 5"]) {
      expectHit(h(road(bad)).issues, "V-T8", ["transDistance"]);
    }
    expectHit(i(road("12.5")).issues, "V-T8", ["Distance"]);
  });
  it("by IRN, a missing Distance is V-B2", () => {
    const r = validateEwbByIrnRequest({ TransMode: "1" });
    expectHit(r.issues, "V-B2", ["Distance"]);
    expect(r.ok).toBe(false);
  });
  it("equal from and to PIN: 1 to 100 (0 and 101 rejected)", () => {
    const same = (d: string) =>
      h(road(d), [
        [["toPincode"], "560001"],
        [["toAddr1"], "1 Test Street"],
      ]);
    expectNoHit(same("1").issues, "V-T8");
    expectNoHit(same("100").issues, "V-T8");
    expectHit(same("0").issues, "V-T8", ["transDistance"]);
    expectHit(same("101").issues, "V-T8", ["transDistance"]);
    expectNoHit(h(road("101")).issues, "V-T8");
  });
  it("Line Sales (sub-type 10) may be up to 300 km between the same PINs (H)", () => {
    const line = (d: string) =>
      h(road(d), [
        [["toPincode"], "560001"],
        [["subSupplyType"], "10"],
        [["docType"], "CHL"],
        [["toGstin"], GSTINS.supplierKa],
        [["toStateCode"], "29"],
      ]);
    expectNoHit(line("300").issues, "V-T8");
    expectHit(line("301").issues, "V-T8", ["transDistance"]);
  });
});

describe("V-T9 transporter ID", () => {
  it("is a 15-character GSTIN-shaped ID; the check digit is not checked", () => {
    const bad = GSTINS.spareKa.slice(0, 14) + (GSTINS.spareKa.endsWith("G") ? "H" : "G");
    for (const id of [GSTINS.spareKa, bad]) {
      expectNoHit(h({ id }).issues, "V-T9");
      expectNoHit(i({ id }).issues, "V-T9");
    }
  });
  it("rejects other shapes on every route (and URP)", () => {
    for (const id of ["12XXXXXX", "URP", "29aaaaa0000a1zy", GSTINS.spareKa + "X"]) {
      expectHit(h({ id }).issues, "V-T9", ["transporterId"]);
      expectHit(i({ id }).issues, "V-T9", ["TransId"]);
    }
    expect(c({ id: "12XXXXXX" }).issues.some((x) => x.path[0] === "TransId")).toBe(true);
  });
});

describe("by-IRN rules V-B1 … V-B5", () => {
  const irn = "0123456789abcdef".repeat(4);
  const disp = { Nm: "Depot", Addr1: "9 Depot Road", Loc: "Hosur", Pin: "560002", Stcd: "29" };
  const ship = { Addr1: "Port Road", Loc: "Chennai", Pin: "600001", Stcd: "33" };
  // A transporter ID makes the request a valid Part-A-only one (V-T1), so only the rule under test can fail.
  const run = (extra: Record<string, unknown>) =>
    validateEwbByIrnRequest({ Irn: irn, Distance: "100", TransId: GSTINS.spareKa, ...extra });
  it("V-B1: 64 characters in the schema; not lowercase hex is a warning", () => {
    expectNoHit(run({}).issues, "V-B1");
    expectHit(run({ Irn: "a".repeat(63) }).issues, "S-SCHEMA", ["Irn"]);
    expectHit(run({ Irn: "A".repeat(64) }).issues, "V-B1", ["Irn"], "warning");
    expectHit(run({ Irn: "g".repeat(64) }).issues, "V-B1", ["Irn"], "warning");
    expect(run({ Irn: "A".repeat(64) }).ok).toBe(true);
  });
  it("V-B2: Distance is the only required key", () => {
    expect(validateEwbByIrnRequest({ Distance: "0", TransId: GSTINS.spareKa }).ok).toBe(true);
    expectHit(validateEwbByIrnRequest({}).issues, "V-B2", ["Distance"]);
    // Distance alone is valid structure but not a valid e-way bill: V-T1 wants a transporter or a mode.
    expectHit(validateEwbByIrnRequest({ Distance: "0" }).issues, "V-T1", ["TransId"]);
  });
  it("V-B3: DispDtls and ExpShipDtls required keys", () => {
    expect(run({ DispDtls: disp, ExpShipDtls: ship }).ok).toBe(true);
    const without = (obj: Record<string, string>, k: string) =>
      Object.fromEntries(Object.entries(obj).filter(([key]) => key !== k));
    for (const k of ["Nm", "Addr1", "Loc", "Pin", "Stcd"]) {
      expectHit(run({ DispDtls: without(disp, k) }).issues, "V-B3", ["DispDtls", k]);
    }
    for (const k of ["Addr1", "Loc", "Pin", "Stcd"]) {
      expectHit(run({ ExpShipDtls: without(ship, k) }).issues, "V-B3", ["ExpShipDtls", k]);
    }
    const noNm = { Addr1: "Port Road", Loc: "Chennai", Pin: "600001", Stcd: "33" };
    expectNoHit(run({ ExpShipDtls: noNm }).issues, "V-B3");
    expectHit(run({ DispDtls: noNm }).issues, "V-B3", ["DispDtls", "Nm"]);
  });
  it("V-B4: Stcd is in the e-invoice state master (25 and 96 are; 28 is not)", () => {
    expectNoHit(run({ ExpShipDtls: ship }).issues, "V-B4");
    expectNoHit(run({ ExpShipDtls: { ...ship, Stcd: "96" } }).issues, "V-B4");
    expectNoHit(run({ DispDtls: { ...disp, Stcd: "25", Pin: "362520" } }).issues, "V-B4");
    expectHit(run({ ExpShipDtls: { ...ship, Stcd: "28" } }).issues, "V-B4", [
      "ExpShipDtls",
      "Stcd",
    ]);
    expectHit(run({ DispDtls: { ...disp, Stcd: "28" } }).issues, "V-B4", ["DispDtls", "Stcd"]);
  });
  it("V-B5: PIN against the state's range is a warning", () => {
    expectNoHit(run({ DispDtls: disp }).issues, "V-B5");
    const r = run({ DispDtls: { ...disp, Pin: "411001" } });
    expectHit(r.issues, "V-B5", ["DispDtls", "Pin"], "warning");
    expect(r.ok).toBe(true);
    expectHit(
      run({ ExpShipDtls: { ...ship, Pin: "560001" } }).issues,
      "V-B5",
      ["ExpShipDtls", "Pin"],
      "warning",
    );
  });
  it("ExpShipDtls has no Gstin (unknown key)", () => {
    expectHit(run({ ExpShipDtls: { ...ship, Gstin: "x" } }).issues, "S-UNKNOWN-KEY", [
      "ExpShipDtls",
      "Gstin",
    ]);
  });
  it("does not throw on bad data", () => {
    for (const bad of [undefined, null, 1, "x", [], {}]) {
      expect(() => validateEwbByIrnRequest(bad)).not.toThrow();
      expect(() => validateEwbDtls(bad)).not.toThrow();
    }
  });
});

describe("validateEwbDtls", () => {
  it("accepts the EwbDtls block and rejects keys it does not have", () => {
    expect(c(ROAD).ok).toBe(true);
    expect(
      hits(validateEwbDtls({ Distance: "1", Extra: "x" }).issues, "S-UNKNOWN-KEY"),
    ).toHaveLength(1);
    expect(validateEwbDtls({}).ok).toBe(false);
  });
});
