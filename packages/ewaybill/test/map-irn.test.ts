import { describe, expect, it } from "vitest";
import { toIrnRequest, validateIrnRequest } from "@india-gst-kit/einvoice";
import {
  serializeEwbByIrnRequest,
  toEwbByIrnRequest,
  toIrnEwbDtls,
  validateEwbDtls,
} from "../src/index.js";
import { GSTINS, movement, parsed, portAddress } from "./helpers.js";

const IRN = "a".repeat(64);
// Track E: the movement's dispatchFrom is the model's DispatchFromSchema (legalName, spec §3).
const dispatchFrom = {
  legalName: "Alpha Test Warehouse",
  address: {
    line1: "9 Depot Road",
    line2: "Industrial Area",
    city: "Hosur",
    pincode: "560002",
    stateCode: "29",
  },
};
const shipTo = { address: portAddress };

describe("toEwbByIrnRequest", () => {
  it("maps road details; Distance is the raw kilometres; absent fields are omitted", () => {
    const r = toEwbByIrnRequest(IRN, movement());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      Irn: IRN,
      TransMode: "1",
      Distance: "150",
      VehNo: "KA01AB1234",
      VehType: "R",
    });
    expect(serializeEwbByIrnRequest(r.value)).toBe(
      `{"Irn":"${IRN}","TransMode":"1","Distance":150,"VehNo":"KA01AB1234","VehType":"R"}`,
    );
  });
  it("maps transporter, rail document and date (DD/MM/YYYY)", () => {
    const r = toEwbByIrnRequest(
      IRN,
      movement({
        mode: "RAIL",
        vehicleNo: undefined,
        vehicleType: undefined,
        transportDocNo: "P99",
        transportDocDate: "2026-04-21",
        transporterId: GSTINS.spareKa,
        transporterName: "Test Carriers",
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({
        TransId: GSTINS.spareKa,
        TransName: "Test Carriers",
        TransMode: "2",
        TransDocNo: "P99",
        TransDocDt: "21/04/2026",
      });
      expect("VehNo" in r.value).toBe(false);
    }
  });
  it("DispDtls gets the name; ExpShipDtls has no Gstin; Stcd is 2-digit", () => {
    const r = toEwbByIrnRequest(IRN, { ...movement(), dispatchFrom, shipTo });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.DispDtls).toEqual({
      Nm: "Alpha Test Warehouse",
      Addr1: "9 Depot Road",
      Addr2: "Industrial Area",
      Loc: "Hosur",
      Pin: "560002",
      Stcd: "29",
    });
    expect(r.value.ExpShipDtls).toEqual({
      Addr1: "Container Freight Station",
      Loc: "Chennai",
      Pin: "600001",
      Stcd: "33",
    });
    expect(JSON.stringify(r.value)).not.toContain("Gstin");
    const text = serializeEwbByIrnRequest(r.value);
    expect(text).toContain('"Pin":560002,"Stcd":"29"');
    expect(text).toContain('"Pin":600001,"Stcd":"33"');
  });
  it("keeps a leading zero in Stcd", () => {
    const r = toEwbByIrnRequest(IRN, {
      ...movement(),
      shipTo: {
        address: { line1: "4 Sector Road", city: "Chandigarh", pincode: "160017", stateCode: "04" },
      },
    });
    expect(r.ok && r.value.ExpShipDtls?.Stcd).toBe("04");
  });
  it("a ship-to without a PIN is rejected (the movement's shipTo uses the model ShipAddressSchema)", () => {
    const r = toEwbByIrnRequest(IRN, {
      ...movement(),
      shipTo: { address: { line1: "4 Sector Road", city: "Chandigarh", stateCode: "04" } },
    });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatchObject({
      code: "BAD_MOVEMENT",
      path: ["movement", "shipTo", "address", "pincode"],
    });
  });
  it("an IRN that is not 64 lowercase hex maps with a warning; a short one fails", () => {
    const upper = toEwbByIrnRequest("A".repeat(64), movement());
    expect(upper.ok).toBe(true);
    expect(upper.issues.map((i) => i.rule)).toEqual(["V-B1"]);
    expect(toEwbByIrnRequest("abc", movement()).ok).toBe(false);
  });
  it("transport rules apply on the by-IRN route (road without vehicle)", () => {
    const r = toEwbByIrnRequest(IRN, movement({ vehicleNo: undefined }));
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.rule)).toContain("V-T2");
  });
  it("a malformed movement → BAD_MOVEMENT", () => {
    const r = toEwbByIrnRequest(IRN, { transport: { distanceKm: "-1" } });
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.code).toBe("BAD_MOVEMENT");
  });
});

describe("toIrnEwbDtls", () => {
  it("returns the EwbDtls block, omitting what is absent", () => {
    const r = toIrnEwbDtls(movement());
    expect(r).toEqual({
      ok: true,
      value: { TransMode: "1", Distance: "150", VehNo: "KA01AB1234", VehType: "R" },
      issues: [],
    });
  });
  it("passes validateIrnRequest when attached to a mapped e-invoice fixture", () => {
    const irn = toIrnRequest(parsed("intraInvoice"));
    expect(irn.ok).toBe(true);
    const block = toIrnEwbDtls(
      movement({ transporterId: GSTINS.spareKa, transporterName: "Test Carriers" }),
    );
    expect(block.ok).toBe(true);
    if (!irn.ok || !block.ok) return;
    const result = validateIrnRequest({ ...irn.value, EwbDtls: block.value });
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
  });
  it("applies the EwbDtls Ship rule (vehicle type must be O)", () => {
    const ok = toIrnEwbDtls(movement({ mode: "SHIP", vehicleType: "ODC" }));
    expect(ok.ok).toBe(true);
    const bad = toIrnEwbDtls(movement({ mode: "SHIP", vehicleType: "REGULAR" }));
    expect(bad.ok).toBe(false);
    expect(bad.issues.map((i) => i.rule)).toContain("V-T4");
  });
  it("agrees with validateEwbDtls on its own output", () => {
    const r = toIrnEwbDtls(movement());
    expect(r.ok && validateEwbDtls(r.value).ok).toBe(true);
  });
});
