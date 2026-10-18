import { describe, expect, it } from "vitest";
import {
  createNicDirectProvider,
  NIC_DEFAULT_PATHS,
  NIC_EINVOICE_HEADERS_JAVA_SAMPLE,
} from "../src/index.js";
import { EI_BASE, EWB_BASE } from "./mock-nic.js";
import { expectErr, expectOk, GSTIN, GSTINS, irnRequest, setup, urlOf } from "./helpers.js";

const IRN = "ab".repeat(32);

describe("headers (G4, spec §6.2)", () => {
  it("e-invoice uses the documented underscore names; sup_gstin only when given", async () => {
    const s = setup();
    expectOk(await s.client.einvoice.getEwbByIrn({ gstin: GSTIN, irn: IRN }));
    const auth = s.mock.last("einvoice.auth")?.headers ?? {};
    expect(Object.keys(auth).sort()).toStrictEqual([
      "client_id",
      "client_secret",
      "content-type",
      "gstin",
    ]);
    const h = s.mock.last("einvoice.getEwbByIrn")?.headers ?? {};
    expect(Object.keys(h).sort()).toStrictEqual([
      "authtoken",
      "client_id",
      "client_secret",
      "content-type",
      "gstin",
      "user_name",
    ]);
    expect(h.user_name).toBe("mockuser");
    expectOk(
      await s.client.einvoice.getEwbByIrn({ gstin: GSTIN, irn: IRN, supGstin: GSTINS.recipientMh }),
    );
    expect(s.mock.last("einvoice.getEwbByIrn")?.headers.sup_gstin).toBe(GSTINS.recipientMh);
  });

  it("e-way bill uses hyphen names and no user name", async () => {
    const s = setup();
    expectOk(await s.client.ewaybill.reject({ gstin: GSTIN, request: { ewbNo: "181000609270" } }));
    const h = s.mock.last("ewaybill.reject")?.headers ?? {};
    expect(Object.keys(h).sort()).toStrictEqual([
      "authtoken",
      "client-id",
      "client-secret",
      "content-type",
      "gstin",
    ]);
  });

  it("the Java-sample preset and a custom map change the names", async () => {
    const s = setup({
      provider: { headerNames: { einvoice: NIC_EINVOICE_HEADERS_JAVA_SAMPLE } },
      mock: {
        headerNames: {
          einvoice: {
            clientId: "client-id",
            clientSecret: "client-secret",
            gstin: "gstin",
            authToken: "authtoken",
            username: "user_name",
          },
        },
      },
    });
    expectOk(await s.client.einvoice.login({ gstin: GSTIN }));
    expect(Object.keys(s.mock.last("einvoice.auth")?.headers ?? {})).toContain("client-id");
    const custom = setup({
      provider: {
        headerNames: {
          ewaybill: { clientId: "x-cid", clientSecret: "x-cs", gstin: "x-g", authToken: "x-t" },
        },
      },
      mock: {
        headerNames: {
          ewaybill: { clientId: "x-cid", clientSecret: "x-cs", gstin: "x-g", authToken: "x-t" },
        },
      },
    });
    expectOk(
      await custom.client.ewaybill.reject({ gstin: GSTIN, request: { ewbNo: "181000609270" } }),
    );
  });

  it("wrong header names are refused by the portal (status 0)", async () => {
    const s = setup({ provider: { headerNames: { einvoice: NIC_EINVOICE_HEADERS_JAVA_SAMPLE } } });
    const e = expectErr(await s.client.einvoice.login({ gstin: GSTIN }));
    expect(e.kind === "auth" && e.cause.kind).toBe("api");
  });
});

