import { generateKeyPairSync } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  aesEcbDecrypt,
  aesEcbEncrypt,
  buildLoginPlaintext,
  decodePayload,
  decodeRekResponse,
  decryptSek,
  encodePayload,
  generateAppKey,
  rsaEncryptLogin,
} from "../src/index.js";
import { aesDec, aesEnc, hmacB64, rsaDecryptPkcs1, seededRandom, testKeys } from "./nic-crypto.js";

const key32 = Buffer.from(seededRandom(3)(32));
const key16 = Buffer.from(seededRandom(4)(16));

describe("generateAppKey", () => {
  it("is 32 bytes / 44 Base64 characters by default, from the injected source", () => {
    const k = generateAppKey(seededRandom(9));
    expect(k.bytes.length).toBe(32);
    expect(k.base64).toHaveLength(44);
    expect(Buffer.from(k.bytes).equals(Buffer.from(seededRandom(9)(32)))).toBe(true);
  });
  it("is 16 bytes / 24 characters with size 16 (Java samples, G10)", () => {
    const k = generateAppKey(seededRandom(9), 16);
    expect(k.bytes.length).toBe(16);
    expect(k.base64).toHaveLength(24);
  });
  it("throws on another size (programmer error)", () => {
    expect(() => generateAppKey(seededRandom(9), 24 as 16)).toThrow(RangeError);
  });
});

describe("rsaEncryptLogin", () => {
  it("round-trips with a self-generated key pair", () => {
    const { publicPem, privateKey } = testKeys();
    const r = rsaEncryptLogin("eyJoZWxsbyI6IndvcmxkIn0=", publicPem);
    if (!r.ok) throw new Error("expected ok");
    expect(rsaDecryptPkcs1(r.value, privateKey).toString("ascii")).toBe("eyJoZWxsbyI6IndvcmxkIn0=");
  });
  it("is randomised (PKCS#1 v1.5 padding)", () => {
    const a = rsaEncryptLogin("same", testKeys().publicPem);
    const b = rsaEncryptLogin("same", testKeys().publicPem);
    expect(a.ok && b.ok && a.value !== b.value).toBe(true);
  });
  it("refuses input longer than modulus − 11 bytes, never truncating", () => {
    const ok = rsaEncryptLogin("x".repeat(245), testKeys().publicPem);
    expect(ok.ok).toBe(true);
    const r = rsaEncryptLogin("x".repeat(246), testKeys().publicPem);
    expect(r.ok ? undefined : r.error.reason).toBe("rsa-input-too-large");
  });
  it("rejects a malformed PEM and a non-RSA key", () => {
    const bad = rsaEncryptLogin("x", "-----BEGIN PUBLIC KEY-----\nnope\n-----END PUBLIC KEY-----");
    expect(bad.ok ? undefined : bad.error.reason).toBe("bad-public-key");
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey;
    const r = rsaEncryptLogin("x", ec);
    expect(r.ok ? undefined : r.error.reason).toBe("bad-public-key");
  });
});

describe("buildLoginPlaintext", () => {
  const creds = { username: "u1", password: "p1" };
  it("e-invoice: exact keys, boolean ForceRefreshAccessToken, Base64 by default", () => {
    const b64 = buildLoginPlaintext("einvoice", creds, "APPKEY", true);
    expect(JSON.parse(Buffer.from(b64, "base64").toString("utf8"))).toStrictEqual({
      UserName: "u1",
      Password: "p1",
      AppKey: "APPKEY",
      ForceRefreshAccessToken: true,
    });
  });
  it("e-way bill: action ACCESSTOKEN, username, password, app_key; raw JSON when asked", () => {
    const json = buildLoginPlaintext("ewaybill", creds, "APPKEY", false, "json");
    expect(JSON.parse(json)).toStrictEqual({
      action: "ACCESSTOKEN",
      username: "u1",
      password: "p1",
      app_key: "APPKEY",
    });
  });
});

describe("AES-256/128-ECB", () => {
  it("matches an independent implementation byte for byte (deterministic vectors)", () => {
    for (const len of [0, 15, 16, 17, 100]) {
      const plain = Buffer.from(seededRandom(len + 1)(len));
      for (const key of [key32, key16]) {
        const r = aesEcbEncrypt(plain, key);
        expect(r.ok && r.value).toBe(aesEnc(plain, key));
        const back = aesEcbDecrypt(aesEnc(plain, key), key);
        expect(back.ok && Buffer.from(back.value).equals(plain)).toBe(true);
      }
    }
  });
  it("a wrong key or non-Base64 input fails with decrypt-failed", () => {
    const c = aesEnc(Buffer.from("hello world, padded"), key32);
    const wrong = aesEcbDecrypt(c, Buffer.from(seededRandom(99)(32)));
    expect(wrong.ok ? undefined : wrong.error.reason).toBe("decrypt-failed");
    const notB64 = aesEcbDecrypt("***", key32);
    expect(notB64.ok ? undefined : notB64.error.reason).toBe("decrypt-failed");
  });
  it("a 24-byte key is bad-key", () => {
    const r = aesEcbEncrypt(Buffer.from("x"), Buffer.alloc(24));
    expect(r.ok ? undefined : r.error.reason).toBe("bad-key");
  });
});

