// Source: G2 and G10 in sources/README.md; https://einv-apisandbox.nic.in/version1.04/authentication.html —
//         sources/einvoice/api/v1.04-authentication.txt; https://docs.ewaybillgst.gov.in/apidocs/version1.03/authenticationV1.03.html —
//         sources/ewaybill/api/v1.03-authentication.txt, v1.03-get-gstin-details.txt; Java sample excerpts —
//         sources/einvoice/api/java-sample-excerpts.md
// Retrieved: 2026-10-18
// Status: UNVERIFIED — settle on the first live call (spec §15 V3–V5, V9, V17)
//
// node:crypto only (spec D-G24). Every function returns a result object; none logs.
import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPublicKey,
  publicEncrypt,
  timingSafeEqual,
  type KeyObject,
} from "node:crypto";
import type { CryptoError } from "./errors.js";

export type CryptoResult<T> = { ok: true; value: T } | { ok: false; error: CryptoError };
export type PayloadForm = "json" | "base64-json";
export type DecodeFailure = "decrypt-failed" | "bad-response-data" | "hmac-mismatch" | "bad-key";
export type DecodeResult<T> =
  { ok: true; value: T } | { ok: false; reason: DecodeFailure; message: string };

const fail = (
  reason: CryptoError["reason"],
  message: string,
): { ok: false; error: CryptoError } => ({
  ok: false,
  error: { kind: "crypto", reason, message },
});

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Strict standard Base64 (with padding). ASCII whitespace inside is ignored, as in the portals' samples. */
export function decodeBase64(text: string): Uint8Array | undefined {
  const compact = text.replace(/\s+/g, "");
  if (!BASE64.test(compact)) return undefined;
  return new Uint8Array(Buffer.from(compact, "base64"));
}

export function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export type AppKey = { bytes: Uint8Array; base64: string };

/** A random AppKey (D-G7): 32 bytes by default, 16 to match the portals' Java samples (G10). */
export function generateAppKey(randomBytes: (n: number) => Uint8Array, size: 16 | 32 = 32): AppKey {
  if (![16, 32].includes(size)) throw new RangeError("generateAppKey(): size must be 16 or 32");
  const bytes = randomBytes(size);
  if (bytes.length !== size)
    throw new RangeError(`randomBytes(${size}) returned ${bytes.length} bytes`);
  return { bytes: new Uint8Array(bytes), base64: encodeBase64(bytes) };
}

function rsaKey(publicKey: string | KeyObject): KeyObject | undefined {
  try {
    const key = typeof publicKey === "string" ? createPublicKey(publicKey) : publicKey;
    return key.type === "public" && key.asymmetricKeyType === "rsa" ? key : undefined;
  } catch {
    return undefined;
  }
}

/** RSA PKCS#1 v1.5 (`RSA/ECB/PKCS1PADDING`) with the portal's public key; returns Base64. Never truncates. */
export function rsaEncryptLogin(
  plaintext: string | Uint8Array,
  publicKey: string | KeyObject,
): CryptoResult<string> {
  const key = rsaKey(publicKey);
  const bits = key?.asymmetricKeyDetails?.modulusLength;
  if (key === undefined || bits === undefined) {
    return fail(
      "bad-public-key",
      "the public key is not an RSA public key (X.509 SubjectPublicKeyInfo PEM)",
    );
  }
  const input =
    typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : Buffer.from(plaintext);
  const max = Math.floor(bits / 8) - 11;
  if (input.length > max) {
    return fail(
      "rsa-input-too-large",
      `login payload is ${input.length} bytes; the key allows ${max}`,
    );
  }
  const out = publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, input);
  return { ok: true, value: out.toString("base64") };
}

function cipherName(key: Uint8Array): "aes-128-ecb" | "aes-256-ecb" | undefined {
  if (key.length === 16) return "aes-128-ecb";
  if (key.length === 32) return "aes-256-ecb";
  return undefined;
}

/** AES-ECB with PKCS#7 padding (AES-256 for a 32-byte key, AES-128 for 16 bytes); returns Base64. */
export function aesEcbEncrypt(plain: Uint8Array, key: Uint8Array): CryptoResult<string> {
  const name = cipherName(key);
  if (name === undefined)
    return fail("bad-key", `AES key must be 16 or 32 bytes, got ${key.length}`);
  const c = createCipheriv(name, key, null);
  return { ok: true, value: Buffer.concat([c.update(plain), c.final()]).toString("base64") };
}

