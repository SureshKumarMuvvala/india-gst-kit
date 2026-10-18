import { describe, expect, it } from "vitest";
import { createMemorySessionStore, type Session, type SessionStore } from "../src/index.js";
import { AUTH_ERROR_CODE } from "./mock-nic.js";
import {
  codes,
  expectErr,
  expectOk,
  GSTIN,
  GSTINS,
  HOUR,
  MIN,
  setup,
  T0,
  urlOf,
} from "./helpers.js";

describe("session caching", () => {
  it("logs in once and reuses the session", async () => {
    const s = setup();
    expectOk(await s.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }));
    expectOk(await s.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }));
    expect(s.mock.count("einvoice.auth")).toBe(1);
    expect(s.mock.count("einvoice.getGstinDetails")).toBe(2);
  });

  it("login() reports expiry from TokenExpiry (IST) and reuse", async () => {
    const s = setup();
    const a = expectOk(await s.client.einvoice.login({ gstin: GSTIN }));
    expect(a).toStrictEqual({ expiresAt: T0 + 360 * MIN, expirySource: "response", reused: false });
    const b = expectOk(await s.client.einvoice.login({ gstin: GSTIN }));
    expect(b.reused).toBe(true);
  });

  it("missing TokenExpiry ⇒ assumed lifetime with a warning", async () => {
    const s = setup({
      mock: { omitTokenExpiry: true },
      provider: { tokenLifetimeMinutes: { einvoice: 60 } },
    });
    const r = await s.client.einvoice.login({ gstin: GSTIN });
    expect(expectOk(r)).toMatchObject({ expiresAt: T0 + 60 * MIN, expirySource: "assumed" });
    expect(codes(r)).toContain("TOKEN_EXPIRY_ASSUMED");
  });

  it("EWB: no expiry in the response ⇒ obtainedAt + lifetime", async () => {
    const s = setup();
    expect(expectOk(await s.client.ewaybill.login({ gstin: GSTIN }))).toMatchObject({
      expiresAt: T0 + 360 * MIN,
      expirySource: "assumed",
    });
  });

  it("sessions are per GSTIN and per system", async () => {
    const s = setup();
    await s.client.einvoice.login({ gstin: GSTIN });
    await s.client.einvoice.login({ gstin: GSTINS.spareKa });
    await s.client.ewaybill.login({ gstin: GSTIN });
    expect(s.mock.count("einvoice.auth")).toBe(2);
    expect(s.mock.count("ewaybill.auth")).toBe(1);
  });
});

describe("no extension on re-auth (G5, D-G10)", () => {
  it("the same token: original expiry kept (later TokenExpiry ignored, warned), new SEK adopted", async () => {
    const s = setup({ mock: { extendExpiryOnReauth: true, ignoreForce: true } });
    expectOk(await s.client.einvoice.login({ gstin: GSTIN }));
    s.clock.advance(352 * MIN); // last 10 minutes: proactive refresh; the server returns the same token
    const r = await s.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh });
    // The data decrypts, so the new SEK (the mock issues one per login) was adopted.
    expectOk(r);
    expect(codes(r)).toContain("TOKEN_EXPIRY_EXTENDED_IGNORED");
    expect(s.mock.count("einvoice.auth")).toBe(2);
    const info = expectOk(await s.client.einvoice.login({ gstin: GSTIN }));
    expect(info.expiresAt).toBe(T0 + 360 * MIN);
  });

  it("EWB: the same token keeps the first login's expiry (no warning: the expiry is assumed)", async () => {
    const s = setup({ mock: { ignoreForce: true } });
    expectOk(await s.client.ewaybill.login({ gstin: GSTIN }));
    s.clock.advance(100 * MIN);
    await s.client.invalidateSession("ewaybill", GSTIN); // drop our cache; the server still holds the token
    const r = await s.client.ewaybill.login({ gstin: GSTIN });
    // Without a cached session the client cannot know the original time: documented limitation (spec §5.5).
    expect(expectOk(r).expiresAt).toBe(T0 + 460 * MIN);
  });
});