describe("decryptSek", () => {
  it("returns the 32-byte SEK, with a 32- or 16-byte AppKey", () => {
    const sek = Buffer.from(seededRandom(5)(32));
    for (const appKey of [key32, key16]) {
      const r = decryptSek(aesEnc(sek, appKey), appKey);
      expect(r.ok && Buffer.from(r.value).equals(sek)).toBe(true);
    }
  });
  it("a SEK that decrypts to 16 bytes is bad-sek", () => {
    const r = decryptSek(aesEnc(Buffer.alloc(16, 1), key32), key32);
    expect(r.ok ? undefined : r.error.reason).toBe("bad-sek");
  });
});

describe("encodePayload / decodePayload", () => {
  const json = '{"ewbNo":111000609282,"amt":1180.50}';
  it("json form = Base64(AES(JSON))", () => {
    const r = encodePayload(json, key32, "json");
    expect(r.ok && aesDec(r.value, key32).toString("utf8")).toBe(json);
  });
  it("base64-json form = Base64(AES(Base64(JSON)))", () => {
    const r = encodePayload(json, key32, "base64-json");
    expect(
      r.ok && Buffer.from(aesDec(r.value, key32).toString("ascii"), "base64").toString("utf8"),
    ).toBe(json);
  });
  it("decodes and detects either form", () => {
    for (const form of ["json", "base64-json"] as const) {
      const enc = encodePayload(json, key32, form);
      if (!enc.ok) throw new Error("x");
      const d = decodePayload(enc.value, key32);
      expect(d.ok && d.value).toStrictEqual({ json, form });
    }
  });
  it("garbage plaintext is bad-response-data", () => {
    const d = decodePayload(aesEnc(Buffer.from("not json at all!"), key32), key32);
    expect(d.ok ? undefined : d.reason).toBe("bad-response-data");
  });
});

describe("decodeRekResponse", () => {
  const sek = Buffer.from(seededRandom(11)(32));
  const rek = Buffer.from(seededRandom(12)(32));
  const json = '{"gstin":"29AAAAA0000A1ZY","status":"ACT"}';
  const b64 = Buffer.from(json).toString("base64");
  const good = {
    data: aesEnc(Buffer.from(b64, "ascii"), rek),
    rek: aesEnc(rek, sek),
    hmac: hmacB64(rek, b64),
  };

  it("decrypts rek with the SEK, data with rek, and verifies the HMAC", () => {
    const r = decodeRekResponse(good, sek);
    expect(r.ok && r.value.json).toBe(json);
    expect(r.ok && r.value.hmacVerified).toBe(true);
  });
  it("tampered data or hmac ⇒ hmac-mismatch", () => {
    const otherB64 = Buffer.from('{"gstin":"29AAAAA0000A1ZY","status":"CNL"}').toString("base64");
    const t1 = decodeRekResponse(
      { ...good, data: aesEnc(Buffer.from(otherB64, "ascii"), rek) },
      sek,
    );
    expect(t1.ok ? undefined : t1.reason).toBe("hmac-mismatch");
    const t2 = decodeRekResponse({ ...good, hmac: hmacB64(rek, `${b64}x`) }, sek);
    expect(t2.ok ? undefined : t2.reason).toBe("hmac-mismatch");
  });
  it("verify=false decodes without checking", () => {
    const r = decodeRekResponse({ ...good, hmac: "AAAA" }, sek, false);
    expect(r.ok && r.value.hmacVerified).toBe(false);
  });
  it("accepts rek given as 44-char Base64 text and records the form", () => {
    const r = decodeRekResponse(
      { ...good, rek: aesEnc(Buffer.from(rek.toString("base64"), "ascii"), sek) },
      sek,
    );
    expect(r.ok && r.value.rekForm).toBe("base64");
  });
});

describe("dependencies", () => {
  it("src imports no crypto module other than node:crypto", () => {
    const dir = new URL("../src/", import.meta.url);
    const files = readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".ts"));
    for (const f of files) {
      const text = readFileSync(new URL(f, dir), "utf8");
      const imports = [...text.matchAll(/from "([^"]+)"/g)].map((m) => m[1] ?? "");
      const external = imports.filter((m) => !m.startsWith(".") && !m.startsWith("node:"));
      expect(
        external.every((m) =>
          [
            "zod",
            "@india-gst-kit/model",
            "@india-gst-kit/einvoice",
            "@india-gst-kit/ewaybill",
          ].includes(m),
        ),
      ).toBe(true);
    }
  });
});
