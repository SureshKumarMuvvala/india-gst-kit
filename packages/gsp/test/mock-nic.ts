// An in-process mock of the NIC e-invoice and e-way bill APIs, as a `fetch` implementation (no sockets, no
// network). It decrypts logins with a test RSA key, issues tokens and SEKs, enforces the same-token rule and the
// 10-minute force-refresh window with an injected clock, and records every request. Everything is synthetic.
import { randomBytes } from "node:crypto";
import { aesDec, aesEnc, hmacB64, rsaDecryptPkcs1, testKeys } from "./nic-crypto.js";

export const EI_BASE = "https://einvoice.mock.test/eiapi";
export const EWB_BASE = "https://ewaybill.mock.test/ewbapi";

export type Sys = "einvoice" | "ewaybill";
export type Form = "json" | "base64-json";
type Json = Record<string, unknown>;

export type MockOp =
  | "einvoice.auth"
  | "einvoice.getGstinDetails"
  | "einvoice.syncGstinDetails"
  | "einvoice.generateIrn"
  | "einvoice.cancelIrn"
  | "einvoice.getEinvoiceByIrn"
  | "einvoice.getIrnByDocDetails"
  | "einvoice.getEwbByIrn"
  | "einvoice.generateEwbByIrn"
  | "ewaybill.auth"
  | "ewaybill.generate"
  | "ewaybill.updateVehicle"
  | "ewaybill.cancel"
  | "ewaybill.extendValidity"
  | "ewaybill.consolidated"
  | "ewaybill.updateTransporter"
  | "ewaybill.reject"
  | "ewaybill.getGstinDetails";

export type Recorded = {
  op: MockOp | "unknown";
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Json;
  /** The decrypted request JSON text (POST operations), or the decrypted login JSON. */
  decrypted?: string;
  query: Record<string, string>;
  pathParams: Record<string, string>;
};

export type Reply =
  /** Success: `data` is encrypted with the SEK (or the rek path for EWB GSTIN details). */
  | { data: unknown; info?: string }
  /** Status 0 with these error codes, in the system's shape. */
  | { errors: { code: string; message?: string }[]; info?: string; httpStatus?: number }
  /** Exactly this body and status. */
  | { raw: string; httpStatus?: number };

export type Handler = (req: Recorded, json: unknown) => Reply | Promise<Reply>;

type TokenRec = { system: Sys; key: string; sek: Buffer; expiresAt: number };

export const CREDENTIALS = {
  clientId: "mock-client-id",
  clientSecret: "mock-client-secret-0001",
  username: "mockuser",
  password: "mock-password-0001",
};

export type MockOptions = {
  now: () => number;
  forms?: Partial<Record<Sys, Form>>;
  lifetimeMinutes?: Partial<Record<Sys, number>>;
  /** Header names the mock accepts (lower case), per system. Default: the documented ones. */
  headerNames?: Partial<
    Record<
      Sys,
      {
        clientId: string;
        clientSecret: string;
        gstin: string;
        authToken: string;
        username?: string;
      }
    >
  >;
  /** EWB rek: returned as raw 32 bytes (default) or as Base64 text of them. */
  rekForm?: "raw" | "base64";
  tamperHmac?: boolean;
  /** When true, a login inside the validity returns the same SEK as before (default: a new SEK). */
  sameSek?: boolean;
  /** When true, TokenExpiry on a re-auth inside validity is pushed later (to test "no extension"). */
  extendExpiryOnReauth?: boolean;
  omitTokenExpiry?: boolean;
  /** When true, ForceRefreshAccessToken is ignored and a valid token is always returned again. */
  ignoreForce?: boolean;
};

const IST = 330 * 60_000;
const ist = (ms: number) => {
  const d = new Date(ms + IST);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
};

export const AUTH_ERROR_CODE = { einvoice: "MOCK-TOKEN-EI", ewaybill: "MOCK-TOKEN-EWB" } as const;

export class MockNic {
  readonly requests: Recorded[] = [];
  readonly handlers = new Map<MockOp, Handler>();
  readonly tokens = new Map<string, TokenRec>();
  readonly current = new Map<string, string>();
  /** Every ForceRefreshAccessToken value received, in order. */
  readonly forceFlags: boolean[] = [];
  options: MockOptions;
  #counter = 0;

