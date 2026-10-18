import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import {
  createGspClient,
  createNicDirectProvider,
  REDACTED,
  Secret,
  type GspResult,
} from "../src/index.js";
import { CREDENTIALS, EI_BASE, EWB_BASE } from "./mock-nic.js";
import { seededRandom, testKeys } from "./nic-crypto.js";
import { GSTIN, GSTINS, setup } from "./helpers.js";

/** Every secret the client saw: credentials, AppKeys, tokens, SEKs (Base64 and hex), rek, the RSA login blob. */
function secretsOf(s: ReturnType<typeof setup>): string[] {
  const out = [CREDENTIALS.clientSecret, CREDENTIALS.password];
  for (const [token, rec] of s.mock.tokens)
    out.push(token, rec.sek.toString("base64"), rec.sek.toString("hex"));
  for (const r of s.mock.requests) {
    if (r.op.endsWith(".auth")) {
      const data = r.body?.Data;
      if (typeof data === "string") out.push(data);
      const login = JSON.parse(r.decrypted ?? "{}") as Record<string, unknown>;
      const appKey = (login.AppKey ?? login.app_key) as string;
      out.push(appKey, Buffer.from(appKey, "base64").toString("hex"));
    }
  }
  return out;
}

function assertClean(text: string, secrets: readonly string[]): void {
  for (const sec of secrets) expect(text.includes(sec), `leaked ${sec.slice(0, 6)}…`).toBe(false);
}

describe("redaction (spec §6.4)", () => {
  it("errors, warnings and log events of every kind carry no secret", async () => {
    const s = setup({ client: { getRetries: 1 } });
    const results: GspResult<unknown>[] = [];
    results.push(await s.client.einvoice.login({ gstin: GSTIN }));
    results.push(
      await s.client.ewaybill.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }),
    );
    // api error that echoes the token and SEK back
    const tok = [...s.mock.tokens.keys()][0] ?? "";
    s.mock.on("einvoice.getGstinDetails", () => ({
      errors: [{ code: "X", message: `bad token ${tok}` }],
      info: `sek=${tok}`,
    }));
    results.push(
      await s.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }),
    );
    // protocol error with the body echoed
    s.mock.on("einvoice.cancelIrn", () => ({ raw: `not json ${tok}` }));
    results.push(
      await s.client.einvoice.cancelIrn({
        gstin: GSTIN,
        request: { Irn: "a".repeat(64), CnlRsn: "1" },
      }),
    );
    // response-schema error carrying raw data
    s.mock.on("ewaybill.reject", () => ({ data: { surprise: tok } }));
    results.push(
      await s.client.ewaybill.reject({ gstin: GSTIN, request: { ewbNo: "181000609270" } }),
    );
    // transport and auth errors
    const broken = setup({
      clock: s.clock,
      client: { fetch: () => Promise.reject(new TypeError(`down ${CREDENTIALS.password}`)) },
    });
    results.push(await broken.client.einvoice.login({ gstin: GSTIN }));

    expect(results.flatMap((r) => (r.ok ? [] : [r.error.kind]))).toStrictEqual([
      "api",
      "protocol",
      "protocol",
      "auth",
    ]);
    const secrets = secretsOf(s);
    assertClean(JSON.stringify(results), secrets);
    assertClean(JSON.stringify(s.logs), secrets);
    assertClean(JSON.stringify(broken.logs), secrets);
    expect(JSON.stringify(results)).toContain(REDACTED);
  });

  it("log events never contain bodies", async () => {
    const s = setup();
    await s.client.ewaybill.reject({ gstin: GSTIN, request: { ewbNo: "181000609270" } });
    for (const e of s.logs) expect(Object.keys(e)).not.toContain("body");
    expect(s.logs.map((e) => e.type)).toContain("request");
  });

  it("Secret values never print", () => {
    const sec = new Secret("very-secret-value");
    expect(String(sec)).toBe(REDACTED);
    expect(JSON.stringify({ sec })).toBe(`{"sec":"${REDACTED}"}`);
    expect(inspect({ sec })).not.toContain("very-secret-value");
    expect(sec.reveal()).toBe("very-secret-value");
  });

  it("credentials given as Secret work and the client object shows no secret", async () => {
    const s = setup();
    const client = createGspClient({
      provider: createNicDirectProvider({ baseUrls: { einvoice: EI_BASE, ewaybill: EWB_BASE } }),
      credentials: () => ({
        ...CREDENTIALS,
        clientSecret: new Secret(CREDENTIALS.clientSecret),
        password: new Secret(CREDENTIALS.password),
        publicKey: testKeys().publicPem,
      }),
      fetch: s.mock.fetch,
      clock: s.clock,
      randomBytes: seededRandom(1),
    });
    const r = await client.einvoice.login({ gstin: GSTIN });
    expect(r.ok).toBe(true);
    for (const text of [JSON.stringify(client), inspect(client, { depth: 5 })]) {
      assertClean(text, [CREDENTIALS.clientSecret, CREDENTIALS.password]);
    }
  });
});
