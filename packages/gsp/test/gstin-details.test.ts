import { describe, expect, it } from "vitest";
import { normaliseGstinDetails } from "../src/index.js";
import { codes, expectErr, GSTIN, GSTINS, omit, setup } from "./helpers.js";

const ei = (over: Record<string, unknown> = {}) => ({
  Gstin: GSTINS.recipientMh,
  TradeName: "Mock Traders",
  LegalName: "Mock Legal",
  AddrBnm: null,
  AddrBno: "1",
  AddrFlno: "",
  AddrSt: "Street",
  AddrLoc: "Town",
  StateCode: 27,
  AddrPncd: 400001,
  TxpType: "REG",
  Status: "ACT",
  BlkStatus: "U",
  DtReg: "2021-05-03",
  DtDReg: null,
  ...over,
});
const ew = (over: Record<string, unknown> = {}) => ({
  gstin: GSTINS.recipientMh,
  tradeName: "Mock Traders",
  legalName: "Mock Legal",
  address1: "Street",
  address2: "Town",
  stateCode: "27",
  pinCode: "400001",
  txpType: "REG",
  status: "ACT",
  blkStatus: "U",
  ...over,
});

describe("normaliseGstinDetails (spec §9)", () => {
  it("e-invoice numbers and e-way bill strings give the same core fields", () => {
    const a = normaliseGstinDetails(ei(), "einvoice");
    const b = normaliseGstinDetails(ew(), "ewaybill");
    if (!a.ok || !b.ok) throw new Error("x");
    for (const k of [
      "gstin",
      "tradeName",
      "legalName",
      "stateCode",
      "pincode",
      "taxpayerType",
      "status",
      "isActive",
      "blockStatus",
    ] as const) {
      expect(a.value[k]).toStrictEqual(b.value[k]);
    }
    expect(a.value.stateCode).toBe("27");
    expect(a.value.address).toStrictEqual({
      buildingName: null,
      buildingNo: "1",
      floorNo: null,
      street: "Street",
      location: "Town",
      line1: null,
      line2: null,
    });
    expect(b.value.address.line1).toBe("Street");
  });

  it.each([
    ["ACT", true, false],
    ["ACT ", true, false],
    ["act", false, true],
    ["INA", false, false],
    ["PRO", false, false],
    ["CNL", false, false],
    [null, false, true],
    ["XYZ", false, true],
  ])("status %j ⇒ isActive %s (warning %s)", (status, active, warned) => {
    const r = normaliseGstinDetails(ei({ Status: status }), "einvoice");
    expect(r.ok && r.value.isActive).toBe(active);
    expect(r.warnings.some((w) => w.code === "UNKNOWN_GSTIN_STATUS")).toBe(warned);
  });

  it("missing status ⇒ inactive + warning", () => {
    const r = normaliseGstinDetails(omit(ew(), "status"), "ewaybill");
    expect(r.ok && r.value.isActive).toBe(false);
    expect(codes(r)).toContain("UNKNOWN_GSTIN_STATUS");
  });

  it.each([
    ["U", "UNBLOCKED"],
    ["", "UNBLOCKED"],
    [" ", "UNBLOCKED"],
    ["B", "BLOCKED"],
    [null, "UNKNOWN"],
  ])("block status %j ⇒ %s", (blk, expected) => {
    const r = normaliseGstinDetails(ew({ blkStatus: blk }), "ewaybill");
    expect(r.ok && r.value.blockStatus).toBe(expected);
  });

  it("unknown keys warn; unusual state/PIN warn; no GSTIN fails", () => {
    const r = normaliseGstinDetails(ei({ Extra: 1, StateCode: "MH", AddrPncd: 4000 }), "einvoice");
    expect(codes(r).sort()).toStrictEqual([
      "UNEXPECTED_KEY",
      "UNUSUAL_PINCODE",
      "UNUSUAL_STATE_CODE",
    ]);
    expect(normaliseGstinDetails(ei({ Gstin: "" }), "einvoice").ok).toBe(false);
    expect(normaliseGstinDetails([], "einvoice").ok).toBe(false);
  });
});

describe("target GSTIN argument (D-G19)", () => {
  it("bad pattern ⇒ validation error, nothing sent", async () => {
    const s = setup();
    expect(
      expectErr(await s.client.einvoice.getGstinDetails({ gstin: GSTIN, target: "29ABCDE" })).kind,
    ).toBe("validation");
    expect(
      expectErr(
        await s.client.ewaybill.getGstinDetails({ gstin: GSTIN, target: "99AAAAA0000A1Z5" }),
      ).kind,
    ).toBe("validation");
    expect(s.mock.requests).toHaveLength(0);
  });
  it("bad check digit ⇒ sent with GSTIN_CHECK_DIGIT warning", async () => {
    const s = setup();
    const t = `${GSTINS.recipientMh.slice(0, 14)}${GSTINS.recipientMh.endsWith("A") ? "B" : "A"}`;
    const r = await s.client.einvoice.getGstinDetails({ gstin: GSTIN, target: t });
    expect(r.ok).toBe(true);
    expect(codes(r)).toContain("GSTIN_CHECK_DIGIT");
  });
});
