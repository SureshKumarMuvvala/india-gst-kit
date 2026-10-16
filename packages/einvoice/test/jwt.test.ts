import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeJwt,
  decodeSignedInvoice,
  decodeSignedQrCode,
  validateIrnRequest,
  type IrnIssue,
} from "../src/index.js";
import { hits, omit } from "./helpers.js";

const SAMPLE = JSON.parse(
  readFileSync(
    new URL("../../../sources/einvoice/sample-signed-einvoice.json", import.meta.url),
    "utf8",
  ),
) as { SignedInvoice: string; SignedQRCode: string };

const b64 = (v: unknown) =>
  Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const parts = (jwt: string) => jwt.split(".") as [string, string, string];
const decodeSegment = (s: string) =>
  JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as Record<string, unknown>;

const [invH, invC, invS] = parts(SAMPLE.SignedInvoice);
const [qrH, qrC] = parts(SAMPLE.SignedQRCode);
const header = decodeSegment(invH);
const claims = decodeSegment(invC);
const invData = JSON.parse(claims["data"] as string) as Record<string, unknown>;
const qrData = JSON.parse(decodeSegment(qrC)["data"] as string) as Record<string, unknown>;

const jwt = (h: unknown, c: unknown, sig = invS) => `${b64(h)}.${b64(c)}.${sig}`;
const invJwt = (data: unknown, h: unknown = header) =>
  jwt(h, { ...claims, data: JSON.stringify(data) });
const qrJwt = (data: unknown, h: unknown = header) =>
  jwt(h, { iss: "NIC", data: JSON.stringify(data) });
const codes = (issues: readonly IrnIssue[]) => issues.map((i) => i.code);

describe("decodeJwt", () => {
  it("decodes the official sample's header and claims", () => {
    const r = decodeJwt(SAMPLE.SignedInvoice);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.value?.header.alg).toBe("RS256");
    expect(r.value?.header.typ).toBe("JWT");
    expect(r.value?.header.kid.startsWith("115F4426")).toBe(true);
    expect(r.value?.claims.iss).toBe("NIC");
    expect(typeof r.value?.claims.data).toBe("string");
    expect(r.value?.signature).toBe(invS);
    expect(r.value?.signingInput).toBe(`${invH}.${invC}`);
    expect(r.signatureVerified).toBe(false);
    expect(r.raw).toMatchObject({ header: { alg: "RS256" }, claims: { iss: "NIC" } });
  });

  it("throws only for a programmer error (non-string argument)", () => {
    expect(() => decodeJwt(42 as unknown as string)).toThrow(TypeError);
  });

  describe("errors", () => {
    it("fewer than 3 segments → MALFORMED_JWT", () => {
      const r = decodeJwt(`${invH}.${invC}`);
      expect(r.ok).toBe(false);
      expect(codes(r.issues)).toEqual(["MALFORMED_JWT"]);
      expect(r.value).toBeUndefined();
      expect(r.signatureVerified).toBe(false);
    });
    it("4 segments and the empty string → MALFORMED_JWT", () => {
      expect(codes(decodeJwt(`${invH}.${invC}.${invS}.x`).issues)).toEqual(["MALFORMED_JWT"]);
      expect(codes(decodeJwt("").issues)).toEqual(["MALFORMED_JWT"]);
    });
    it("bad base64url (characters, padding, impossible length) → BAD_BASE64URL", () => {
      for (const bad of ["!!!!", `${invH}=`, "a"]) {
        const r = decodeJwt(`${bad}.${invC}.${invS}`);
        expect(codes(r.issues), bad).toContain("BAD_BASE64URL");
        expect(r.ok).toBe(false);
      }
      expect(codes(decodeJwt(`${invH}.${invC}.a$b`).issues)).toContain("BAD_BASE64URL");
    });
    it("non-JSON header or claims → BAD_JSON", () => {
      expect(codes(decodeJwt(`${b64("not json")}.${invC}.${invS}`).issues)).toContain("BAD_JSON");
      expect(codes(decodeJwt(`${invH}.${b64("{nope")}.${invS}`).issues)).toContain("BAD_JSON");
    });
    it("header or claims that are not objects are errors", () => {
      expect(decodeJwt(`${b64("[]")}.${invC}.${invS}`).ok).toBe(false);
      expect(decodeJwt(`${invH}.${b64("7")}.${invS}`).ok).toBe(false);
    });
    it("alg none and alg HS256 → UNSUPPORTED_ALG", () => {
      for (const alg of ["none", "HS256"]) {
        const r = decodeJwt(jwt({ ...header, alg }, claims, ""));
        expect(codes(r.issues), alg).toContain("UNSUPPORTED_ALG");
        expect(r.ok).toBe(false);
      }
    });
    it("a missing kid (or any other required field) is an error", () => {
      const r = decodeJwt(jwt(omit(header, "kid"), claims));
      expect(r.ok).toBe(false);
      expect(r.issues.map((i) => i.path.join("."))).toContain("header.kid");
      expect(
        decodeJwt(jwt(header, omit(claims, "data"))).issues.map((i) => i.path.join(".")),
      ).toContain("claims.data");
      expect(decodeJwt(jwt({ ...header, kid: 5 }, claims)).ok).toBe(false);
    });
  });

  describe("unknown keys are warnings, never silent and never blocking (D-Q5)", () => {
    it("an extra header key", () => {
      const r = decodeJwt(jwt({ ...header, extra: "x" }, claims));
      expect(r.ok).toBe(true);
      expect(r.issues).toHaveLength(1);
      expect(r.issues[0]).toMatchObject({ code: "UNEXPECTED_KEY", severity: "warning" });
      expect(r.issues[0]?.path).toEqual(["header", "extra"]);
      expect((r.raw as { header: Record<string, unknown> }).header["extra"]).toBe("x");
      expect(r.value?.header.kid).toBe(header["kid"]);
    });
    it("an extra claim", () => {
      const r = decodeJwt(jwt(header, { ...claims, exp: 1_700_000_000 }));
      expect(r.ok).toBe(true);
      expect(r.issues[0]?.path).toEqual(["claims", "exp"]);
      expect((r.raw as { claims: Record<string, unknown> }).claims["exp"]).toBe(1_700_000_000);
    });
  });
});