export function aesEcbDecrypt(cipherBase64: string, key: Uint8Array): CryptoResult<Uint8Array> {
  const name = cipherName(key);
  if (name === undefined)
    return fail("bad-key", `AES key must be 16 or 32 bytes, got ${key.length}`);
  const bytes = decodeBase64(cipherBase64);
  if (bytes === undefined) return fail("decrypt-failed", "ciphertext is not Base64");
  try {
    const d = createDecipheriv(name, key, null);
    return { ok: true, value: new Uint8Array(Buffer.concat([d.update(bytes), d.final()])) };
  } catch {
    return fail("decrypt-failed", "AES decryption failed (wrong key or corrupt data)");
  }
}

/** The SEK, decrypted with the AppKey; it must be 32 bytes (AES-256). */
export function decryptSek(sekBase64: string, appKey: Uint8Array): CryptoResult<Uint8Array> {
  const r = aesEcbDecrypt(sekBase64, appKey);
  if (!r.ok) return r;
  if (r.value.length !== 32) return fail("bad-sek", `SEK is ${r.value.length} bytes; expected 32`);
  return r;
}

/** `json`: Base64(AES(JSON)). `base64-json`: Base64(AES(Base64(JSON))), the literal `Encrypt(Base64(JSON), sek)`. */
export function encodePayload(
  json: string,
  key: Uint8Array,
  form: PayloadForm,
): CryptoResult<string> {
  const utf8 = Buffer.from(json, "utf8");
  const plain = form === "json" ? utf8 : Buffer.from(utf8.toString("base64"), "ascii");
  return aesEcbEncrypt(plain, key);
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** Decrypted payload text as JSON, whichever plaintext form was used (detected and returned). */
export function plaintextToJson(
  plain: Uint8Array,
): DecodeResult<{ json: string; form: PayloadForm }> {
  const text = Buffer.from(plain).toString("utf8");
  if (isJson(text)) return { ok: true, value: { json: text, form: "json" } };
  const inner = decodeBase64(text);
  if (inner !== undefined) {
    const decoded = Buffer.from(inner).toString("utf8");
    if (isJson(decoded)) return { ok: true, value: { json: decoded, form: "base64-json" } };
  }
  return {
    ok: false,
    reason: "bad-response-data",
    message: "decrypted data is neither JSON nor Base64 JSON",
  };
}

export function decodePayload(
  dataBase64: string,
  key: Uint8Array,
): DecodeResult<{ json: string; form: PayloadForm }> {
  const plain = aesEcbDecrypt(dataBase64, key);
  if (!plain.ok) return { ok: false, reason: "decrypt-failed", message: plain.error.message };
  return plaintextToJson(plain.value);
}

export type RekDecoded = {
  json: string;
  form: PayloadForm;
  rekForm: "raw" | "base64";
  hmacVerified: boolean;
  /** The decrypted rek, so the caller can register it for redaction. */
  rek: Uint8Array;
};

/**
 * The e-way bill GetGSTINDetails response: `data` encrypted with a per-response `rek`, `rek` encrypted with the
 * SEK, and `hmac` = HMAC-SHA256 of the Base64 JSON keyed with `rek` (G2, EW-GSTIN). Fails closed on a mismatch.
 */
export function decodeRekResponse(
  response: { data: string; rek: string; hmac: string },
  sek: Uint8Array,
  verify = true,
): DecodeResult<RekDecoded> {
  const rekPlain = aesEcbDecrypt(response.rek, sek);
  if (!rekPlain.ok)
    return { ok: false, reason: "decrypt-failed", message: `rek: ${rekPlain.error.message}` };
  let rek = rekPlain.value;
  let rekForm: "raw" | "base64" = "raw";
  if (rek.length !== 32) {
    const asText = decodeBase64(Buffer.from(rek).toString("ascii"));
    if (asText?.length !== 32) {
      return { ok: false, reason: "bad-key", message: `rek is ${rek.length} bytes; expected 32` };
    }
    rek = asText;
    rekForm = "base64";
  }
  const payload = decodePayload(response.data, rek);
  if (!payload.ok) return payload;
  if (verify) {
    const message = Buffer.from(payload.value.json, "utf8").toString("base64");
    const expected = createHmac("sha256", rek).update(message, "ascii").digest();
    const given = decodeBase64(response.hmac);
    if (given?.length !== expected.length || !timingSafeEqual(given, expected)) {
      return {
        ok: false,
        reason: "hmac-mismatch",
        message: "HMAC-SHA256 of the response data does not match",
      };
    }
  }
  return { ok: true, value: { ...payload.value, rekForm, hmacVerified: verify, rek } };
}
