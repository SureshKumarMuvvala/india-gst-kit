import { describe, expect, it } from "vitest";
import {
  decodeNicEnvelope,
  describeErrorCode,
  parseEinvoiceErrors,
  parseEwbErrors,
} from "../src/index.js";
import { expectErr, GSTIN, GSTINS, setup } from "./helpers.js";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

describe("decodeNicEnvelope (spec §7.1)", () => {
  it.each([
    ['{"Status":1}', 1],
    ['{"Status":"1"}', 1],
    ['{"status":0}', 0],
    ['{"status":"0"}', 0],
  ])("status %s", (body, status) => {
    const r = decodeNicEnvelope(body);
    expect(r.ok && r.value.status).toBe(status);
  });
  it("status 2 ⇒ bad-envelope; non-JSON ⇒ bad-json; array ⇒ bad-envelope", () => {
    expect(decodeNicEnvelope('{"status":2}')).toMatchObject({
      ok: false,
      error: { reason: "bad-envelope" },
    });
    expect(decodeNicEnvelope("<html>")).toMatchObject({ ok: false, error: { reason: "bad-json" } });
    expect(decodeNicEnvelope("[]")).toMatchObject({ ok: false, error: { reason: "bad-envelope" } });
  });
  it("Data/data, InfoDtls/Alert/alert/info all land in data / info", () => {
    for (const [k, v] of [
      ["InfoDtls", "a"],
      ["Alert", "b"],
      ["alert", "c"],
      ["info", "d"],
    ] as const) {
      const r = decodeNicEnvelope(JSON.stringify({ Status: "1", Data: "x", [k]: v }));
      expect(r.ok && [r.value.data, r.value.info]).toStrictEqual(["x", v]);
    }
  });
  it("an unknown top-level key is an UNEXPECTED_KEY warning", () => {
    const r = decodeNicEnvelope('{"status":"1","data":"x","surprise":1}');
    expect(r.ok && r.value.warnings.map((w) => w.code)).toStrictEqual(["UNEXPECTED_KEY"]);
  });
});

describe("error details (spec §7.2)", () => {
  const one = [{ code: "2150", message: "Duplicate IRN" }];
  it("e-invoice ErrorDetails: array, object, JSON string, Base64 JSON", () => {
    const arr = [{ ErrorCode: "2150", ErrorMessage: "Duplicate IRN" }];
    expect(parseEinvoiceErrors(arr)).toStrictEqual(one);
    expect(parseEinvoiceErrors(arr[0])).toStrictEqual(one);
    expect(parseEinvoiceErrors(JSON.stringify(arr))).toStrictEqual(one);
    expect(parseEinvoiceErrors(b64(arr))).toStrictEqual(one);
    expect(parseEinvoiceErrors([{ errorcode: 2150 }])).toStrictEqual([{ code: "2150" }]);
  });
  it("garbage ⇒ UNKNOWN in the envelope", () => {
    const r = decodeNicEnvelope('{"Status":"0","ErrorDetails":"<Errors JSON >"}');
    expect(r.ok && r.value.errors).toStrictEqual([{ code: "UNKNOWN" }]);
  });
  it("EWB error.errorCodes: number, string, comma list, Base64 JSON", () => {
    expect(parseEwbErrors({ errorCodes: 240 })).toStrictEqual([{ code: "240" }]);
    expect(parseEwbErrors({ errorCodes: "240" })).toStrictEqual([{ code: "240" }]);
    expect(parseEwbErrors({ errorCodes: "240, 241," })).toStrictEqual([
      { code: "240" },
      { code: "241" },
    ]);
    expect(parseEwbErrors(b64({ errorCodes: "312" }))).toStrictEqual([{ code: "312" }]);
  });
});

describe("errors through the client", () => {
  it("HTTP 500 with a status-0 envelope ⇒ api with httpStatus 500", async () => {
    const s = setup();
    s.mock.on("einvoice.getGstinDetails", () => ({ errors: [{ code: "M1" }], httpStatus: 500 }));
    const e = expectErr(
      await s.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }),
    );
    expect(e).toMatchObject({
      kind: "api",
      httpStatus: 500,
      errors: [{ code: "M1" }],
      system: "einvoice",
      op: "einvoice.getGstinDetails",
    });
  });
  it("HTTP 502 with HTML ⇒ transport/http", async () => {
    const s = setup();
    s.mock.on("einvoice.getGstinDetails", () => ({
      raw: "<html>bad gateway</html>",
      httpStatus: 502,
    }));
    expect(
      expectErr(
        await s.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }),
      ),
    ).toMatchObject({
      kind: "transport",
      reason: "http",
      httpStatus: 502,
    });
  });
  it("info from a status-0 envelope is kept", async () => {
    const s = setup();
    s.mock.on("einvoice.getGstinDetails", () => ({ errors: [{ code: "M2" }], info: "try later" }));
    expect(
      expectErr(
        await s.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }),
      ),
    ).toMatchObject({ info: "try later" });
  });
});

describe("describeErrorCode (D-G20)", () => {
  it("no shipped table; a caller table is used", () => {
    expect(describeErrorCode("einvoice", "2150")).toBeUndefined();
    const table = [
      {
        system: "einvoice" as const,
        code: "2150",
        message: "Duplicate IRN",
        source: "caller",
        retrieved: "2026-10-18",
      },
    ];
    expect(describeErrorCode("einvoice", " 2150 ", table)?.message).toBe("Duplicate IRN");
    expect(describeErrorCode("ewaybill", "2150", table)).toBeUndefined();
  });
});