describe("decodeSignedInvoice", () => {
  const r = decodeSignedInvoice(SAMPLE.SignedInvoice);

  it("decodes the official sample with lossless numbers and no issues", () => {
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.signatureVerified).toBe(false);
    expect(r.value?.AckNo).toBe("112010000011474");
    expect(r.value?.AckDt).toBe("2020-08-05 22:55:00");
    expect(r.value?.Irn).toMatch(/^[0-9a-f]{64}$/);
    expect(r.value?.ValDtls.TotInvVal).toBe("16650");
    expect(r.value?.ItemList[0]?.IgstAmt).toBe("747.5");
    expect(r.value?.ItemList[0]?.ItemNo).toBe("1");
    expect(r.value?.SellerDtls.Pin).toBe("518001");
    expect(r.value?.Version).toBe("1.01");
  });

  it("returns the raw JSON as published", () => {
    expect((r.raw as { data: { AckNo: number } }).data.AckNo).toBe(112010000011474);
  });

  it("the request part: V20–V28 pass; V1, V4 and both V5 check digits fail", () => {
    const value = r.value as NonNullable<typeof r.value>;
    const request = {
      ...omit(value, "AckNo", "AckDt", "Irn"),
      ItemList: value.ItemList.map((it) => omit(it, "ItemNo")),
    };
    const v = validateIrnRequest(request);
    const arithmetic = v.issues.filter((i) => /^V2[0-8]$/.test(i.rule));
    expect(arithmetic).toEqual([]);
    expect(hits(v.issues, "V1")).toHaveLength(1);
    expect(hits(v.issues, "V4")).toHaveLength(1);
    expect(hits(v.issues, "V5").map((i) => i.path.join("."))).toEqual([
      "SellerDtls.Gstin",
      "BuyerDtls.Gstin",
    ]);
    expect([...new Set(v.issues.map((i) => i.rule))].sort()).toEqual(["V1", "V4", "V5"]);

    const off = validateIrnRequest(request, { gstinCheckDigit: "off" });
    expect(off.issues).toEqual(v.issues.filter((i) => i.rule !== "V5"));
  });

  it("unknown keys at any level are warnings; the value keeps the known keys, raw keeps all", () => {
    const data = {
      ...invData,
      Extra: 1,
      SellerDtls: { ...(invData["SellerDtls"] as object), Foo: "bar" },
      ItemList: (invData["ItemList"] as object[]).map((i) => ({ ...i, Bar: 2 })),
    };
    const d = decodeSignedInvoice(invJwt(data));
    expect(d.ok).toBe(true);
    expect(d.issues.map((i) => i.path.join(".")).sort()).toEqual(
      ["data.Extra", "data.ItemList.0.Bar", "data.SellerDtls.Foo"].sort(),
    );
    expect(d.issues.every((i) => i.code === "UNEXPECTED_KEY" && i.severity === "warning")).toBe(
      true,
    );
    expect(d.value?.ValDtls.TotInvVal).toBe("16650");
    expect(d.value).not.toHaveProperty("Extra");
    expect((d.raw as { data: Record<string, unknown> }).data["Extra"]).toBe(1);
  });

  it("an extra header key is a warning here too", () => {
    const d = decodeSignedInvoice(invJwt(invData, { ...header, foo: 1 }));
    expect(d.ok).toBe(true);
    expect(d.issues.map((i) => i.path.join("."))).toEqual(["header.foo"]);
  });

  it("errors: a bad Irn, a missing required field, data that is not JSON, data that is not an object", () => {
    expect(decodeSignedInvoice(invJwt({ ...invData, Irn: "XYZ" })).ok).toBe(false);
    const missing = decodeSignedInvoice(invJwt(omit(invData, "ValDtls")));
    expect(missing.ok).toBe(false);
    expect(missing.issues.map((i) => i.path.join("."))).toContain("data.ValDtls");
    expect(missing.value).toBeUndefined();
    expect(codes(decodeSignedInvoice(jwt(header, { ...claims, data: "{nope" })).issues)).toContain(
      "BAD_JSON",
    );
    expect(decodeSignedInvoice(jwt(header, { ...claims, data: "[1]" })).ok).toBe(false);
  });

  it("a number where a string belongs, and the reverse, are WRONG_TYPE errors", () => {
    const a = decodeSignedInvoice(invJwt({ ...invData, AckDt: 20200805 }));
    expect(a.issues.find((i) => i.path.join(".") === "data.AckDt")?.code).toBe("WRONG_TYPE");
    const b = decodeSignedInvoice(
      invJwt({ ...invData, ValDtls: { ...(invData["ValDtls"] as object), TotInvVal: "16650" } }),
    );
    expect(b.issues.find((i) => i.path.join(".") === "data.ValDtls.TotInvVal")?.code).toBe(
      "WRONG_TYPE",
    );
  });

  it("JWT-level errors are passed through and nothing is decoded", () => {
    const d = decodeSignedInvoice("a.b");
    expect(d.ok).toBe(false);
    expect(codes(d.issues)).toEqual(["MALFORMED_JWT"]);
    expect(d.value).toBeUndefined();
    expect(d.signatureVerified).toBe(false);
  });
});