describe("paths (spec §3.3)", () => {
  const provider = createNicDirectProvider({ baseUrls: { einvoice: EI_BASE, ewaybill: EWB_BASE } });

  it("every default path and method", () => {
    const params = {
      gstin: GSTIN,
      irn: IRN,
      docType: "INV",
      docNum: "A/1-2",
      docDate: "18/10/2026",
    };
    const urls = Object.fromEntries(
      Object.keys(NIC_DEFAULT_PATHS).map((op) => {
        const e = provider.endpoint(op as keyof typeof NIC_DEFAULT_PATHS, params);
        return [
          op,
          `${e?.method ?? ""} ${e?.url ?? ""}${e?.action === undefined ? "" : ` ${e.action}`}`,
        ];
      }),
    );
    expect(urls).toStrictEqual({
      "einvoice.auth": `POST ${EI_BASE}/v1.04/auth`,
      "einvoice.getGstinDetails": `GET ${EI_BASE}/eivital/v1.04/Master/gstin/${GSTIN}`,
      "einvoice.syncGstinDetails": `GET ${EI_BASE}/eivital/v1.04/Master/syncgstin/${GSTIN}`,
      "einvoice.generateIrn": `POST ${EI_BASE}/api/Invoice`,
      "einvoice.cancelIrn": `POST ${EI_BASE}/api/Cancel`,
      "einvoice.getEinvoiceByIrn": `GET ${EI_BASE}/api/Invoice/irn/${IRN}`,
      "einvoice.getIrnByDocDetails": `GET ${EI_BASE}/irnbydocdetails?doctype=INV&docnum=A%2F1-2&docdate=18%2F10%2F2026`,
      "einvoice.getEwbByIrn": `GET ${EI_BASE}/eiewb/v1.03/ewaybill/irn/${IRN}`,
      "einvoice.generateEwbByIrn": `POST ${EI_BASE}/api/einvewb/ewaybill`,
      "ewaybill.auth": `POST ${EWB_BASE}/auth/`,
      "ewaybill.generate": `POST ${EWB_BASE}/ewayapi/ GENEWAYBILL`,
      "ewaybill.updateVehicle": `POST ${EWB_BASE}/ewayapi/ VEHEWB`,
      "ewaybill.cancel": `POST ${EWB_BASE}/ewayapi/ CANEWB`,
      "ewaybill.extendValidity": `POST ${EWB_BASE}/ewayapi/ EXTENDVALIDITY`,
      "ewaybill.consolidated": `POST ${EWB_BASE}/ewayapi/ GENCEWB`,
      "ewaybill.updateTransporter": `POST ${EWB_BASE}/ewayapi/ UPDATETRANSPORTER`,
      "ewaybill.reject": `POST ${EWB_BASE}/ewayapi/ REJEWB`,
      "ewaybill.getGstinDetails": `GET ${EWB_BASE}/Master/GetGSTINDetails?GSTIN=${GSTIN}`,
    });
  });

  it("joins base and path with exactly one /", () => {
    for (const base of ["https://h.test/x", "https://h.test/x/", "https://h.test/x//"]) {
      const p = createNicDirectProvider({
        baseUrls: { einvoice: base, ewaybill: base },
        paths: { "einvoice.generateEwbByIrn": "api/einvewb/ewaybill" },
      });
      expect(p.endpoint("einvoice.generateEwbByIrn", {})?.url).toBe(
        "https://h.test/x/api/einvewb/ewaybill",
      );
      expect(p.endpoint("einvoice.cancelIrn", {})?.url).toBe("https://h.test/x/api/Cancel");
    }
  });

  it("a path overridden to empty ⇒ config error no-path, nothing sent", async () => {
    const s = setup({ provider: { paths: { "einvoice.generateIrn": "" } } });
    const e = expectErr(
      await s.client.einvoice.generateIrn({ gstin: GSTIN, request: irnRequest() }),
    );
    expect(e).toMatchObject({ kind: "config", reason: "no-path" });
    expect(s.mock.requests).toHaveLength(0);
  });

  it("invalid provider options throw (programmer error)", () => {
    expect(() =>
      createNicDirectProvider({ baseUrls: { einvoice: "not a url", ewaybill: EWB_BASE } }),
    ).toThrow(TypeError);
    expect(() =>
      createNicDirectProvider({
        baseUrls: { einvoice: EI_BASE, ewaybill: EWB_BASE },
        appKeyBytes: 24 as 16,
      }),
    ).toThrow(TypeError);
  });
});

