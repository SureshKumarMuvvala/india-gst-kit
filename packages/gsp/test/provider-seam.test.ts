// A fake GSP provider (test-only): different base URL, an extra header, a passthrough codec and a plain-JSON
// envelope, run through the same core without NIC crypto (spec §2.3, §12.10).
import { describe, expect, it } from "vitest";
import { createGspClient, decodeNicEnvelope, okResult, type GspProvider } from "../src/index.js";
import { GSTIN, GSTINS, urlOf } from "./helpers.js";

describe("provider seam", () => {
  it("a fake GSP provider runs getGstinDetails and cancelIrn without NIC crypto", async () => {
    const seen: { url: string; headers: Record<string, string>; body?: string }[] = [];
    const provider: GspProvider = {
      name: "fake-gsp",
      baseUrl: () => "https://gsp.example.test",
      endpoint: (op, params) =>
        op === "einvoice.getGstinDetails"
          ? { method: "GET", url: `https://gsp.example.test/gstin/${params.gstin ?? ""}` }
          : { method: "POST", url: `https://gsp.example.test/${op}` },
      buildHeaders: ({ session }) => ({
        "x-test-gsp-key": "gsp-key",
        ...(session === undefined ? {} : { "x-token": session.authToken }),
      }),
      auth: {
        login: () => {
          return Promise.resolve(
            okResult({
              authToken: "gsp-token",
              sek: new Uint8Array(32),
              username: "u",
              warnings: [],
            }),
          );
        },
      },
      codec: {
        encodeRequest: ({ json }) => ({ ok: true, body: { payload: json } }),
        decodeResponse: ({ envelope }) => ({
          ok: true,
          value: { json: JSON.stringify(envelope.data), warnings: [] },
        }),
      },
      envelope: { decode: decodeNicEnvelope },
      session: {
        tokenLifetimeMinutes: { einvoice: 60, ewaybill: 60 },
        proactiveRefresh: false,
        forceRefresh: { einvoice: false, ewaybill: false },
      },
    };
    const client = createGspClient({
      provider,
      credentials: () => ({
        clientId: "c",
        clientSecret: "s",
        username: "u",
        password: "p",
        publicKey: "",
      }),
      fetch: (input, init) => {
        const url = urlOf(input);
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        seen.push({ url, headers, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
        const data = url.includes("/gstin/")
          ? { Gstin: GSTINS.recipientMh, Status: "ACT", BlkStatus: "U", StateCode: "27" }
          : { Irn: "d".repeat(64), CancelDate: "2026-10-18 11:00:00" };
        return Promise.resolve(new Response(JSON.stringify({ status: 1, data })));
      },
    });
    const g = await client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh });
    expect(g.ok && g.value.isActive).toBe(true);
    const c = await client.einvoice.cancelIrn({
      gstin: GSTIN,
      request: { Irn: "d".repeat(64), CnlRsn: "1" },
    });
    expect(c.ok && c.value.CancelDate).toBe("2026-10-18 11:00:00");
    expect(seen[0]?.headers["x-test-gsp-key"]).toBe("gsp-key");
    expect(seen[0]?.headers["x-token"]).toBe("gsp-token");
    expect(seen[1]?.body).toBe(
      JSON.stringify({ payload: `{"Irn":"${"d".repeat(64)}","CnlRsn":"1"}` }),
    );
  });
});
