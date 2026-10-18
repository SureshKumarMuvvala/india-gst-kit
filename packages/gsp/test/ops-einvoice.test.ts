import { serializeIrnRequest, serializeIrnRequest as ser } from "@india-gst-kit/einvoice";
import { serializeEwbByIrnRequest } from "@india-gst-kit/ewaybill";
import { describe, expect, it } from "vitest";
import { testKeys } from "./nic-crypto.js";
import {
  codes,
  ewbByIrnRequest,
  expectErr,
  expectOk,
  GSTIN,
  GSTINS,
  irnRequest,
  setup,
} from "./helpers.js";

const IRN = "0f2a".repeat(16);

describe("e-invoice operations (mock NIC)", () => {
  it("login", async () => {
    const s = setup();
    expectOk(await s.client.einvoice.login({ gstin: GSTIN }));
    const login = JSON.parse(s.mock.last("einvoice.auth")?.decrypted ?? "{}") as Record<
      string,
      unknown
    >;
    expect(Object.keys(login)).toStrictEqual([
      "UserName",
      "Password",
      "AppKey",
      "ForceRefreshAccessToken",
    ]);
  });

  it("login with a 16-byte AppKey (G10) round-trips the SEK", async () => {
    const s = setup({ provider: { appKeyBytes: 16 } });
    expectOk(await s.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }));
    const login = JSON.parse(s.mock.last("einvoice.auth")?.decrypted ?? "{}") as { AppKey: string };
    expect(login.AppKey).toHaveLength(24);
  });

  it("login failures: wrong password ⇒ auth(api); bad public key ⇒ auth(crypto)", async () => {
    const creds = {
      clientId: "mock-client-id",
      clientSecret: "mock-client-secret-0001",
      username: "mockuser",
    };
    const wrong = setup({
      client: {
        credentials: () => ({
          ...creds,
          password: "wrong-password",
          publicKey: testKeys().publicPem,
        }),
      },
    });
    const e1 = expectErr(await wrong.client.einvoice.login({ gstin: GSTIN }));
    expect(e1.kind === "auth" && e1.cause).toMatchObject({
      kind: "api",
      errors: [{ code: "MOCK-BAD-CREDENTIALS" }],
    });
    const noKey = setup({
      client: { credentials: () => ({ ...creds, password: "x", publicKey: "" }) },
    });
    const e2 = expectErr(await noKey.client.einvoice.login({ gstin: GSTIN }));
    expect(e2.kind === "auth" && e2.cause.kind).toBe("crypto");
  });

  it("getGstinDetails / syncGstinDetails", async () => {
    const s = setup();
    const a = expectOk(
      await s.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }),
    );
    expect(a).toMatchObject({
      gstin: GSTINS.recipientMh,
      stateCode: "29",
      pincode: "560001",
      isActive: true,
      blockStatus: "UNBLOCKED",
      source: "einvoice",
    });
    const b = expectOk(
      await s.client.einvoice.syncGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }),
    );
    expect(b.source).toBe("einvoice-sync");
    s.mock.on("einvoice.getGstinDetails", () => ({
      errors: [{ code: "M3", message: "no such GSTIN" }],
    }));
    expect(
      expectErr(
        await s.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }),
      ),
    ).toMatchObject({ kind: "api", errors: [{ code: "M3", message: "no such GSTIN" }] });
  });

  it("generateIrn: sends exactly serializeIrnRequest, decodes the signed JWTs (not verified)", async () => {
    const s = setup();
    const req = irnRequest();
    const r = await s.client.einvoice.generateIrn({ gstin: GSTIN, request: req });
    const v = expectOk(r);
    expect(s.mock.last("einvoice.generateIrn")?.decrypted).toBe(serializeIrnRequest(req));
    expect(v.details).toMatchObject({
      AckNo: "112010000000001",
      Irn: IRN,
      Status: "ACT",
      EwbNo: null,
    });
    expect(v.signedInvoice.signatureVerified).toBe(false);
    expect(v.signedQrCode.raw).toBeDefined();
    expect(r.ok && r.info).toBe("mock alert");
  });

  it("generateIrn: a local validation error blocks, nothing sent; skipLocalValidation sends with a warning", async () => {
    const s = setup();
    const bad = { ...irnRequest(), Version: "" };
    const e = expectErr(await s.client.einvoice.generateIrn({ gstin: GSTIN, request: bad }));
    expect(e.kind).toBe("validation");
    expect(s.mock.requests).toHaveLength(0);
    const r = await s.client.einvoice.generateIrn({
      gstin: GSTIN,
      request: bad,
      skipLocalValidation: true,
    });
    expectOk(r);
    expect(codes(r)).toContain("LOCAL_VALIDATION_SKIPPED");
    expect(s.mock.last("einvoice.generateIrn")?.decrypted).toBe(ser(bad));
  });

  it("generateIrn: status 0 (e.g. duplicate) ⇒ api error", async () => {
    const s = setup();
    s.mock.on("einvoice.generateIrn", () => ({
      errors: [{ code: "M-DUP", message: "Duplicate IRN" }],
    }));
    expect(
      expectErr(await s.client.einvoice.generateIrn({ gstin: GSTIN, request: irnRequest() })),
    ).toMatchObject({ kind: "api", errors: [{ code: "M-DUP" }] });
  });

  it("cancelIrn: request JSON, response, pre-check warning; status 0", async () => {
    const s = setup();
    const r = await s.client.einvoice.cancelIrn({
      gstin: GSTIN,
      request: { Irn: IRN, CnlRsn: "2", CnlRem: "Wrong entry" },
      context: { ackDt: "2026-10-17 09:00:00" },
    });
    expect(expectOk(r)).toStrictEqual({ Irn: IRN, CancelDate: "2026-10-18 11:00:00" });
    expect(s.mock.last("einvoice.cancelIrn")?.decrypted).toBe(
      `{"Irn":"${IRN}","CnlRsn":"2","CnlRem":"Wrong entry"}`,
    );
    expect(codes(r)).toContain("IRN_CANCEL_WINDOW_PASSED");
    s.mock.on("einvoice.cancelIrn", () => ({ errors: [{ code: "M4" }] }));
    expect(
      expectErr(
        await s.client.einvoice.cancelIrn({ gstin: GSTIN, request: { Irn: IRN, CnlRsn: "1" } }),
      ).kind,
    ).toBe("api");
  });

  it("getEinvoiceByIrn: path, REJ allowed; bad IRN blocked", async () => {
    const s = setup();
    s.mock.on("einvoice.getEinvoiceByIrn", (req) => ({
      data: {
        AckNo: 1,
        AckDt: "2026-10-18 10:00:00",
        Irn: req.pathParams.irn,
        SignedInvoice: "a.b.c",
        SignedQRCode: "a.b.c",
        Status: "REJ",
      },
    }));
    const r = await s.client.einvoice.getEinvoiceByIrn({ gstin: GSTIN, irn: IRN });
    expect(expectOk(r).details.Status).toBe("REJ");
    expect(codes(r)).not.toContain("UNKNOWN_STATUS");
    expect(
      expectErr(await s.client.einvoice.getEinvoiceByIrn({ gstin: GSTIN, irn: "xyz" })).kind,
    ).toBe("validation");
    s.mock.on("einvoice.getEinvoiceByIrn", () => ({ errors: [{ code: "M5" }] }));
    expect(
      expectErr(await s.client.einvoice.getEinvoiceByIrn({ gstin: GSTIN, irn: IRN })).kind,
    ).toBe("api");
  });

  it("getIrnByDocDetails: query encoding; REJ is an unknown status here", async () => {
    const s = setup();
    s.mock.on("einvoice.getIrnByDocDetails", () => ({
      data: {
        AckNo: 1,
        AckDt: "2026-10-18 10:00:00",
        Irn: IRN,
        SignedInvoice: "a.b.c",
        SignedQRCode: "a.b.c",
        Status: "REJ",
      },
    }));
    const r = await s.client.einvoice.getIrnByDocDetails({
      gstin: GSTIN,
      docType: "INV",
      docNum: "INV/26-1",
      docDate: "18/10/2026",
    });
    expectOk(r);
    expect(codes(r)).toContain("UNKNOWN_STATUS");
    expect(s.mock.last("einvoice.getIrnByDocDetails")?.query).toStrictEqual({
      doctype: "INV",
      docnum: "INV/26-1",
      docdate: "18/10/2026",
    });
    expect(
      expectErr(
        await s.client.einvoice.getIrnByDocDetails({
          gstin: GSTIN,
          docType: "INV",
          docNum: "0BAD",
          docDate: "18/10/2026",
        }),
      ).kind,
    ).toBe("validation");
    s.mock.on("einvoice.getIrnByDocDetails", () => ({ errors: [{ code: "M6" }] }));
    expect(
      expectErr(
        await s.client.einvoice.getIrnByDocDetails({
          gstin: GSTIN,
          docType: "CRN",
          docNum: "C1",
          docDate: "18/10/2026",
        }),
      ).kind,
    ).toBe("api");
  });

  it("getEwbByIrn", async () => {
    const s = setup();
    expect(expectOk(await s.client.einvoice.getEwbByIrn({ gstin: GSTIN, irn: IRN }))).toStrictEqual(
      {
        EwbNo: "131008995134",
        Status: "ACT",
        GenGstin: "29AAAAA0000A1ZY",
        EwbDt: "2026-10-18 10:00:00",
        EwbValidTill: "2026-10-19 23:59:00",
      },
    );
    s.mock.on("einvoice.getEwbByIrn", () => ({ errors: [{ code: "M7" }] }));
    expect(expectErr(await s.client.einvoice.getEwbByIrn({ gstin: GSTIN, irn: IRN })).kind).toBe(
      "api",
    );
  });

  it("generateEwbByIrn reuses @india-gst-kit/ewaybill", async () => {
    const s = setup();
    const req = ewbByIrnRequest();
    const v = expectOk(await s.client.einvoice.generateEwbByIrn({ gstin: GSTIN, request: req }));
    expect(s.mock.last("einvoice.generateEwbByIrn")?.decrypted).toBe(serializeEwbByIrnRequest(req));
    expect(v).toMatchObject({ EwbNo: "111008683051", EwbDt: "2026-10-18 11:28:00" });
    s.mock.on("einvoice.generateEwbByIrn", () => ({ errors: [{ code: "M8" }] }));
    expect(
      expectErr(await s.client.einvoice.generateEwbByIrn({ gstin: GSTIN, request: req })).kind,
    ).toBe("api");
  });

  it("a response that fails its schema ⇒ protocol/response-schema with issues", async () => {
    const s = setup();
    s.mock.on("einvoice.cancelIrn", () => ({ data: { Irn: IRN } }));
    const e = expectErr(
      await s.client.einvoice.cancelIrn({ gstin: GSTIN, request: { Irn: IRN, CnlRsn: "1" } }),
    );
    expect(e).toMatchObject({ kind: "protocol", reason: "response-schema" });
  });

  it("a malformed gstin argument is blocked; a bad check digit warns", async () => {
    const s = setup();
    expect(expectErr(await s.client.einvoice.login({ gstin: "29ABC" })).kind).toBe("validation");
    const badDigit = `${GSTIN.slice(0, 14)}${GSTIN.endsWith("A") ? "B" : "A"}`;
    const r = await s.client.einvoice.getEwbByIrn({ gstin: badDigit, irn: IRN });
    expect(codes(r)).toContain("GSTIN_CHECK_DIGIT");
  });
});