describe("decodeSignedQrCode", () => {
  const r = decodeSignedQrCode(SAMPLE.SignedQRCode);

  it("decodes the official sample: the 9 keys and no issues", () => {
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.value ?? {}).sort()).toEqual(
      [
        "BuyerGstin",
        "DocDt",
        "DocNo",
        "DocTyp",
        "Irn",
        "ItemCnt",
        "MainHsnCode",
        "SellerGstin",
        "TotInvVal",
      ].sort(),
    );
    expect(r.value).toMatchObject({
      DocNo: "CTDN23456",
      DocTyp: "INV",
      DocDt: "05/08/2020",
      TotInvVal: "16650",
      ItemCnt: "1",
      MainHsnCode: "39231010",
    });
    expect(r.signatureVerified).toBe(false);
    expect(qrH).toBe(invH);
  });

  it("the QR carries the same IRN and GSTINs as the signed invoice", () => {
    const inv = decodeSignedInvoice(SAMPLE.SignedInvoice).value;
    expect(r.value?.Irn).toBe(inv?.Irn);
    expect(r.value?.SellerGstin).toBe(inv?.SellerDtls.Gstin);
    expect(r.value?.BuyerGstin).toBe(inv?.BuyerDtls.Gstin);
  });

  it("an extra key (e.g. an IRN date) is an UNEXPECTED_KEY warning (D-Q5)", () => {
    const d = decodeSignedQrCode(qrJwt({ ...qrData, IrnDt: "2020-08-05 22:55:00" }));
    expect(d.ok).toBe(true);
    expect(d.issues).toHaveLength(1);
    expect(d.issues[0]).toMatchObject({ code: "UNEXPECTED_KEY", severity: "warning" });
    expect(d.issues[0]?.path).toEqual(["data", "IrnDt"]);
    expect(d.value).not.toHaveProperty("IrnDt");
    expect((d.raw as { data: Record<string, unknown> }).data["IrnDt"]).toBe("2020-08-05 22:55:00");
  });

  it("errors: a missing key, a wrong document type, a bad date", () => {
    expect(decodeSignedQrCode(qrJwt(omit(qrData, "Irn"))).ok).toBe(false);
    expect(decodeSignedQrCode(qrJwt({ ...qrData, DocTyp: "XXX" })).ok).toBe(false);
    expect(decodeSignedQrCode(qrJwt({ ...qrData, DocDt: "2020-08-05" })).ok).toBe(false);
  });

  it("alg none is rejected here too", () => {
    expect(
      codes(
        decodeSignedQrCode(jwt({ ...header, alg: "none" }, { iss: "NIC", data: "{}" }, "")).issues,
      ),
    ).toContain("UNSUPPORTED_ALG");
  });
});
