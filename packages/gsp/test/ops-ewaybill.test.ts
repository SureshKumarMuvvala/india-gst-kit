import { serializeEwbRequest } from "@india-gst-kit/ewaybill";
import { describe, expect, it } from "vitest";
import { codes, ewbRequest, expectErr, expectOk, GSTIN, GSTINS, setup } from "./helpers.js";

const EWB = "111000609282";

describe("e-way bill operations (mock NIC)", () => {
  it("login sends action ACCESSTOKEN and app_key", async () => {
    const s = setup();
    expectOk(await s.client.ewaybill.login({ gstin: GSTIN }));
    const login = JSON.parse(s.mock.last("ewaybill.auth")?.decrypted ?? "{}") as Record<
      string,
      unknown
    >;
    expect(Object.keys(login)).toStrictEqual(["action", "username", "password", "app_key"]);
    expect(login.action).toBe("ACCESSTOKEN");
  });

  it("generate reuses @india-gst-kit/ewaybill and sends its exact JSON", async () => {
    const s = setup();
    const req = ewbRequest();
    const v = expectOk(await s.client.ewaybill.generate({ gstin: GSTIN, request: req }));
    expect(s.mock.last("ewaybill.generate")?.decrypted).toBe(serializeEwbRequest(req));
    expect(v.ewayBillNo).toBe("123456789012");
    s.mock.on("ewaybill.generate", () => ({ errors: [{ code: "240" }] }));
    expect(
      expectErr(await s.client.ewaybill.generate({ gstin: GSTIN, request: req })),
    ).toMatchObject({ kind: "api", errors: [{ code: "240" }] });
  });

  it("generate: a local validation error blocks", async () => {
    const s = setup();
    const e = expectErr(
      await s.client.ewaybill.generate({ gstin: GSTIN, request: { ...ewbRequest(), docNo: "" } }),
    );
    expect(e.kind).toBe("validation");
    expect(s.mock.requests).toHaveLength(0);
  });

  it("updateVehicle: JSON types per the source schema (numbers for ewbNo/fromState)", async () => {
    const s = setup();
    const r = await s.client.ewaybill.updateVehicle({
      gstin: GSTIN,
      request: {
        ewbNo: EWB,
        vehicleNo: "PQR1234",
        fromPlace: "BANGALORE",
        fromState: "29",
        reasonCode: "1",
        reasonRem: "vehicle broke down",
        transMode: "1",
        vehicleType: "R",
      },
      context: { validUpto: "17/10/2026 11:59:00 PM" },
    });
    expect(expectOk(r)).toMatchObject({ vehUpdDate: "18/10/2026 10:56:00 AM" });
    expect(s.mock.last("ewaybill.updateVehicle")?.decrypted).toBe(
      `{"ewbNo":${EWB},"vehicleNo":"PQR1234","fromPlace":"BANGALORE","fromState":29,"reasonCode":"1","reasonRem":"vehicle broke down","transMode":"1","vehicleType":"R"}`,
    );
    expect(codes(r)).toContain("EWB_VALIDITY_EXPIRED");
  });

  it("cancel: cancelRsnCode as a number; 24-hour pre-check", async () => {
    const s = setup();
    const r = await s.client.ewaybill.cancel({
      gstin: GSTIN,
      request: { ewbNo: EWB, cancelRsnCode: "2", cancelRmrk: "Cancelled the order" },
      context: { ewbDate: "18/10/2026 09:00:00 AM", role: "generator" },
    });
    expect(expectOk(r)).toStrictEqual({ ewayBillNo: EWB, cancelDate: "18/10/2026 11:35:00 AM" });
    expect(s.mock.last("ewaybill.cancel")?.decrypted).toBe(
      `{"ewbNo":${EWB},"cancelRsnCode":2,"cancelRmrk":"Cancelled the order"}`,
    );
    expect(r.warnings).toHaveLength(0);
    s.mock.on("ewaybill.cancel", () => ({ errors: [{ code: "312" }] }));
    expect(
      expectErr(
        await s.client.ewaybill.cancel({
          gstin: GSTIN,
          request: { ewbNo: EWB, cancelRsnCode: "1" },
        }),
      ).kind,
    ).toBe("api");
  });

  it("extendValidity", async () => {
    const s = setup();
    const v = expectOk(
      await s.client.ewaybill.extendValidity({
        gstin: GSTIN,
        request: {
          ewbNo: "161000843009",
          vehicleNo: "PQR1234",
          fromPlace: "Bengaluru",
          fromState: "29",
          remainingDistance: "50",
          transMode: "1",
          extnRsnCode: "1",
          extnRemarks: "Flood",
          fromPincode: "560090",
          consignmentStatus: "M",
          transitType: "",
        },
      }),
    );
    expect(v.validUpto).toBe("20/10/2026 11:59:00 PM");
    const sent = JSON.parse(s.mock.last("ewaybill.extendValidity")?.decrypted ?? "{}") as Record<
      string,
      unknown
    >;
    expect([
      typeof sent.ewbNo,
      typeof sent.remainingDistance,
      typeof sent.extnRsnCode,
      typeof sent.fromPincode,
      typeof sent.transMode,
    ]).toStrictEqual(["number", "number", "number", "number", "string"]);
  });

  it("consolidated: per-EWB pre-checks", async () => {
    const s = setup();
    const r = await s.client.ewaybill.consolidated({
      gstin: GSTIN,
      request: {
        fromPlace: "BANGALORE SOUTH",
        fromState: "29",
        vehicleNo: "KA12AB1234",
        transMode: "1",
        tripSheetEwbBills: [{ ewbNo: EWB }, { ewbNo: "181000609270" }],
      },
      context: { ewbs: [{}, { status: "CNL" }] },
    });
    expect(expectOk(r)).toStrictEqual({ cEwbNo: "1810000387", cEWBDate: "18/10/2026 10:27:00 AM" });
    expect(r.warnings.find((w) => w.code === "EWB_CANCELLED")?.path).toStrictEqual([
      "tripSheetEwbBills",
      1,
    ]);
    expect(s.mock.last("ewaybill.consolidated")?.decrypted).toContain(
      `"tripSheetEwbBills":[{"ewbNo":${EWB}},{"ewbNo":181000609270}]`,
    );
  });

  it("updateTransporter", async () => {
    const s = setup();
    const v = expectOk(
      await s.client.ewaybill.updateTransporter({
        gstin: GSTIN,
        request: { ewbNo: "161000843009", transporterId: GSTINS.recipientKa },
      }),
    );
    expect(v).toMatchObject({ ewayBillNo: "161000843009", transporterId: GSTINS.recipientKa });
  });

  it("reject: 72-hour and role pre-checks warn but do not block", async () => {
    const s = setup();
    const r = await s.client.ewaybill.reject({
      gstin: GSTIN,
      request: { ewbNo: "181000609270" },
      context: { ewbDate: "10/10/2026 10:00:00 AM", role: "generator" },
    });
    expectOk(r);
    expect(codes(r)).toStrictEqual(["EWB_REJECT_WINDOW_PASSED", "EWB_REJECT_BY_GENERATOR"]);
    expect(s.mock.count("ewaybill.reject")).toBe(1);
  });

  it("getGstinDetails uses the rek/hmac path", async () => {
    const s = setup();
    const v = expectOk(
      await s.client.ewaybill.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }),
    );
    expect(v).toMatchObject({
      gstin: GSTINS.recipientMh,
      taxpayerType: null,
      isActive: true,
      blockStatus: "BLOCKED",
      source: "ewaybill",
    });
    expect(s.mock.last("ewaybill.getGstinDetails")?.query).toStrictEqual({
      GSTIN: GSTINS.recipientMh,
    });
  });

  it("getGstinDetails: rek in Base64 form is accepted; a tampered HMAC fails closed", async () => {
    expectOk(
      await setup({ mock: { rekForm: "base64" } }).client.ewaybill.getGstinDetails({
        gstin: GSTIN,
        target: GSTINS.recipientMh,
      }),
    );
    const t = setup({ mock: { tamperHmac: true } });
    expect(
      expectErr(
        await t.client.ewaybill.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }),
      ),
    ).toMatchObject({ kind: "protocol", reason: "hmac-mismatch" });
    const off = setup({ mock: { tamperHmac: true }, provider: { verifyHmac: false } });
    const r = await off.client.ewaybill.getGstinDetails({
      gstin: GSTIN,
      target: GSTINS.recipientMh,
    });
    expectOk(r);
    expect(codes(r)).toContain("HMAC_NOT_VERIFIED");
  });

  it("payload plaintext form is configurable; a mismatch with the server fails", async () => {
    const both = setup({
      mock: { forms: { ewaybill: "json" } },
      provider: { payloadPlaintext: { ewaybill: "json" } },
    });
    expectOk(
      await both.client.ewaybill.reject({ gstin: GSTIN, request: { ewbNo: "181000609270" } }),
    );
    const mismatch = setup({ mock: { forms: { ewaybill: "json" } } });
    expect(
      expectErr(
        await mismatch.client.ewaybill.reject({ gstin: GSTIN, request: { ewbNo: "181000609270" } }),
      ),
    ).toMatchObject({ kind: "api", errors: [{ code: "MOCK-DECRYPT" }] });
  });

  it("an unknown key in the response warns and the value keeps the known keys", async () => {
    const s = setup();
    s.mock.on("ewaybill.reject", () => ({
      data: { ewayBillNo: 181000609270, ewbRejectedDate: "18/10/2026 10:24:00 AM", extra: 1 },
    }));
    const r = await s.client.ewaybill.reject({ gstin: GSTIN, request: { ewbNo: "181000609270" } });
    expect(expectOk(r)).toStrictEqual({
      ewayBillNo: "181000609270",
      ewbRejectedDate: "18/10/2026 10:24:00 AM",
    });
    expect(codes(r)).toContain("UNEXPECTED_KEY");
  });

  it("an alert in the decrypted data becomes info", async () => {
    const s = setup();
    s.mock.on("ewaybill.cancel", () => ({
      data: {
        ewayBillNo: EWB,
        cancelDate: "18/10/2026 11:35:00 AM",
        alert: "already cancelled once",
      },
    }));
    const r = await s.client.ewaybill.cancel({
      gstin: GSTIN,
      request: { ewbNo: EWB, cancelRsnCode: "4" },
    });
    expect(r.ok && r.info).toBe("already cancelled once");
  });
});