describe("refresh policy (spec §5.3, D-G9)", () => {
  it("no ForceRefreshAccessToken before the last 10 minutes; true inside; false after expiry", async () => {
    const s = setup();
    await s.client.einvoice.login({ gstin: GSTIN });
    s.clock.advance(349 * MIN);
    await s.client.einvoice.login({ gstin: GSTIN }); // cached, no login
    expect(s.mock.forceFlags).toStrictEqual([false]);
    s.clock.advance(2 * MIN); // 9 min left
    await s.client.einvoice.login({ gstin: GSTIN });
    expect(s.mock.forceFlags).toStrictEqual([false, true]);
    s.clock.advance(400 * MIN); // past expiry of the new token
    await s.client.einvoice.login({ gstin: GSTIN });
    expect(s.mock.forceFlags).toStrictEqual([false, true, false]);
  });

  it("inside the skew window the e-invoice login is forced", async () => {
    const s = setup();
    await s.client.einvoice.login({ gstin: GSTIN });
    s.clock.advance(359.5 * MIN);
    await s.client.einvoice.login({ gstin: GSTIN });
    expect(s.mock.forceFlags).toStrictEqual([false, true]);
  });

  it("proactiveRefresh false ⇒ cached session used inside the window", async () => {
    const s = setup({ provider: { proactiveRefresh: false } });
    await s.client.einvoice.login({ gstin: GSTIN });
    s.clock.advance(355 * MIN);
    expect(expectOk(await s.client.einvoice.login({ gstin: GSTIN })).reused).toBe(true);
    expect(s.mock.count("einvoice.auth")).toBe(1);
  });

  it("a failed proactive refresh (transport) uses the cached token: REFRESH_FAILED_USING_CACHED", async () => {
    const s = setup();
    const realFetch = s.mock.fetch;
    let failAuth = true;
    const s2 = setup({
      clock: s.clock,
      client: {
        fetch: (input, init) => {
          const url = urlOf(input);
          if (failAuth && url.endsWith("/v1.04/auth"))
            return Promise.reject(new TypeError("network down"));
          return realFetch(input, init);
        },
      },
    });
    // Share the server and the session: log in through s2 first while auth works.
    failAuth = false;
    s.clock.t = T0;
    await s2.client.einvoice.login({ gstin: GSTIN });
    failAuth = true;
    s.clock.advance(355 * MIN);
    const r = await s2.client.einvoice.getGstinDetails({
      gstin: GSTIN,
      target: GSTINS.recipientMh,
    });
    expectOk(r);
    expect(codes(r)).toContain("REFRESH_FAILED_USING_CACHED");
  });

  it("EWB: no refresh before the skew window; inside it the client sleeps until expiry, then logs in", async () => {
    const s = setup();
    await s.client.ewaybill.login({ gstin: GSTIN });
    s.clock.advance(355 * MIN);
    expect(expectOk(await s.client.ewaybill.login({ gstin: GSTIN })).reused).toBe(true);
    s.clock.t = T0 + 360 * MIN - 30_000;
    const r = expectOk(await s.client.ewaybill.login({ gstin: GSTIN }));
    expect(s.sleeps).toStrictEqual([30_000]);
    expect(r.reused).toBe(false);
    expect(s.mock.count("ewaybill.auth")).toBe(2);
  });
});

describe("concurrency", () => {
  it("20 concurrent calls ⇒ exactly one login", async () => {
    const s = setup();
    const rs = await Promise.all(
      Array.from({ length: 20 }, () =>
        s.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }),
      ),
    );
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(s.mock.count("einvoice.auth")).toBe(1);
  });

  it("a failing login reaches every waiter and is not cached", async () => {
    let fail = true;
    const s = setup();
    const inner = s.mock.fetch;
    const s2 = setup({
      clock: s.clock,
      client: {
        fetch: (input, init) =>
          fail && urlOf(input).endsWith("/v1.04/auth")
            ? Promise.reject(new TypeError("down"))
            : inner(input, init),
      },
    });
    const rs = await Promise.all(
      Array.from({ length: 20 }, () =>
        s2.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }),
      ),
    );
    expect(rs.every((r) => !r.ok && r.error.kind === "auth")).toBe(true);
    fail = false;
    expectOk(
      await s2.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }),
    );
    expect(s.mock.count("einvoice.auth")).toBe(1);
  });
});

