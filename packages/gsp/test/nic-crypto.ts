// Test-side NIC crypto, written independently of src/crypto.ts so the two check each other. Keys are generated
// inside the test run; nothing here is a real key.
import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHmac,
  generateKeyPairSync,
  privateDecrypt,
  type KeyObject,
} from "node:crypto";

export type TestKeys = { publicPem: string; privateKey: KeyObject };

let cached: TestKeys | undefined;

/** One 2048-bit RSA key pair per test file (generation is slow). */
export function testKeys(): TestKeys {
  if (cached === undefined) {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    cached = {
      publicPem: publicKey.export({ type: "spki", format: "pem" }),
      privateKey,
    };
  }
  return cached;
}

/** RSA decrypt without padding, then strip the PKCS#1 v1.5 type-2 block by hand. */
export function rsaDecryptPkcs1(cipherBase64: string, privateKey: KeyObject): Buffer {
  const block = privateDecrypt(
    { key: privateKey, padding: constants.RSA_NO_PADDING },
    Buffer.from(cipherBase64, "base64"),
  );
  if (block[0] !== 0x00 || block[1] !== 0x02) throw new Error("not a PKCS#1 v1.5 type-2 block");
  const sep = block.indexOf(0x00, 2);
  if (sep < 10) throw new Error("PKCS#1 v1.5 padding too short");
  return block.subarray(sep + 1);
}

const algo = (key: Buffer) => (key.length === 16 ? "aes-128-ecb" : "aes-256-ecb");

export function aesEnc(plain: Buffer, key: Buffer): string {
  const c = createCipheriv(algo(key), key, null);
  return Buffer.concat([c.update(plain), c.final()]).toString("base64");
}

export function aesDec(b64: string, key: Buffer): Buffer {
  const d = createDecipheriv(algo(key), key, null);
  return Buffer.concat([d.update(Buffer.from(b64, "base64")), d.final()]);
}

export function hmacB64(key: Buffer, message: string): string {
  return createHmac("sha256", key).update(message, "ascii").digest("base64");
}

/** Deterministic "random" bytes for tests: a counter-based stream, never cryptographic. */
export function seededRandom(seed = 1): (n: number) => Uint8Array {
  let state = seed;
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      state = (state * 1103515245 + 12345) % 2147483648;
      out[i] = state & 0xff;
    }
    return out;
  };
}