describe("timeouts, aborts and retries (spec §6.3)", () => {
  const hang = (_input: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    });

  it("a POST that times out ⇒ transport/timeout, outcome unknown, sent once", async () => {
    const s = setup();
    expectOk(await s.client.ewaybill.login({ gstin: GSTIN }));
    let posts = 0;
    const s2 = setup({
      clock: s.clock,
      client: {
        timeoutMs: 20,
        getRetries: 3,
        fetch: (input, init) => {
          if (urlOf(input).endsWith("/ewayapi/")) {
            posts++;
            return hang(input, init);
          }
          return s.mock.fetch(input, init);
        },
      },
    });
    const e = expectErr(
      await s2.client.ewaybill.reject({ gstin: GSTIN, request: { ewbNo: "181000609270" } }),
    );
    expect(e).toMatchObject({ kind: "transport", reason: "timeout", outcome: "unknown" });
    expect(posts).toBe(1);
  });

  it("a GET with getRetries 2 makes 3 attempts with backoff; 4xx is not retried", async () => {
    const s = setup();
    let gets = 0;
    const s2 = setup({
      clock: s.clock,
      client: {
        getRetries: 2,
        fetch: (input, init) => {
          if (urlOf(input).includes("/Master/gstin/")) {
            gets++;
            return Promise.reject(new TypeError("connection reset"));
          }
          return s.mock.fetch(input, init);
        },
      },
    });
    const e = expectErr(
      await s2.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }),
    );
    expect(e).toMatchObject({ kind: "transport", reason: "network" });
    expect(gets).toBe(3);
    expect(s2.sleeps).toStrictEqual([250, 500]);
    expect(s2.logs.filter((l) => l.type === "retry")).toHaveLength(2);

    let fours = 0;
    const s3 = setup({
      clock: s.clock,
      client: {
        getRetries: 2,
        fetch: (input, init) => {
          if (urlOf(input).includes("/Master/gstin/")) {
            fours++;
            return Promise.resolve(new Response("bad request", { status: 400 }));
          }
          return s.mock.fetch(input, init);
        },
      },
    });
    expect(
      expectErr(
        await s3.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }),
      ),
    ).toMatchObject({
      kind: "transport",
      reason: "http",
      httpStatus: 400,
    });
    expect(fours).toBe(1);
  });

  it("a GET 5xx without an envelope is retried and can succeed", async () => {
    const s = setup();
    let n = 0;
    const s2 = setup({
      clock: s.clock,
      client: {
        getRetries: 1,
        fetch: (input, init) => {
          if (urlOf(input).includes("/Master/gstin/") && n++ === 0)
            return Promise.resolve(new Response("<html>", { status: 503 }));
          return s.mock.fetch(input, init);
        },
      },
    });
    expectOk(
      await s2.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }),
    );
  });

  it("the caller's signal: aborted before ⇒ not-sent; during ⇒ aborted", async () => {
    const s = setup();
    expectOk(await s.client.ewaybill.login({ gstin: GSTIN }));
    const pre = new AbortController();
    pre.abort();
    expect(
      expectErr(
        await s.client.ewaybill.reject({
          gstin: GSTIN,
          request: { ewbNo: "181000609270" },
          signal: pre.signal,
        }),
      ),
    ).toMatchObject({
      kind: "transport",
      reason: "aborted",
      outcome: "not-sent",
    });
    const during = new AbortController();
    const s2 = setup({
      clock: s.clock,
      client: {
        fetch: (input, init) => {
          if (urlOf(input).endsWith("/ewayapi/")) {
            const p = hang(input, init);
            during.abort();
            return p;
          }
          return s.mock.fetch(input, init);
        },
      },
    });
    expect(
      expectErr(
        await s2.client.ewaybill.reject({
          gstin: GSTIN,
          request: { ewbNo: "181000609270" },
          signal: during.signal,
        }),
      ),
    ).toMatchObject({
      kind: "transport",
      reason: "aborted",
    });
  });
});

describe("bodies", () => {
  it("EWB action is sent trimmed with lower-case keys; e-invoice uses { Data }", async () => {
    const s = setup();
    expectOk(await s.client.ewaybill.reject({ gstin: GSTIN, request: { ewbNo: "181000609270" } }));
    expect(Object.keys(s.mock.last("ewaybill.reject")?.body ?? {})).toStrictEqual([
      "action",
      "data",
    ]);
    expect(s.mock.last("ewaybill.reject")?.body?.action).toBe("REJEWB");
    expectOk(
      await s.client.einvoice.cancelIrn({ gstin: GSTIN, request: { Irn: IRN, CnlRsn: "2" } }),
    );
    expect(Object.keys(s.mock.last("einvoice.cancelIrn")?.body ?? {})).toStrictEqual(["Data"]);
  });
});

describe("config", () => {
  it("createGspClient throws on an invalid config", async () => {
    const { createGspClient } = await import("../src/index.js");
    expect(() =>
      createGspClient({ provider: {} as never, credentials: () => ({}) as never }),
    ).toThrow(TypeError);
  });
});