describe("invalidation and auth error codes", () => {
  it("invalidateSession forces a login on the next call", async () => {
    const s = setup();
    await s.client.einvoice.login({ gstin: GSTIN });
    await s.client.invalidateSession("einvoice", GSTIN);
    await s.client.einvoice.login({ gstin: GSTIN });
    expect(s.mock.count("einvoice.auth")).toBe(2);
  });

  it("authErrorCodes: a GET drops the session, logs in again and retries once", async () => {
    const s = setup({ client: { authErrorCodes: { einvoice: [AUTH_ERROR_CODE.einvoice] } } });
    await s.client.einvoice.login({ gstin: GSTIN });
    s.mock.tokens.clear(); // server forgets the token
    s.mock.current.clear();
    const r = await s.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh });
    expectOk(r);
    expect(codes(r)).toContain("SESSION_RENEWED");
    expect(s.mock.count("einvoice.auth")).toBe(2);
    expect(s.mock.count("einvoice.getGstinDetails")).toBe(2);
  });

  it("authErrorCodes: a POST is not retried (but the session is dropped)", async () => {
    const s = setup({ client: { authErrorCodes: { einvoice: [AUTH_ERROR_CODE.einvoice] } } });
    await s.client.einvoice.login({ gstin: GSTIN });
    s.mock.tokens.clear();
    s.mock.current.clear();
    const e = expectErr(
      await s.client.einvoice.cancelIrn({
        gstin: GSTIN,
        request: { Irn: "a".repeat(64), CnlRsn: "1" },
      }),
    );
    expect(e.kind).toBe("api");
    expect(s.mock.count("einvoice.cancelIrn")).toBe(1);
    await s.client.einvoice.login({ gstin: GSTIN });
    expect(s.mock.count("einvoice.auth")).toBe(2);
  });

  it("without authErrorCodes nothing is dropped", async () => {
    const s = setup();
    await s.client.einvoice.login({ gstin: GSTIN });
    s.mock.tokens.clear();
    const e = expectErr(
      await s.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }),
    );
    expect(e.kind === "api" && e.errors[0]?.code).toBe(AUTH_ERROR_CODE.einvoice);
    expect(expectOk(await s.client.einvoice.login({ gstin: GSTIN })).reused).toBe(true);
  });
});

describe("session store", () => {
  it("a custom store receives set/get/delete with the documented shape", async () => {
    const calls: string[] = [];
    const mem = createMemorySessionStore();
    let stored: Session | undefined;
    const store: SessionStore = {
      get: (k) => {
        calls.push("get");
        return mem.get(k);
      },
      set: (k, v) => {
        calls.push("set");
        stored = v;
        return mem.set(k, v);
      },
      delete: (k) => {
        calls.push("delete");
        return mem.delete(k);
      },
    };
    const s = setup({ client: { sessionStore: store } });
    await s.client.einvoice.login({ gstin: GSTIN });
    await s.client.invalidateSession("einvoice", GSTIN);
    expect(calls).toStrictEqual(["get", "set", "delete"]);
    expect(Object.keys(stored ?? {}).sort()).toStrictEqual(
      [
        "authToken",
        "expiresAt",
        "expirySource",
        "gstin",
        "obtainedAt",
        "sek",
        "system",
        "username",
      ].sort(),
    );
    expect(Buffer.from(stored?.sek ?? "", "base64")).toHaveLength(32);
    expect(stored?.expiresAt).toBe(T0 + 6 * HOUR);
  });
});