  constructor(options: MockOptions) {
    this.options = options;
  }

  on(op: MockOp, handler: Handler): this {
    this.handlers.set(op, handler);
    return this;
  }

  form(system: Sys): Form {
    return this.options.forms?.[system] ?? (system === "ewaybill" ? "base64-json" : "json");
  }

  lifetime(system: Sys): number {
    return (this.options.lifetimeMinutes?.[system] ?? 360) * 60_000;
  }

  count(op: MockOp): number {
    return this.requests.filter((r) => r.op === op).length;
  }

  last(op: MockOp): Recorded | undefined {
    return this.requests.filter((r) => r.op === op).at(-1);
  }

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const bodyText = typeof init?.body === "string" ? init.body : undefined;
    const body = bodyText === undefined ? undefined : (JSON.parse(bodyText) as Json);
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
      query[k] = v;
    });
    const route = this.#route(url, method, body);
    const rec: Recorded = {
      op: route.op,
      method,
      url: url.href,
      headers,
      query,
      pathParams: route.params,
    };
    if (body !== undefined) rec.body = body;
    this.requests.push(rec);
    if (route.op === "unknown") return new Response("<html>not found</html>", { status: 404 });
    const system: Sys = route.op.startsWith("einvoice") ? "einvoice" : "ewaybill";
    const names = this.#names(system);
    if (
      headers[names.clientId] !== CREDENTIALS.clientId ||
      headers[names.clientSecret] !== CREDENTIALS.clientSecret
    ) {
      return this.#error(system, [
        { code: "MOCK-HEADERS", message: "client id/secret header missing" },
      ]);
    }
    if (route.op.endsWith(".auth")) return this.#auth(system, rec, body);
    const token = headers[names.authToken];
    const t = token === undefined ? undefined : this.tokens.get(token);
    if (t === undefined || t.expiresAt <= this.options.now() || t.system !== system) {
      return this.#error(system, [{ code: AUTH_ERROR_CODE[system], message: "invalid token" }]);
    }
    let json: unknown;
    if (method === "POST") {
      const data = system === "einvoice" ? body?.Data : body?.data;
      if (typeof data !== "string") return this.#error(system, [{ code: "MOCK-NO-DATA" }]);
      let text: string;
      try {
        const plain = aesDec(data, t.sek).toString("utf8");
        text = this.form(system) === "json" ? plain : Buffer.from(plain, "base64").toString("utf8");
        json = JSON.parse(text);
      } catch {
        return this.#error(system, [{ code: "MOCK-DECRYPT" }]);
      }
      rec.decrypted = text;
    }
    const handler = this.handlers.get(route.op) ?? defaultHandler(route.op);
    const reply = await handler(rec, json);
    if ("raw" in reply) return new Response(reply.raw, { status: reply.httpStatus ?? 200 });
    if ("errors" in reply) return this.#error(system, reply.errors, reply.info, reply.httpStatus);
    return this.#success(system, route.op, t, reply.data, reply.info);
  };

  #names(system: Sys) {
    const d =
      system === "einvoice"
        ? {
            clientId: "client_id",
            clientSecret: "client_secret",
            gstin: "gstin",
            authToken: "authtoken",
            username: "user_name",
          }
        : {
            clientId: "client-id",
            clientSecret: "client-secret",
            gstin: "gstin",
            authToken: "authtoken",
          };
    return this.options.headerNames?.[system] ?? d;
  }

  #route(
    url: URL,
    method: string,
    body: Json | undefined,
  ): { op: MockOp | "unknown"; params: Record<string, string> } {
    const href = url.origin + url.pathname;
    const sub = (base: string) => (href.startsWith(base) ? href.slice(base.length) : undefined);
    const ei = sub(EI_BASE);
    const ew = sub(EWB_BASE);
    const m = (re: RegExp, p: string | undefined) => (p === undefined ? null : re.exec(p));
    let r: RegExpExecArray | null;
    if (ei !== undefined) {
      if (method === "POST" && ei === "/v1.04/auth") return { op: "einvoice.auth", params: {} };
      if ((r = m(/^\/eivital\/v1\.04\/Master\/gstin\/([^/]+)$/, ei)) && method === "GET")
        return {
          op: "einvoice.getGstinDetails",
          params: { gstin: decodeURIComponent(r[1] ?? "") },
        };
      if ((r = m(/^\/eivital\/v1\.04\/Master\/syncgstin\/([^/]+)$/, ei)) && method === "GET")
        return {
          op: "einvoice.syncGstinDetails",
          params: { gstin: decodeURIComponent(r[1] ?? "") },
        };
      if (method === "POST" && ei === "/api/Invoice")
        return { op: "einvoice.generateIrn", params: {} };
      if (method === "POST" && ei === "/api/Cancel")
        return { op: "einvoice.cancelIrn", params: {} };
      if ((r = m(/^\/api\/Invoice\/irn\/([^/]+)$/, ei)) && method === "GET")
        return { op: "einvoice.getEinvoiceByIrn", params: { irn: r[1] ?? "" } };
      if (method === "GET" && ei === "/irnbydocdetails")
        return { op: "einvoice.getIrnByDocDetails", params: {} };
      if ((r = m(/^\/eiewb\/v1\.03\/ewaybill\/irn\/([^/]+)$/, ei)) && method === "GET")
        return { op: "einvoice.getEwbByIrn", params: { irn: r[1] ?? "" } };
      if (method === "POST" && ei === "/api/einvewb/ewaybill")
        return { op: "einvoice.generateEwbByIrn", params: {} };
    }
    if (ew !== undefined) {
      if (method === "POST" && ew === "/auth/") return { op: "ewaybill.auth", params: {} };
      if (method === "GET" && ew === "/Master/GetGSTINDetails")
        return { op: "ewaybill.getGstinDetails", params: {} };
      if (method === "POST" && ew === "/ewayapi/") {
        const ops: Record<string, MockOp> = {
          GENEWAYBILL: "ewaybill.generate",
          VEHEWB: "ewaybill.updateVehicle",
          CANEWB: "ewaybill.cancel",
          EXTENDVALIDITY: "ewaybill.extendValidity",
          GENCEWB: "ewaybill.consolidated",
          UPDATETRANSPORTER: "ewaybill.updateTransporter",
          REJEWB: "ewaybill.reject",
        };
        const op = typeof body?.action === "string" ? ops[body.action] : undefined;
        return { op: op ?? "unknown", params: {} };
      }
    }
    return { op: "unknown", params: {} };
  }

  #auth(system: Sys, rec: Recorded, body: Json | undefined): Response {
    const data = body?.Data;
    if (typeof data !== "string") return this.#error(system, [{ code: "MOCK-AUTH-BODY" }]);
    let creds: Json;
    try {
      const b64 = rsaDecryptPkcs1(data, testKeys().privateKey).toString("ascii");
      const text = Buffer.from(b64, "base64").toString("utf8");
      rec.decrypted = text;
      creds = JSON.parse(text) as Json;
    } catch {
      return this.#error(system, [{ code: "MOCK-AUTH-DECRYPT" }]);
    }
    const user = system === "einvoice" ? creds.UserName : creds.username;
    const pass = system === "einvoice" ? creds.Password : creds.password;
    const appKeyB64 = system === "einvoice" ? creds.AppKey : creds.app_key;
    if (system === "ewaybill" && creds.action !== "ACCESSTOKEN")
      return this.#error(system, [{ code: "MOCK-ACTION" }]);
    if (
      user !== CREDENTIALS.username ||
      pass !== CREDENTIALS.password ||
      typeof appKeyB64 !== "string"
    ) {
      return this.#error(system, [
        { code: "MOCK-BAD-CREDENTIALS", message: "invalid credentials" },
      ]);
    }
    const appKey = Buffer.from(appKeyB64, "base64");
    const force = system === "einvoice" && creds.ForceRefreshAccessToken === true;
    if (system === "einvoice") this.forceFlags.push(force);
    const now = this.options.now();
    const key = `${system}|${rec.headers.gstin ?? ""}|${user}`;
    const existingToken = this.current.get(key);
    const existing = existingToken === undefined ? undefined : this.tokens.get(existingToken);
    let token: string;
    let rec2: TokenRec;
    const valid = existing !== undefined && existing.expiresAt > now;
    const inWindow = existing !== undefined && existing.expiresAt - now <= 10 * 60_000;
    if (
      existing !== undefined &&
      existingToken !== undefined &&
      valid &&
      !(force && inWindow && this.options.ignoreForce !== true)
    ) {
      token = existingToken;
      rec2 = existing;
      if (this.options.sameSek !== true) rec2.sek = randomBytes(32);
      if (this.options.extendExpiryOnReauth === true)
        rec2 = { ...rec2, expiresAt: rec2.expiresAt + 3_600_000 };
    } else {
      this.#counter++;
      token = `mocktoken${system}${String(this.#counter).padStart(6, "0")}`;
      rec2 = { system, key, sek: randomBytes(32), expiresAt: now + this.lifetime(system) };
      if (existingToken !== undefined) this.tokens.delete(existingToken);
      this.tokens.set(token, rec2);
      this.current.set(key, token);
    }
    const sek = aesEnc(rec2.sek, appKey);
    if (system === "einvoice") {
      const d: Json = {
        ClientId: CREDENTIALS.clientId,
        UserName: user,
        AuthToken: token,
        Sek: sek,
      };
      if (this.options.omitTokenExpiry !== true) d.TokenExpiry = ist(rec2.expiresAt);
      return json({ Status: 1, Data: d, ErrorDetails: null, InfoDtls: null });
    }
    return json({ status: "1", authtoken: token, sek });
  }

  /** Data JSON for a reply, encrypted the way the system does it. */
  encrypt(system: Sys, sek: Buffer, data: unknown): string {
    const text = typeof data === "string" ? data : JSON.stringify(data);
    const plain =
      this.form(system) === "json"
        ? Buffer.from(text, "utf8")
        : Buffer.from(Buffer.from(text, "utf8").toString("base64"), "ascii");
    return aesEnc(plain, sek);
  }

  #success(system: Sys, op: MockOp, t: TokenRec, data: unknown, info?: string): Response {
    if (op === "ewaybill.getGstinDetails") {
      const rek = randomBytes(32);
      const text = typeof data === "string" ? data : JSON.stringify(data);
      const b64 = Buffer.from(text, "utf8").toString("base64");
      const encData = aesEnc(Buffer.from(b64, "ascii"), rek);
      const rekPlain =
        this.options.rekForm === "base64" ? Buffer.from(rek.toString("base64"), "ascii") : rek;
      let hmac = hmacB64(rek, b64);
      if (this.options.tamperHmac === true) hmac = hmacB64(rek, `${b64}x`);
      return json({ status: "1", data: encData, rek: aesEnc(rekPlain, t.sek), hmac });
    }
    const enc = this.encrypt(system, t.sek, data);
    if (system === "einvoice")
      return json({ Status: "1", Data: enc, ErrorDetails: null, InfoDtls: info ?? null });
    return json({ status: "1", data: enc, alert: info ?? null });
  }

  #error(
    system: Sys,
    errors: { code: string; message?: string }[],
    info?: string,
    httpStatus = 200,
  ): Response {
    if (system === "einvoice") {
      const details = errors.map((e) => ({ ErrorCode: e.code, ErrorMessage: e.message ?? "" }));
      return json(
        { Status: "0", Data: null, ErrorDetails: details, InfoDtls: info ?? null },
        httpStatus,
      );
    }
    return json(
      { status: "0", error: { errorCodes: errors.map((e) => e.code).join(",") } },
      httpStatus,
    );
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SAMPLE_IRN = "0f2a".repeat(16);

export function fakeJwt(claimsData: unknown): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  return `${b({ alg: "RS256", kid: "mockkid", typ: "JWT", x5t: "mockx5t" })}.${b({ data: JSON.stringify(claimsData), iss: "MOCK" })}.${Buffer.from("not-a-signature").toString("base64url")}`;
}

