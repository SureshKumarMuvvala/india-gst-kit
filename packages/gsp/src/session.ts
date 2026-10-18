// Source: https://einv-apisandbox.nic.in/version1.04/authentication.html — sources/einvoice/api/v1.04-authentication.txt;
//         https://docs.ewaybillgst.gov.in/apidocs/version1.03/authenticationV1.03.html — sources/ewaybill/api/v1.03-authentication.txt
// Retrieved: 2026-10-18
// Status: UNVERIFIED — needs CA (token 360 min, 60 on the e-invoice sandbox; same token on re-auth, not extended;
//         ForceRefreshAccessToken only in the last 10 minutes — finding G5; spec §5, D-G9, D-G10)
import { encodeBase64 } from "./crypto.js";
import { asAuthError, failResult, okResult, type GspResult, type System } from "./errors.js";
import { warning, type GspIssue } from "./issues.js";
import type { GspProvider, LoginData, Session } from "./provider.js";

export const REFRESH_WINDOW_MS = 10 * 60 * 1000;

/** Async key/value store for sessions. The values hold the auth token and SEK: protect them (spec §5.5). */
export type SessionStore = {
  get: (key: string) => Promise<Session | undefined>;
  set: (key: string, session: Session) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

export function createMemorySessionStore(): SessionStore {
  const map = new Map<string, Session>();
  return {
    get: (key) => Promise.resolve(map.get(key)),
    set: (key, session) => {
      map.set(key, session);
      return Promise.resolve();
    },
    delete: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
  };
}

export type SessionEvent = {
  type: "login" | "session-reused" | "session-refresh";
  system: System;
  forceRefresh?: boolean;
};

export type SessionDeps = {
  provider: GspProvider;
  store: SessionStore;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  skewMs: number;
  login: (system: System, gstin: string, forceRefresh: boolean) => Promise<GspResult<LoginData>>;
  onEvent: (e: SessionEvent) => void;
};

export type SessionGet = { session: Session; reused: boolean };

export class SessionManager {
  readonly #deps: SessionDeps;
  readonly #inflight = new Map<string, Promise<GspResult<Session>>>();
  readonly #generation = new Map<string, number>();

  constructor(deps: SessionDeps) {
    this.#deps = deps;
  }

  key(system: System, gstin: string, username: string): string {
    const p = this.#deps.provider;
    return [p.name, system, p.baseUrl(system), gstin, username].join("|");
  }

  async invalidate(system: System, gstin: string, username: string): Promise<void> {
    const key = this.key(system, gstin, username);
    this.#generation.set(key, (this.#generation.get(key) ?? 0) + 1);
    await this.#deps.store.delete(key);
  }

  /** A usable session per the refresh table in spec §5.3. */
  async get(system: System, gstin: string, username: string): Promise<GspResult<SessionGet>> {
    const d = this.#deps;
    const key = this.key(system, gstin, username);
    const cached = await d.store.get(key);
    const t = d.now();
    if (cached !== undefined) {
      const e = cached.expiresAt;
      if (t < e - REFRESH_WINDOW_MS) return this.#reuse(cached);
      const canForce = d.provider.session.forceRefresh[system];
      if (t < e - d.skewMs) {
        if (!canForce || !d.provider.session.proactiveRefresh) return this.#reuse(cached);
        d.onEvent({ type: "session-refresh", system, forceRefresh: true });
        const r = await this.#login(key, system, gstin, true, cached);
        if (r.ok) return okResult({ session: r.value, reused: false }, r.warnings);
        return okResult({ session: cached, reused: true }, [
          ...r.warnings,
          warning(
            "REFRESH_FAILED_USING_CACHED",
            "proactive token refresh failed; the cached token is still valid",
          ),
        ]);
      }
      if (t < e) {
        if (canForce) {
          const r = await this.#login(key, system, gstin, true, cached);
          return r.ok
            ? okResult({ session: r.value, reused: false }, r.warnings)
            : failResult(r.error, r.warnings);
        }
        // EWB: re-auth before expiry returns the same token, so wait it out (spec §5.3).
        await d.sleep(e - t);
      }
    }
    const r = await this.#login(key, system, gstin, false, cached);
    return r.ok
      ? okResult({ session: r.value, reused: false }, r.warnings)
      : failResult(r.error, r.warnings);
  }

  #reuse(session: Session): GspResult<SessionGet> {
    this.#deps.onEvent({ type: "session-reused", system: session.system });
    return okResult({ session, reused: true });
  }

  /** One login in flight per key; waiters share the result; a failure is not cached. */
  #login(
    key: string,
    system: System,
    gstin: string,
    forceRefresh: boolean,
    cached: Session | undefined,
  ): Promise<GspResult<Session>> {
    const running = this.#inflight.get(key);
    if (running !== undefined) return running;
    const generation = this.#generation.get(key) ?? 0;
    const p = this.#doLogin(key, system, gstin, forceRefresh, cached, generation).finally(() => {
      this.#inflight.delete(key);
    });
    this.#inflight.set(key, p);
    return p;
  }

  async #doLogin(
    key: string,
    system: System,
    gstin: string,
    forceRefresh: boolean,
    cached: Session | undefined,
    generation: number,
  ): Promise<GspResult<Session>> {
    const d = this.#deps;
    d.onEvent({ type: "login", system, forceRefresh });
    const obtainedAt = d.now();
    const r = await d.login(system, gstin, forceRefresh);
    if (!r.ok) return failResult(asAuthError(r.error), r.warnings);
    const data = r.value;
    const warnings: GspIssue[] = [...r.warnings];
    const lifetime = d.provider.session.tokenLifetimeMinutes[system] * 60_000;
    let expiresAt = data.expiresAt ?? obtainedAt + lifetime;
    let expirySource: Session["expirySource"] =
      data.expiresAt === undefined ? "assumed" : "response";
    let sessionObtainedAt = obtainedAt;
    // No extension on re-auth (G5): the same token keeps its original expiry.
    if (cached?.authToken === data.authToken) {
      sessionObtainedAt = cached.obtainedAt;
      if (expiresAt > cached.expiresAt) {
        if (expirySource === "response") {
          warnings.push(
            warning(
              "TOKEN_EXPIRY_EXTENDED_IGNORED",
              "the same token came back with a later expiry; the original is kept",
            ),
          );
        }
        expiresAt = cached.expiresAt;
        expirySource = cached.expirySource;
      }
    }
    const session: Session = {
      system,
      gstin,
      username: data.username,
      authToken: data.authToken,
      sek: encodeBase64(data.sek),
      obtainedAt: sessionObtainedAt,
      expiresAt,
      expirySource,
    };
    if ((this.#generation.get(key) ?? 0) === generation) await d.store.set(key, session);
    return okResult(session, warnings);
  }
}