/** Synthetic success data per operation. */
export function defaultHandler(op: MockOp): Handler {
  return (_req, input) => {
    const i = (input ?? {}) as Json;
    switch (op) {
      case "einvoice.getGstinDetails":
      case "einvoice.syncGstinDetails":
        return {
          data: {
            Gstin: _req.pathParams.gstin,
            TradeName: "Mock Traders",
            LegalName: "Mock Legal Name",
            AddrBnm: "Mock Building",
            AddrBno: "12",
            AddrFlno: "1st floor",
            AddrSt: "Mock Street",
            AddrLoc: "Mock Town",
            StateCode: 29,
            AddrPncd: 560001,
            TxpType: "REG",
            Status: "ACT",
            BlkStatus: "U",
            DtReg: "2021-05-03",
            DtDReg: null,
          },
        };
      case "einvoice.generateIrn":
      case "einvoice.getEinvoiceByIrn":
      case "einvoice.getIrnByDocDetails": {
        const signed = {
          ...i,
          AckNo: 112010000000001,
          AckDt: "2026-10-18 10:00:00",
          Irn: SAMPLE_IRN,
        };
        return {
          data: {
            AckNo: 112010000000001,
            AckDt: "2026-10-18 10:00:00",
            Irn: SAMPLE_IRN,
            SignedInvoice: fakeJwt(signed),
            SignedQRCode: fakeJwt({ Irn: SAMPLE_IRN }),
            Status: "ACT",
            EwbNo: null,
            EwbDt: null,
            EwbValidTill: null,
            Remarks: null,
          },
          info: "mock alert",
        };
      }
      case "einvoice.cancelIrn":
        return { data: { Irn: i.Irn, CancelDate: "2026-10-18 11:00:00" } };
      case "einvoice.getEwbByIrn":
        return {
          data: {
            EwbNo: 131008995134,
            Status: "ACT",
            GenGstin: "29AAAAA0000A1ZY",
            EwbDt: "2026-10-18 10:00:00",
            EwbValidTill: "2026-10-19 23:59:00",
          },
        };
      case "einvoice.generateEwbByIrn":
        return {
          data: {
            EwbNo: 111008683051,
            EwbDt: "2026-10-18 11:28:00",
            EwbValidTill: "2026-10-19 23:59:00",
            Remarks: null,
          },
        };
      case "ewaybill.generate":
        return {
          data: {
            ewayBillNo: 123456789012,
            ewayBillDate: "18/10/2026 10:30:00 AM",
            validUpto: "19/10/2026 11:59:00 PM",
            alert: "",
          },
        };
      case "ewaybill.updateVehicle":
        return {
          data: { vehUpdDate: "18/10/2026 10:56:00 AM", validUpto: "19/10/2026 11:59:00 PM" },
        };
      case "ewaybill.cancel":
        return { data: { ewayBillNo: i.ewbNo, cancelDate: "18/10/2026 11:35:00 AM" } };
      case "ewaybill.extendValidity":
        return {
          data: {
            ewayBillNo: String(i.ewbNo),
            updatedDate: "18/10/2026 05:07:00 PM",
            validUpto: "20/10/2026 11:59:00 PM",
          },
        };
      case "ewaybill.consolidated":
        return { data: { cEwbNo: "1810000387", cEWBDate: "18/10/2026 10:27:00 AM" } };
      case "ewaybill.updateTransporter":
        return {
          data: {
            ewayBillNo: String(i.ewbNo),
            transporterId: i.transporterId,
            transUpdateDate: "18/10/2026 04:32:27 PM",
          },
        };
      case "ewaybill.reject":
        return { data: { ewayBillNo: i.ewbNo, ewbRejectedDate: "18/10/2026 10:24:00 AM" } };
      case "ewaybill.getGstinDetails":
        return {
          data: {
            gstin: _req.query.GSTIN,
            tradeName: "Mock Traders",
            legalName: "Mock Legal Name",
            address1: "Mock Street",
            address2: "Mock Town",
            stateCode: "29",
            pinCode: "560001",
            txpType: " ",
            status: "ACT",
            blkStatus: "B",
          },
        };
      default:
        return { errors: [{ code: "MOCK-NO-HANDLER" }] };
    }
  };
}
