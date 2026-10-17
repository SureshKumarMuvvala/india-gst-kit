# Spec — `@india-gst-kit/gsp` (v0.1)

Status: **draft 2026-10-17, Phase 1 (spec only), not yet approved.** No package code is written until the owner approves this spec and decides §14. Every legal or official fact here is **UNVERIFIED — needs CA** until a chartered accountant signs it off in `docs/legal-facts.md`. Every API fact here is also **UNVERIFIED until the first live sandbox call** (§15).

Sources (all under `sources/`; provenance in `sources/README.md`, section "API documentation"):

| Id | File | Page |
|---|---|---|
| **EI-AUTH** | `einvoice/api/v1.04-authentication.txt` | e-invoice v1.04 Authentication |
| **EI-GSTIN** | `einvoice/api/v1.04-get-gstin-details.txt` | e-invoice v1.04 Get GSTIN details |
| **EI-SYNC** | `einvoice/api/v1.04-sync-gstin-details-from-cp.txt` | e-invoice v1.04 Sync GSTIN details from CP |
| **EI-CNL** | `einvoice/api/v1.03-cancel-irn.txt` | e-invoice v1.03 Cancel IRN |
| **EI-GET** | `einvoice/api/v1.03-get-einvoice-details.txt` | e-invoice v1.03 Get e-invoice details by IRN |
| **EI-DOC** | `einvoice/api/v1.03-get-irn-by-doc-details.txt` | e-invoice v1.03 Get IRN by document details |
| **EI-EWBGET** | `einvoice/api/v1.03-get-ewaybill-details-by-irn.txt` | e-invoice v1.03 Get e-way bill details by IRN |
| **EI-EWBCNL** | `einvoice/api/v1.03-cancel-ewaybill-sandbox-only.txt` | e-invoice v1.03 Cancel EWB (sandbox only; not implemented, D-G22) |
| **C** | `einvoice/generate-irn-json-schema.json`, `generate-irn-validations.txt` | Generate IRN payload schema + validations (no envelope / URL / response page) |
| **I** | `ewaybill/ewb-by-irn-*.{txt,json}` | e-invoice v1.03 EWB generation by IRN |
| **EW-AUTH** | `ewaybill/api/v1.03-authentication.txt` | EWB v1.03 Authentication |
| **EW-VEH** | `ewaybill/api/v1.03-vehicle-number-update.txt` | EWB v1.03 Vehicle number (Part-B) update |
| **EW-CNL** | `ewaybill/api/v1.03-cancel-ewaybill.txt` | EWB v1.03 Cancel |
| **EW-EXT** | `ewaybill/api/v1.03-extend-validity.txt` | EWB v1.03 Extend validity |
| **EW-CEWB** | `ewaybill/api/v1.03-consolidated-ewaybill.txt` | EWB v1.03 Consolidated EWB |
| **EW-TRN** | `ewaybill/api/v1.03-update-transporter.txt` | EWB v1.03 Update transporter |
| **EW-REJ** | `ewaybill/api/v1.03-reject-ewaybill.txt` | EWB v1.03 Reject |
| **EW-GSTIN** | `ewaybill/api/v1.03-get-gstin-details.txt` | EWB v1.03 Get GSTIN details |
| **H** | `ewaybill/generate-ewaybill-*` | EWB v1.03 Generate |
| **K1** | `ewaybill/master-codes/*.csv` | EWB master codes (reason codes, modes, consignment status) |
| **L** | `ewaybill/release-notes.txt` | EWB release notes |

Findings **G1–G9** (`sources/README.md`) are referenced by number. Where a source contradicts this spec, **the source wins** and the conflict is reported in §13. Where two sources disagree, the behaviour is a configurable option with a documented default (§14) and a "verify on first live call" item (§15). Nothing in this spec is filled from memory; anything needed and not in `sources/` is listed in §16.

## 1. Purpose and scope

- **In scope (v0.1):** an HTTP client for the NIC **e-invoice (IRP)** and **e-way bill (EWB)** APIs, with:
  - a provider interface (§2), so the same core works direct-to-NIC or through a GSP; only the **direct-NIC provider** is implemented;
  - the NIC crypto (§4) with `node:crypto` only;
  - session/token handling (§5), transport (§6), envelopes and a typed error model (§7);
  - the operations in §8, with hand-transcribed Zod request/response schemas and conformance notes;
  - a normalised GSTIN lookup result (§9);
  - time-limit pre-checks that **warn, never block** (§10).
- **Out of scope:**
  - Building or validating IRN / EWB payloads: reused from `@india-gst-kit/einvoice` (`validateIrnRequest`, `serializeIrnRequest`, `decodeSignedInvoice`, `decodeSignedQrCode`) and `@india-gst-kit/ewaybill` (`validateEwbRequest`, `serializeEwbRequest`, `parseEwbResponseData`, `validateEwbByIrnRequest`, `serializeEwbByIrnRequest`, `parseEwbByIrnResponseData`).
  - Deciding taxability, whether an e-invoice or e-way bill is required, ITC, or what a GSTIN's status means for a business decision. The client reports what the portal says.
  - JWT **signature** verification (einvoice spec §8.4; NIC's signing key is not in `sources/`, G3).
  - Any GSP-specific adapter (only the extension points, §2.3).
  - Other APIs: get EWB details, get EWBs by date, multi-vehicle, regenerate consolidated EWB, TRANSIN lookup, HSN lookup, e-invoice B2C QR, e-invoice cancel-EWB (sandbox only, D-G22).
  - Error-code descriptions (list not captured, §7.4).
- **Package rules:** ESM only, named exports, Zod 4 (peer `^4.0.0`), `z.strictObject` for every object we **send**; types are `z.infer`. Money, quantities, numbers-on-the-wire, dates and times are **strings** in memory. Dependencies: `@india-gst-kit/model`, `@india-gst-kit/einvoice`, `@india-gst-kit/ewaybill` (all `workspace:^`), `decimal.js` only if needed. **No new runtime dependencies**, in particular no crypto or HTTP library: `node:crypto` and the platform `fetch` (injectable) only.
- **No env reading, no hard-coded secrets.** Every credential, key, base URL and the `fetch`, clock, random source and session store are passed in by the caller (§3). The only built-in values are the documented defaults in §3.3, each marked UNVERIFIED.

## 2. Provider design (G1)

G1: direct NIC access needs a ₹100 crore turnover (e-invoice) or ~10,000 EWBs a month per GSTIN (EWB) plus whitelisted static IPs; most users reach NIC **through a GSP**. GSPs front the same NIC APIs but differ in base URL, extra headers, and sometimes in auth and encryption. So the core is written against a provider interface.

### 2.1 Layers
```
operation (generateIrn, cancelEwb, …)        ← §8: request schema, local validation, pre-checks, response schema
  └─ core client                               ← session (§5), redaction (§6.4), result/error model (§7)
       └─ GspProvider                          ← §2.2: endpoints, headers, auth, payload codec, envelope decoding
            └─ transport (injectable fetch)    ← §6: timeouts, retries (GET only), logging
```

### 2.2 `GspProvider` interface (the extension points)
A provider is a plain object (no classes required) implementing:

| Member | Purpose | Direct-NIC implementation |
|---|---|---|
| `name: string` | for logs/errors | `"nic-direct"` |
| `endpoint(system, op): EndpointSpec` | `{ method: "GET" \| "POST", baseUrl, path, query?, action? }` per operation | §3.3 path table + caller's base URLs |
| `buildHeaders(ctx): Record<string, string>` | header names/values per call (`ctx` = system, op, gstin, credentials, session, `supGstin`) | §6.2, names configurable (G4) |
| `auth: AuthStrategy` | `login(ctx) → Promise<GspResult<Session>>` | NIC login with RSA + AppKey (§4, §5) |
| `codec: PayloadCodec` | `encodeRequest(json, session)` / `decodeResponse(envelope, session)` | AES-256-ECB with SEK; EWB `rek`/`hmac` path (§4) |
| `envelope: EnvelopeDecoder` | turn the HTTP body into `{ status, data, errors, info, extra }` | tolerant NIC envelope (§7.1) |

`AuthStrategy`, `PayloadCodec` and `EnvelopeDecoder` are exported types, so a GSP adapter can reuse the NIC implementations and override one piece (e.g. reuse the codec, replace headers and base URL).

### 2.3 GSP adapter (later; extension points only)
v0.1 defines and tests the seams with a **fake GSP provider in tests only** (extra header `x-test-gsp-key`, different base URL, passthrough codec) to prove that the core does not assume NIC. Real GSP adapters are a later track and need the GSP's own documentation (§16). Known axes of difference to support:
- base URL and path prefix per system;
- extra or renamed headers (GSP subscription/ASP id, GSP token);
- auth: NIC login forwarded through the GSP, or a GSP-issued token with no SEK;
- payload: NIC-encrypted, or plain JSON with the GSP encrypting on its side;
- envelope: NIC's, or wrapped by the GSP.

## 3. Configuration

### 3.1 `createGspClient(config)`
```ts
createGspClient({
  provider,                        // GspProvider; createNicDirectProvider(...) for direct NIC
  credentials,                     // ({ system, gstin }) => NicCredentials | Promise<NicCredentials>
  fetch?,                          // default globalThis.fetch
  clock?,                          // { now(): number } epoch ms; default Date.now
  sleep?,                          // (ms) => Promise<void>; default setTimeout-based
  randomBytes?,                    // (n) => Uint8Array; default crypto.randomBytes
  sessionStore?,                   // default in-memory (§5.5)
  logger?,                         // (event: GspLogEvent) => void; default none (§6.5)
  timeoutMs?,                      // default 30_000 (§6.3)
  getRetries?,                     // default 0 (§6.3), GET operations only
  authErrorCodes?,                 // { einvoice: string[], ewaybill: string[] }, default empty (§5.4)
  expirySkewSeconds?,              // default 60 (§5.2)
})
```
Returns `{ einvoice: { … }, ewaybill: { … }, invalidateSession(system, gstin), close() }`. Config is validated with a Zod schema at creation; an invalid config **throws** (programmer error). Nothing else throws on data or API failures (§7).

### 3.2 `NicCredentials` (per system and GSTIN, supplied by the caller)
`{ clientId, clientSecret, username, password, publicKey, gstin }` where `publicKey` is a PEM string (X.509 SubjectPublicKeyInfo, G2) or a `KeyObject`. e-invoice and EWB credentials and keys are **different** (different portals; sandbox vs production keys differ). Secret fields are wrapped internally in a `Secret` holder whose `toString`, `toJSON` and `util.inspect` return `"[REDACTED]"` (§6.4). The public key is downloaded by the user after login (G3); it is never committed and no test uses a real one.

### 3.3 `createNicDirectProvider(options)` and documented defaults
```ts
createNicDirectProvider({
  baseUrls: { einvoice: string, ewaybill: string },   // REQUIRED: no official base URL is in sources/ (§16)
  paths?: Partial<Record<OperationId, string>>,       // override any default below
  headerNames?: { einvoice?: HeaderNameMap, ewaybill?: HeaderNameMap },  // G4, §6.2
  payloadPlaintext?: { einvoice?: "json" | "base64-json", ewaybill?: "json" | "base64-json" }, // D-G6
  authPlaintext?: "base64-json" | "json",             // default "base64-json" (D-G6)
  tokenLifetimeMinutes?: { einvoice?: number, ewaybill?: number },     // fallbacks, §5.1
  proactiveRefresh?: boolean,                          // default true (D-G9)
  verifyHmac?: boolean,                                // default true (D-G12)
})
```
Default path table, transcribed **literally** from the `URL` row of each source (`<URL>` = the caller's base URL; joining normalises exactly one `/`). All UNVERIFIED (§15 V1):

| Op id | System | Method | Default path | Action | Source |
|---|---|---|---|---|---|
| `einvoice.auth` | einvoice | POST | `/v1.04/auth` | — | EI-AUTH |
| `einvoice.getGstinDetails` | einvoice | GET | `/eivital/v1.04/Master/gstin/{gstin}` | — | EI-GSTIN |
| `einvoice.syncGstinDetails` | einvoice | GET | `/eivital/v1.04/Master/syncgstin/{gstin}` | — | EI-SYNC |
| `einvoice.generateIrn` | einvoice | POST | **none** (page not captured; caller must set `paths["einvoice.generateIrn"]`) | — | §16 F1 |
| `einvoice.cancelIrn` | einvoice | POST | `/api/Cancel` | — | EI-CNL |
| `einvoice.getEinvoiceByIrn` | einvoice | GET | `/api/Invoice/irn/{irn}` | — | EI-GET |
| `einvoice.getIrnByDocDetails` | einvoice | GET | `/irnbydocdetails?doctype={docType}&docnum={docNum}&docdate={docDate}` | — | EI-DOC (stray `/` after `doctype=` dropped, §13 GD14) |
| `einvoice.getEwbByIrn` | einvoice | GET | `/eiewb/v1.03/ewaybill/irn/{irn}` | — | EI-EWBGET |
| `einvoice.generateEwbByIrn` | einvoice | POST | `/api/einvewb/ewaybill` | — | I (source has no `/` after `<URL>`) |
| `ewaybill.auth` | ewaybill | POST | `/auth/` | (`ACCESSTOKEN` inside the encrypted JSON) | EW-AUTH |
| `ewaybill.generate` | ewaybill | POST | `/ewayapi/` | `GENEWAYBILL` | H |
| `ewaybill.updateVehicle` | ewaybill | POST | `/ewayapi/` | `VEHEWB` | EW-VEH |
| `ewaybill.cancel` | ewaybill | POST | `/ewayapi/` | `CANEWB` | EW-CNL |
| `ewaybill.extendValidity` | ewaybill | POST | `/ewayapi/` | `EXTENDVALIDITY` | EW-EXT |
| `ewaybill.consolidated` | ewaybill | POST | `/ewayapi/` | `GENCEWB` | EW-CEWB |
| `ewaybill.updateTransporter` | ewaybill | POST | `/ewayapi/` | `UPDATETRANSPORTER` | EW-TRN |
| `ewaybill.reject` | ewaybill | POST | `/ewayapi/` | `REJEWB` | EW-REJ |
| `ewaybill.getGstinDetails` | ewaybill | GET | `/Master/GetGSTINDetails?GSTIN={gstin}` | — | EW-GSTIN ("URL Parameters: GSTIN"; the query-parameter reading is ours, §15 V12) |

Path placeholders are filled with `encodeURIComponent` / `URLSearchParams` (document numbers may contain `/`). Action strings are sent **trimmed** (samples carry spaces: `"CANEWB "`, `" VEHEWB "`, §13 GD10).

Other documented defaults (UNVERIFIED): token lifetime 360 min for both systems (EI-AUTH, EW-AUTH; 60 min on the e-invoice sandbox — the caller sets `tokenLifetimeMinutes.einvoice = 60` for sandbox), refresh window 10 min (EI-AUTH). Design defaults (not facts): `timeoutMs` 30 000, `getRetries` 0, `expirySkewSeconds` 60.

## 4. Crypto (G2) — `node:crypto` only (`src/nic/crypto.ts`)

All functions are pure, take `Uint8Array`/strings, and return result objects (`{ ok, value } | { ok: false, reason }`); none logs. Base64 is standard (RFC 4648 §4, with padding) unless stated.

| Function | Spec | Source |
|---|---|---|
| `generateAppKey(randomBytes)` | 32 random bytes; returned as `{ bytes, base64 }` (base64 is 44 chars) | EI-AUTH ("random 32 bytes … 44 chars"); EWB uses the same (D-G7) |
| `rsaEncryptLogin(plaintext, publicKey)` | `crypto.publicEncrypt({ key, padding: RSA_PKCS1_PADDING }, bytes)` → Base64. Input longer than `modulusBytes − 11` → `reason: "rsa-input-too-large"` (never truncated) | G2 (`RSA/ECB/PKCS1PADDING`, SPKI PEM) |
| `buildLoginPlaintext(system, creds, appKey, forceRefresh)` | e-invoice JSON `{ UserName, Password, AppKey, ForceRefreshAccessToken }` (boolean); EWB JSON `{ action: "ACCESSTOKEN", username, password, app_key }`. Then Base64 of the UTF-8 JSON when `authPlaintext = "base64-json"` (default; "encoded using Base64 and then encrypted", EI-AUTH, EW-AUTH) | EI-AUTH, EW-AUTH |
| `decryptSek(sekBase64, appKeyBytes)` | AES-256-ECB, PKCS#7 padding, key = the 32 raw AppKey bytes → SEK; result must be exactly 32 bytes, else `reason: "bad-sek"` | EI-AUTH ("AES/ECB/PKCS7Padding … with AppKey"), EW-AUTH |
| `aesEcbEncrypt(plain, key32)` / `aesEcbDecrypt(cipherBase64, key32)` | `createCipheriv("aes-256-ecb", key, null)`, PKCS#7 (Node default). Wrong padding / length → `reason: "decrypt-failed"` | G2 |
| `encodePayload(json, sek, form)` | `form = "json"`: Base64(AES(utf8(JSON))). `form = "base64-json"`: Base64(AES(ascii(Base64(utf8(JSON))))) — the literal reading of `Encrypt(Base64(Request JSON), sek)` | EW-* notation; EI-CNL "encrypted … JSON using Sek"; D-G6 |
| `decodePayload(dataBase64, key)` | AES-decrypt; if the plaintext parses as JSON → done (`form: "json"`); else if it is valid Base64 whose decoding parses as JSON → done (`form: "base64-json"`); else `reason: "bad-response-data"`. The detected form is returned for diagnostics (§15 V5) | tolerant, D-G6 |
| `decodeRekResponse({ data, rek, hmac }, sek, verify)` | `rekKey = aesEcbDecrypt(rek, sek)` (must be 32 bytes; if it is instead 44 Base64 chars decoding to 32 bytes, accept and record the form, §15 V9); `payload = decodePayload(data, rekKey)`; `expected = HMAC-SHA256(key = rekKey, message = ascii(Base64(utf8(JSON))))` as received in the plaintext (if the plaintext was raw JSON, its Base64 is computed); compare to `Base64-decode(hmac)` with `crypto.timingSafeEqual`. Mismatch → `reason: "hmac-mismatch"` (fail closed, D-G12) | EW-GSTIN, G2 |

Test vectors are **self-generated** (§12.1): a 2048-bit RSA key pair created in the test run with `generateKeyPairSync`, fixed AppKey/SEK/rek bytes from a seeded `randomBytes`, and expected ciphertexts produced by an independent test-side implementation. AES-ECB is deterministic, so fixed key + plaintext ⇒ fixed ciphertext and the vectors are asserted byte-for-byte; RSA PKCS#1 v1.5 is randomised, so it is asserted by round-trip. The test-side RSA decrypt uses `privateDecrypt` with `RSA_NO_PADDING` and strips the PKCS#1 v1.5 block itself, so tests do not depend on whether a Node release allows PKCS#1 v1.5 `privateDecrypt` (it does on Node 22.22.0, checked 2026-10-17). No real key, token or SEK ever appears in the repository.

## 5. Session and token handling (G5) — `src/session.ts`

### 5.1 Session
`Session = { system, gstin, username, authToken: Secret, sek: Secret<Uint8Array>, obtainedAt: number, expiresAt: number, expirySource: "response" | "assumed" }`.
- **e-invoice:** `expiresAt` from `TokenExpiry` (`yyyy-MM-dd HH:mm:ss`), interpreted as **IST, UTC+05:30** (D-G8; the page states no zone, §15 V7). Missing or unparseable → `obtainedAt + tokenLifetimeMinutes` with `expirySource: "assumed"` and a warning.
- **EWB:** the auth response has no expiry (EW-AUTH), so `expiresAt = obtainedAt + tokenLifetimeMinutes.ewaybill` (`"assumed"`).

### 5.2 Cache key and lifecycle
- Key: `provider.name | system | baseUrl | gstin | username`. One session per key ("caching per GSTIN").
- A session is **usable** while `now < expiresAt − expirySkewSeconds`.
- **No extension on re-auth (G5):** if a login returns the **same** `authToken` as the cached session, `expiresAt` is **not** moved later. For e-invoice the response `TokenExpiry` is used if present (it should be the original), but if it is later than the cached `expiresAt` for the same token, the earlier one is kept and a warning `TOKEN_EXPIRY_EXTENDED_IGNORED` is raised. The SEK from that response (decrypted with the new AppKey) replaces the cached one (D-G10, §15 V8).

### 5.3 Refresh policy (D-G9)
Per call, with `t = now`, `E = expiresAt`, `W = 10 min` (EI-AUTH), `S = expirySkewSeconds`:

| State | e-invoice | EWB |
|---|---|---|
| no session | login, `ForceRefreshAccessToken: false` | login |
| `t < E − W` | use cached | use cached |
| `E − W ≤ t < E − S` | if `proactiveRefresh`: login with `ForceRefreshAccessToken: true` (single flight); on failure fall back to the cached session with warning `REFRESH_FAILED_USING_CACHED`. Else use cached | use cached (EWB has no force-refresh field; re-auth would return the same token) |
| `E − S ≤ t < E` | login with `ForceRefreshAccessToken: true` | wait (injected `sleep`) until `E`, then login |
| `t ≥ E` | login, `ForceRefreshAccessToken: false` | login |

`ForceRefreshAccessToken: true` is **never** sent outside the last 10 minutes (EI-AUTH: "provision to forcefully generate a new token within the last 10 minutes").

### 5.4 Concurrency and invalidation
- **One login in flight per key:** a `Map<key, Promise>`; concurrent callers await the same promise. A failed login is not cached; every waiter gets the same error result.
- `invalidateSession(system, gstin)` drops the session (and any in-flight login result once it settles is still delivered to its waiters but not stored).
- Error codes meaning "invalid/expired token" are **not captured** (§16 F2). The caller may pass `authErrorCodes` (data, default empty). When a status-0 response carries one of them, the session is dropped; a **GET** operation is then retried once after a fresh login; a POST is **not** retried (§6.3).

### 5.5 Session store
`SessionStore = { get(key), set(key, session), delete(key) }`, all async. Default: in-memory `Map`, per client. A persistent store (shared across processes, so restarts don't re-login and lose the original expiry) is caller-supplied. Documented warning: the store holds the token and SEK, which are secrets; serialisation is `{ …, authToken: string, sek: base64 }` and the store must protect it.

## 6. Transport (`src/transport.ts`)

### 6.1 Request
- `fetch` is injected (default `globalThis.fetch`); no `http`/`https` modules, no sockets in tests.
- Body: `JSON.stringify` of the envelope (all values in the envelope are strings). `Content-Type: application/json` (every source).
- e-invoice POST body: `{ "Data": "<base64>" }` (EI-AUTH, EI-CNL, I). EWB auth body `{ "Data": "<base64>" }` (EW-AUTH sample). EWB operation body `{ "action": "<ACTION>", "data": "<base64>" }` (lower-case keys, per the samples; the tables say `Action`, §13 GD9).

### 6.2 Header names (G4)
`HeaderNameMap = { clientId, clientSecret, gstin, username?, authToken, supGstin? }`. Defaults are the names **documented on the API pages**:

| Logical | e-invoice default (EI-*) | EWB default (EW-*) |
|---|---|---|
| clientId | `client_id` | `client-id` |
| clientSecret | `client_secret` | `client-secret` |
| gstin | `Gstin` | `Gstin` |
| username | `user_name` (not on auth) | — |
| authToken | `AuthToken` (not on auth) | `authtoken` (not on auth) |
| supGstin | `sup_gstin` (optional, e-commerce operator / RCM; EI-CNL, EI-GET, EI-DOC, EI-EWBGET, I) | — |

The e-invoice Java sample (not committed) uses `client-id`/`client-secret`/`gstin` (G4); a preset `NIC_EINVOICE_HEADERS_JAVA_SAMPLE` is exported, and `headerNames.einvoice` accepts it or any map. Case differences (`Gstin`/`gstin`, `authtoken`/`Authtoken`) do not matter (HTTP header names are case-insensitive); underscore vs hyphen does. Settled by §15 V2.

### 6.3 Timeouts and retries
- Every request has `AbortSignal.any([AbortSignal.timeout(timeoutMs), callerSignal])`.
- **POST operations are never retried** (generate, cancel, update, extend, reject, consolidated, EWB-by-IRN, and auth). A timeout or network error after the request was handed to `fetch` gives `TransportError { outcome: "unknown" }`: the caller must reconcile (e.g. `getIrnByDocDetails` after a failed `generateIrn`; the duplicate-IRN error, G9, also tells them). Documented in the README.
- **GET operations** may be retried up to `getRetries` times (default 0) on network error, timeout or HTTP 5xx, with backoff `250 ms × 2^n` via the injected `sleep`. `syncGstinDetails` is a GET with a server-side refresh; retrying it is harmless.
- No automatic retry ever follows a status-0 API error, except the single post-relogin GET retry in §5.4.

### 6.4 Redaction
- A per-client `Redactor` registers every secret **value** as it appears: client secret, password, AppKey (bytes and Base64), auth token, SEK (Base64 and raw), `rek`, the RSA-encrypted login blob, and the `Data`/`data` ciphertexts of auth requests/responses. Any string placed into an error, warning, log event or `raw` field passes through `redact()`, which replaces each registered value with `[REDACTED]`.
- Header values for `clientSecret` and `authToken` names are always replaced, whatever the configured names.
- Errors never carry the `Request`/`Response` objects, the request headers, or decrypted request payloads. They may carry the **decrypted response** of a failed call only when it contains no secret (never for auth).
- `Secret` holders (§3.2) make accidental `console.log(config)` / `JSON.stringify(config)` safe.
- Tests assert, for every error kind, that `JSON.stringify(result)` and every logger event contain none of the test secrets (§12.4).

### 6.5 Logging
Optional `logger(event)`; events: `request` (system, op, method, URL **path** without query values except `GSTIN`/`irn`, attempt), `response` (HTTP status, envelope status, duration ms), `login`, `session-reused`, `session-refresh`, `retry`, `warning`. No bodies, ever. All strings redacted.

## 7. Envelopes, results and errors (`src/envelope.ts`, `src/errors.ts`)

### 7.1 Tolerant envelope decoding
The sources disagree on key case and types (§13 GD3–GD5). The NIC decoder:
- reads keys case-insensitively: `status`, `data`, `errordetails`, `infodtls`, `error`, `alert`, `info`, `rek`, `hmac`;
- `status`: `1`, `"1"` → success; `0`, `"0"` → failure; anything else → `ProtocolError("bad-envelope")`;
- unknown top-level keys → warning `UNEXPECTED_KEY`, never silent, never blocking (as in einvoice D-Q5);
- body that is not JSON → `ProtocolError("bad-json")` with HTTP status and the first 200 chars of the body (redacted);
- an envelope is decoded **whatever the HTTP status**; a non-2xx without a decodable envelope → `TransportError { reason: "http", httpStatus }`.
- Auth responses: e-invoice `Data` is a **plain object** `{ ClientId, UserName, AuthToken, Sek, TokenExpiry }` (only `Sek` is encrypted, EI-AUTH); EWB is flat `{ status, authtoken, sek }` (EW-AUTH).

### 7.2 Error details
- e-invoice `ErrorDetails` is described as "Base 64 encoded string … JSON array" of `{ ErrorCode, ErrorMessage }` (EI-CNL, EI-GET, …), while EI-AUTH lists the fields inline and every sample shows a placeholder. Accepted forms: array, single object, JSON string, Base64 of JSON. Each becomes `{ code: string, message?: string }`. Unrecognised → one entry `{ code: "UNKNOWN" }` plus `raw`.
- EWB `error` is `{ "errorCodes": 240 }` in every sample; EI-EWBCNL says "Base 64 encoded string". Accepted: object with `errorCodes` as number or string, or Base64 of such JSON. A string of codes is split on `,` and trimmed, empty parts dropped (§15 V10). Messages: none (the list is not captured).

### 7.3 Result type
```ts
type GspResult<T> =
  | { ok: true;  value: T; info?: string; warnings: GspIssue[] }
  | { ok: false; error: GspError; warnings: GspIssue[] };
```
`GspIssue = { code, severity: "warning", message, path? }` (Zod schema `GspIssueSchema`). `info` carries `InfoDtls` / `alert` / `info` text.

`GspError` is a Zod-described discriminated union on `kind` (plain data, `instanceof` not needed):

| kind | Fields | When |
|---|---|---|
| `validation` | `issues` (from einvoice/ewaybill/our schemas) | local validation failed; **nothing was sent** |
| `auth` | `cause: GspError` | login failed (wraps `api`/`transport`/`protocol`/`crypto`) |
| `api` | `system, op, errors: { code, message? }[], info?, httpStatus, raw` | status 0 |
| `transport` | `reason: "network" \| "timeout" \| "aborted" \| "http"`, `httpStatus?`, `outcome: "not-sent" \| "unknown"` | fetch failed / non-2xx without envelope |
| `protocol` | `reason: "bad-json" \| "bad-envelope" \| "decrypt-failed" \| "bad-response-data" \| "hmac-mismatch" \| "response-schema"`, `issues?`, `raw?` | response not understood |
| `crypto` | `reason: "rsa-input-too-large" \| "bad-public-key" \| "bad-sek"` | local crypto failed |
| `config` | `reason`, e.g. `"no-path"` for `einvoice.generateIrn` without a configured path | op used without required config |

Functions throw only on programmer errors (wrong argument types, invalid `createGspClient` config).

### 7.4 Error codes are data
The official error-code lists (`api-error-codes-list.html` on both portals) are **not captured** (§16 F2). v0.1 ships **no** code table. It exports `ErrorCodeInfoSchema = { system, code, message, source, retrieved }` and `describeErrorCode(system, code, table)` which looks up a caller-supplied table; a later build adds the official table as its own file with a `Source`/`Retrieved`/`Status` header and a `docs/legal-facts.md` row. Codes named in `sources/` (G9's 2150/2295, L's 620, the samples' 240) are **not** given meanings in code.

## 8. Operations (v0.1)

Every operation: `(args) → Promise<GspResult<T>>`, `args = { gstin, …, supGstin?, context?, signal? }`. Steps: validate `gstin` (D-G19) → validate request (errors block, D-G16) → pre-checks (warnings, §10) → session (§5) → encode → send → decode envelope → decrypt → parse response (lenient, unknown keys = warnings, lossless numbers via `@india-gst-kit/model`'s JSON helpers) → result.

**Numbers:** in memory every wire number is a string (`EwbInt = /^\d+$/` etc.); the request serialiser writes the JSON type the source schema states (D-G18). Response numbers are accepted as number **or** string and returned as strings.

### 8.1 e-invoice

| Op | Request | Response `value` | Notes |
|---|---|---|---|
| `auth` (internal; also exported as `einvoice.login`) | §4 | `Session` metadata without secrets: `{ expiresAt, expirySource, reused: boolean }` | EI-AUTH. "Only taxpayer GSTINs enabled for e-invoicing are allowed" |
| `getGstinDetails({ gstin, target })` | `target` GSTIN in the path | `GstinDetails` (§9) | EI-GSTIN |
| `syncGstinDetails({ gstin, target })` | same | `GstinDetails` | EI-SYNC |
| `generateIrn({ gstin, request: IrnRequest, supGstin? })` | `validateIrnRequest` (errors block) → `serializeIrnRequest` → encrypt | `GenerateIrnResponse` (provisional, below) | C; envelope assumed `{ Data }` as for EI-CNL and I; **URL/response page not captured** (§16 F1, D-G23) |
| `cancelIrn({ gstin, request: CancelIrnRequest, supGstin?, context? })` | `CancelIrnRequestSchema` | `{ Irn, CancelDate }` | EI-CNL; pre-check PC1 |
| `getEinvoiceByIrn({ gstin, irn, supGstin?, context? })` | `irn` = 64 hex chars (case kept) | `EinvoiceDetails` | EI-GET; pre-check PC2 |
| `getIrnByDocDetails({ gstin, docType, docNum, docDate, supGstin?, context? })` | `docType` ∈ `INV`/`CRN`/`DBN`, `docNum` per einvoice doc-number rule, `docDate` `DD/MM/YYYY` (as in C; §15 V13) | `EinvoiceDetails` | EI-DOC; pre-check PC2 |
| `getEwbByIrn({ gstin, irn, supGstin? })` | | `{ EwbNo, Status: "ACT"\|"CNL", GenGstin, EwbDt, EwbValidTill }` | EI-EWBGET |
| `generateEwbByIrn({ gstin, request: EwbByIrnRequest, supGstin? })` | `validateEwbByIrnRequest` → `serializeEwbByIrnRequest` | `parseEwbByIrnResponseData` result | I (via `@india-gst-kit/ewaybill`) |

- `CancelIrnRequestSchema` = strictObject `{ Irn: string(64), CnlRsn: enum "1"|"2"|"3"|"4", CnlRem?: string(0..100) }`. Conformance (G7): the source puts `required` **inside** `properties`, which makes nothing required under draft-04; we apply the evident intent (`Irn`, `CnlRsn` required). The sample's `"CnlRsn":"1 "` (trailing space) fails our enum; the conformance test asserts exactly that. Code meanings (EI-CNL): 1 Duplicate, 2 Data entry mistake, 3 Order cancelled, 4 Others — **different from EWB** (§13 GD1, D-G14). Exported as `EINVOICE_CANCEL_REASONS` (own file, Source header).
- `EinvoiceDetails` = `{ AckNo: Int, AckDt: "yyyy-MM-dd HH:mm:ss", Irn, SignedInvoice, SignedQRCode, Status: string, EwbNo?: Int|null, EwbDt?: string|null, EwbValidTill?: string|null, Remarks?: string|null }`. `Status` values: `ACT`, `CNL`, `REJ` (EI-GET) / `ACT`, `CNL` (EI-DOC); any other value → warning `UNKNOWN_STATUS`, value kept. The client additionally returns `signedInvoice` / `signedQrCode` decoded with `decodeSignedInvoice` / `decodeSignedQrCode` (`signatureVerified: false`).
- `GenerateIrnResponse` = provisionally the same shape as `EinvoiceDetails` (D-G23). Unknown keys are warnings; the raw decrypted JSON is returned too. Generate is **not idempotent**: no retry; on `outcome: "unknown"` the README directs the caller to `getIrnByDocDetails`.

### 8.2 e-way bill

| Op | Request schema (strict, in memory) | Response `value` | Source |
|---|---|---|---|
| `generate({ gstin, request: EwbRequest })` | `validateEwbRequest` → `serializeEwbRequest` | `parseEwbResponseData` result | H via `@india-gst-kit/ewaybill` |
| `updateVehicle` | `UpdateVehicleRequestSchema` | `{ vehUpdDate, validUpto }` | EW-VEH |
| `cancel` | `CancelEwbRequestSchema` | `{ ewayBillNo, cancelDate }` | EW-CNL |
| `extendValidity` | `ExtendValidityRequestSchema` | `{ ewayBillNo, updatedDate, validUpto }` | EW-EXT |
| `consolidated` | `ConsolidatedEwbRequestSchema` | `{ cEwbNo, cEWBDate }` | EW-CEWB |
| `updateTransporter` | `UpdateTransporterRequestSchema` | `{ ewayBillNo, transporterId, transUpdateDate }` | EW-TRN |
| `reject` | `RejectEwbRequestSchema` | `{ ewayBillNo, ewbRejectedDate }` | EW-REJ |
| `getGstinDetails({ gstin, target })` | — | `GstinDetails` (§9) via the `rek`/`hmac` path | EW-GSTIN |

Response dates are kept as **strings** (formats vary: `"15/12/2017 11:35:00 AM"`, `"21/05/2018 23:59:00 PM"`, `"12.00:00 PM"`); a value not matching `^\d{2}/\d{2}/\d{4}\s+\d{1,2}[:.]\d{2}:\d{2}(\s+[AP]M)?$` is a warning. EWB numbers are `EwbInt` strings. An optional `alert` in the decrypted data is moved to `info`.

Request schemas (wire type in brackets; conformance notes in *italics*):

- **`CancelEwbRequestSchema`** `{ ewbNo: EwbInt 12 digits [number], cancelRsnCode: "1"|"2"|"3"|"4" [number], cancelRmrk?: string ≤ 50 [string] }`. Codes from K1 `cancellation-reason-codes.csv`: 1 Duplicate, 2 Order Cancelled, 3 Data Entry mistake, 4 Others → `EWB_CANCEL_REASONS`. *Schema has no max length on `cancelRmrk`; the data structure says Text(50): 50 applied.*
- **`RejectEwbRequestSchema`** `{ ewbNo [number] }`. *Sample's Base64 `data` encodes `ewbNo` as a string; the plain sample is a number. We send a number (schema).*
- **`UpdateVehicleRequestSchema`** `{ ewbNo [number], vehicleNo?: 7–15 [string], fromPlace: ≤ 50, fromState: 2-digit state [integer ≤ 99], reasonCode: "1"–"4" [string, 1 char], reasonRem: ≤ 50, transDocNo?: ≤ 15, transDocDate?: DD/MM/YYYY, transMode: "1"–"4" [string], vehicleType?: "R"|"O" [string] }`. Reason codes K1 `vehicle-update-reason-codes.csv` → `EWB_VEHICLE_REASONS`. Cross-field (errors, from EW-VEH validations): road (1) ⇒ `vehicleNo` required; rail/air/ship (2–4) ⇒ `transDocNo` required. *G7: `vehicleType` sits outside `properties`; `ewbNo` is not in `required` — we require it (an update without an EWB number is meaningless; D-G17). The sample's keys `"transDocNo "`/`"transDocDate "` have trailing spaces: the conformance test asserts `UNEXPECTED_KEY` for both. `reasonCode` is a string(1) in the schema and Number(1) in the data structure: string (schema). Year pattern `20[1-2][0-9]` on `transDocDate` stops at 2029 (as einvoice D2): enforced, reported.*
- **`ExtendValidityRequestSchema`** `{ ewbNo [number], vehicleNo?: 7–15, fromPlace: ≤ 50, fromState [integer ≤ 99], remainingDistance: EwbInt [number], transDocNo?: ≤ 15, transDocDate?: DD/MM/YYYY, transMode: "1"–"5" [string], extnRsnCode: "1"|"2"|"4"|"5"|"99" [number], extnRemarks: string [string], fromPincode: 6 digits [number], consignmentStatus: "M"|"T" [string], transitType: ""|"R"|"W"|"O" [string], addressLine1–3?: string }`. Extension reasons K1 → `EWB_EXTENSION_REASONS` (no code 3). Cross-field errors (EW-EXT validations): `transMode` 1–4 ⇒ `consignmentStatus = "M"` and `transitType = ""`; `transMode` 5 ⇒ `consignmentStatus = "T"` and `transitType` ∈ R/W/O; road ⇒ `vehicleNo`; rail/air/ship ⇒ `transDocNo`. *G7: `required` lists `TransMode` (capital T) but the property is `transMode`; we require `transMode`. Data structure types `extnRemarks` as "Number … Refer Master": we follow the schema (string). Sample `"fromState":"29"` is a string vs integer: we send an integer. "Remaining distance ≤ distance at generation" is not checkable offline.*
- **`ConsolidatedEwbRequestSchema`** `{ fromPlace: ≤ 50, fromState [number], vehicleNo?: 7–15, transMode: "1"–"4" [string], transDocNo?: ≤ 15, transDocDate?: DD/MM/YYYY, tripSheetEwbBills: [{ ewbNo [number] }] (≥ 1) }`. Cross-field: road ⇒ `vehicleNo`; rail/air/ship ⇒ `transDocNo`. *G7-adjacent: `items` is written in draft-04 **tuple** form (`[ {…} ]`), which validates only the first element; we apply the item schema to every element. Sample `ewbNo` values are strings: we send numbers. Data structure says `transMode` Number(3): schema (string enum) followed.*
- **`UpdateTransporterRequestSchema`** `{ ewbNo [number], transporterId: ^[0-9]{2}[0-9A-Z]{13}$ [string] }`. *G7: `transporterId` sits outside `properties`; its pattern is unanchored and has a literal `|` in the class — we anchor it and drop the `|`. TRANSINs are accepted by pattern only; no check digit is applied (TRANSIN structure is not in `sources/`). Sample `"ewbNo":"161000843009"` is a string: we send a number.*

All code lists above are **legal/official lists the package enforces**: each lives in its own file (`src/codes/*.ts`) with `// Source:`, `// Retrieved:`, `// Status: UNVERIFIED — needs CA` and a `docs/legal-facts.md` row (§20).

## 9. GSTIN lookup (`src/gstin-details.ts`)

```ts
GstinDetailsSchema = z.object({
  gstin: z.string(),
  tradeName: z.string().nullable(),
  legalName: z.string().nullable(),
  address: z.object({
    buildingName: z.string().nullable(),   // EI AddrBnm
    buildingNo: z.string().nullable(),     // EI AddrBno
    floorNo: z.string().nullable(),        // EI AddrFlno
    street: z.string().nullable(),         // EI AddrSt
    location: z.string().nullable(),       // EI AddrLoc
    line1: z.string().nullable(),          // EWB address1
    line2: z.string().nullable(),          // EWB address2
  }),
  stateCode: z.string().nullable(),        // 2-digit, normaliseStateCode (EI number 29, EWB "29")
  pincode: z.string().nullable(),          // 6 digits (EI number, EWB string)
  taxpayerType: z.string().nullable(),     // TxpType / txpType; blank → null
  status: z.string().nullable(),           // raw, trimmed: ACT | CNL | INA | PRO | other
  isActive: z.boolean(),                   // status === "ACT" — "Considered active only if status='ACT'"
  blockStatus: z.enum(["UNBLOCKED", "BLOCKED", "UNKNOWN"]),  // U / "" / " " → UNBLOCKED, B → BLOCKED, null/other → UNKNOWN
  registrationDate: z.string().nullable(), // DtReg (EI only)
  deregistrationDate: z.string().nullable(),
  source: z.enum(["einvoice", "einvoice-sync", "ewaybill"]),
})
```
- **The "active only if ACT" rule** (EI-GSTIN/EI-SYNC FAQ, EW-GSTIN validations): `isActive` is true **only** when the trimmed, case-sensitive status is exactly `ACT`. `INA`, `PRO`, `CNL`, an unknown value, `null` or a missing status ⇒ `false`; an unknown or missing value also gives warning `UNKNOWN_GSTIN_STATUS`. `isActive` reports the portal's flag; it is not a statement about the taxpayer's legal position (D-G13, needs CA).
- **Block status** meaning (EI FAQ): `B` = "E Way Bill generation is not allowed for tax payers who have not filed the returns for last two months". `null` is not in the documented list but appears in the e-invoice sample ⇒ `UNKNOWN` with no warning (D-G13).
- e-invoice `Status` is in the sample and FAQ but missing from the attribute table (§13 GD6): read when present.
- Raw decrypted JSON is returned alongside (`raw`), so nothing the portal sent is lost; unknown keys are warnings.
- `target` GSTIN validation before the call (D-G19): `isGstinStructurallyValid` + GSTIN-capable state code from `@india-gst-kit/model` ⇒ else `validation` error, nothing sent; a failing mod-36 check digit ⇒ warning `GSTIN_CHECK_DIGIT` only (the algorithm is UNVERIFIED).

## 10. Time-limit pre-checks (G6) — `src/precheck.ts`

Pure functions, also run automatically when the caller passes `context`. They return **warnings only** and never block. Without the needed context field they are skipped silently. Portal timestamps (`yyyy-MM-dd HH:mm:ss` or `dd/MM/yyyy hh:mm:ss AM|PM`) are parsed as IST (D-G8); unparseable ⇒ warning `PRECHECK_DATE_UNPARSEABLE`. `now` comes from the injected clock.

| Id | Operation | Context | Warning when | Source |
|---|---|---|---|---|
| PC1 | `cancelIrn` | `ackDt`, `activeEwbExists?` | `now > ackDt + 24 h` → `IRN_CANCEL_WINDOW_PASSED`; `activeEwbExists` → `IRN_HAS_ACTIVE_EWB` | EI-CNL |
| PC2 | `getEinvoiceByIrn`, `getIrnByDocDetails` | `ackDt` | `now > ackDt + 72 h` → `IRN_LOOKUP_WINDOW_PASSED` ("within three days", read as 72 h, D-G15) | EI-GET, EI-DOC |
| PC3 | `ewaybill.cancel` | `ewbDate`, `role?` | `now > ewbDate + 24 h` → `EWB_CANCEL_WINDOW_PASSED`; `role ≠ "generator"` → `EWB_CANCEL_NOT_GENERATOR` | EW-CNL |
| PC4 | `ewaybill.reject` | `ewbDate`, `role?` | `now > ewbDate + 72 h` → `EWB_REJECT_WINDOW_PASSED`; `role = "generator"` → `EWB_REJECT_BY_GENERATOR` | EW-REJ |
| PC5 | `extendValidity` | `validUpto`, `ewbDate?`, `role?` | `now < validUpto − 8 h` or `now > validUpto + 8 h` → `EWB_EXTEND_OUTSIDE_WINDOW`; `now > ewbDate + 360 days` → `EWB_EXTEND_BEYOND_360_DAYS`; role not current transporter (or generator when none) → `EWB_EXTEND_ROLE` | EW-EXT |
| PC6 | `updateVehicle`, `updateTransporter`, `consolidated` (per EWB) | `validUpto?`, `status?` | `now > validUpto` → `EWB_VALIDITY_EXPIRED`; `status = "CNL"` → `EWB_CANCELLED` | EW-VEH, EW-TRN, EW-CEWB |

`role` ∈ `"generator" | "transporter" | "other-party"` and is the caller's statement; the client cannot know it.

## 11. Exports
- **Factory:** `createGspClient`, `createNicDirectProvider`.
- **Provider seams (types + NIC implementations):** `GspProvider`, `AuthStrategy`, `PayloadCodec`, `EnvelopeDecoder`, `EndpointSpec`, `OperationId`, `HeaderNameMap`, `NIC_EINVOICE_HEADERS`, `NIC_EWAYBILL_HEADERS`, `NIC_EINVOICE_HEADERS_JAVA_SAMPLE`, `NIC_DEFAULT_PATHS`, `nicAuthStrategy`, `nicPayloadCodec`, `nicEnvelopeDecoder`.
- **Crypto (for advanced callers and GSP adapters):** `generateAppKey`, `rsaEncryptLogin`, `decryptSek`, `aesEcbEncrypt`, `aesEcbDecrypt`, `encodePayload`, `decodePayload`, `decodeRekResponse`.
- **Sessions:** `SessionStore`, `createMemorySessionStore`.
- **Schemas/types:** `GspIssueSchema`, `GspErrorSchema`, `GspResult`, `GstinDetailsSchema`, `CancelIrnRequestSchema`, `EinvoiceDetailsSchema`, `GenerateIrnResponseSchema`, `EwbByIrnDetailsSchema`, `CancelEwbRequestSchema`, `RejectEwbRequestSchema`, `UpdateVehicleRequestSchema`, `ExtendValidityRequestSchema`, `ConsolidatedEwbRequestSchema`, `UpdateTransporterRequestSchema` and their response schemas, `ErrorCodeInfoSchema`.
- **Code lists:** `EINVOICE_CANCEL_REASONS`, `EWB_CANCEL_REASONS`, `EWB_VEHICLE_REASONS`, `EWB_EXTENSION_REASONS`, `EWB_CONSIGNMENT_STATUS`, `EWB_TRANSIT_TYPES`.
- **Helpers:** `normaliseGstinDetails`, `precheckCancelIrn`, `precheckIrnLookup`, `precheckCancelEwb`, `precheckRejectEwb`, `precheckExtendValidity`, `precheckEwbActive`, `parsePortalDateTime`, `describeErrorCode`.

## 12. Test list (Vitest; written first; **no network**)

A global setup stubs `globalThis.fetch` with a function that fails the test if called; every test injects a mock. The mock NIC server (`test/mock-nic.ts`) is a `fetch` implementation (no sockets) that holds a test RSA private key, decrypts logins, issues tokens/SEKs, tracks token lifetime with an injected clock, enforces the same-token rule and the 10-minute force-refresh window, records every request, and can be told to return each envelope variant in §7. Only GSTINs from `packages/fixtures/src/gstins.ts` are used.

### 12.1 Crypto
- `generateAppKey`: 32 bytes, Base64 length 44, uses the injected `randomBytes`.
- `rsaEncryptLogin` round-trip with a self-generated 2048-bit key pair (test-side `RSA_NO_PADDING` + manual PKCS#1 v1.5 unpad); two encryptions of the same input differ (random padding); input of `modulusBytes − 10` bytes → `rsa-input-too-large`; malformed PEM → `bad-public-key`.
- `buildLoginPlaintext` for both systems: exact JSON keys, `ForceRefreshAccessToken` boolean, Base64 vs raw per option.
- AES-256-ECB: fixed key/plaintext vectors (self-generated, asserted byte-for-byte against an independent test implementation); empty, 15-, 16-, 17-byte plaintexts; wrong key → `decrypt-failed`; non-Base64 input → `decrypt-failed`.
- `decryptSek`: correct 32-byte SEK; SEK that decrypts to 16 bytes → `bad-sek`.
- `encodePayload`/`decodePayload`: both forms round-trip; `decodePayload` detects each form; garbage → `bad-response-data`.
- `decodeRekResponse`: valid → JSON; tampered `data` → `hmac-mismatch`; tampered `hmac` → `hmac-mismatch`; `verifyHmac: false` → decoded with warning `HMAC_NOT_VERIFIED`; `rek` in the 44-char Base64 form → accepted and recorded.
- The package imports nothing but `node:crypto` for crypto (a test greps `src/` for other crypto imports).

### 12.2 Session
- First call logs in; second call within validity reuses (one login request recorded).
- Re-auth returning the same token keeps the original `expiresAt` (no extension), both with and without a later `TokenExpiry`; warning `TOKEN_EXPIRY_EXTENDED_IGNORED`.
- `TokenExpiry` parsed as IST; missing → assumed lifetime + warning.
- e-invoice refresh table (§5.3), each row with the injected clock: no `ForceRefreshAccessToken: true` before `E − 10 min`; `true` inside the window; `false` after expiry; proactive refresh failure falls back to cached + warning; `proactiveRefresh: false` uses cached.
- EWB: no refresh before `E − S`; inside the skew window the client sleeps (injected) until `E` and then logs in.
- 20 concurrent calls with no session ⇒ exactly one login; a failing login is delivered to all 20 and not cached; the next call logs in again.
- Sessions are per key: two GSTINs ⇒ two logins; two systems ⇒ two logins.
- `authErrorCodes`: a status-0 GET with such a code drops the session, re-logs in and retries once; a POST does not retry; without the option nothing is dropped.
- `invalidateSession` forces a login on the next call.
- A custom `SessionStore` receives `set`/`get`/`delete`; the serialised session has the documented shape.

### 12.3 Transport
- Default header names per system (§6.2), `sup_gstin` only when given, Java-sample preset, custom map.
- Path table: every default path and method; `{gstin}`/`{irn}` substitution; `getIrnByDocDetails` query encoding of `docNum` containing `/` and `-`; base URL with and without trailing `/` and the source path without leading `/` (I) all join to one `/`.
- `einvoice.generateIrn` without a configured path ⇒ `config` error `no-path`, nothing sent.
- Timeout via injected fetch that never resolves ⇒ `transport/timeout`; POST timeout ⇒ `outcome: "unknown"` and **one** request recorded; GET with `getRetries: 2` ⇒ 3 attempts with backoff via injected `sleep`; GET 4xx is not retried; caller `signal` abort ⇒ `transport/aborted`.
- Action strings sent trimmed; EWB body keys lower-case.

### 12.4 Redaction
For each error kind and each logger event: `JSON.stringify` contains none of: client secret, password, AppKey (bytes hex and Base64), token, SEK (Base64 and hex), `rek`, the RSA login blob. `String(config)`, `JSON.stringify(config)` and `util.inspect(config)` show `[REDACTED]`. Logger events never contain bodies.

### 12.5 Envelopes and errors
- `status` as `1`, `"1"`, `0`, `"0"`, `Status`/`status`, `Data`/`data`; `2` ⇒ `bad-envelope`; non-JSON body ⇒ `bad-json`; HTTP 500 with a status-0 envelope ⇒ `api` with `httpStatus 500`; HTTP 502 with HTML ⇒ `transport/http`.
- `ErrorDetails` as array, object, JSON string, Base64 JSON; garbage ⇒ `UNKNOWN` + raw.
- EWB `error.errorCodes` as number, string `"240"`, string `"240,241"`, Base64 JSON.
- `InfoDtls`, `alert`, `info`, `Alert` all land in `info`; unknown top-level key ⇒ `UNEXPECTED_KEY` warning.
- `describeErrorCode` with an empty and a caller-supplied table.

### 12.6 Operations (mock server; one happy path and one status-0 path each)
- e-invoice: login, getGstinDetails, syncGstinDetails, generateIrn (local validation error blocks, nothing sent; `skipLocalValidation` sends with a warning; success decodes the signed JWTs with `signatureVerified: false`), cancelIrn, getEinvoiceByIrn, getIrnByDocDetails, getEwbByIrn, generateEwbByIrn (reuses `@india-gst-kit/ewaybill`).
- EWB: login, generate (reuses `@india-gst-kit/ewaybill`), updateVehicle, cancel, extendValidity, consolidated, updateTransporter, reject, getGstinDetails (rek/hmac path).
- Every request the mock receives decrypts to exactly the JSON the serialiser should produce (exact numbers, JSON types per §8.2).

### 12.7 Schemas and conformance with the official samples (G7)
Each official decrypted "data" sample in `sources/` is run through the matching request schema (numbers read losslessly as strings), and the test asserts the **exact** outcome:
- EI-CNL sample: fails only on `CnlRsn "1 "`.
- EW-CNL, EW-REJ, EW-CEWB, EW-TRN samples: pass (string-vs-number differences disappear in memory; documented). EW-TRN's `transporterId` `29AKLPM8755F1Z2` passes only because transporter ids get no check digit; the test also asserts that it **fails** mod-36, so it is never used as a valid GSTIN anywhere else.
- EW-VEH sample: `UNEXPECTED_KEY` for `"transDocNo "` and `"transDocDate "`; otherwise passes.
- EW-EXT sample: passes (`transMode "5"`, `consignmentStatus "T"`, `transitType "R"`).
- Malformed-schema intents: vehicle update without `ewbNo` fails; extend without `transMode` fails; consolidated with a bad **second** item fails; transporter id with `|` fails; cancel IRN without `CnlRsn` fails.
- Cross-field rules: each road / rail / extend-consignment combination.
- Cancel reason codes: e-invoice `"2"` vs EWB `"2"` resolve to different named constants (GD1).
- Response samples (decrypted JSON in each source) parse with the documented warnings: EI-GSTIN sample is **invalid JSON** (`"DtDReg":2021-05-04"`), so its test fixes only that token and records it; EW-GSTIN sample lacks two commas — same treatment; EI-GET / EI-DOC / EI-EWBGET / EW-* response samples parse; `validUpto "21/05/2018 23:59:00 PM"` and `"17/09/2017 12.00:00 PM"` are kept as strings without throwing.

### 12.8 GSTIN details
- `normaliseGstinDetails` for EI (numbers) and EWB (strings) shapes ⇒ same normalised result for the same synthetic data.
- `isActive` true only for `ACT`; `"ACT "` (trailing space) ⇒ true after trim; `act` ⇒ false; `INA`, `PRO`, `CNL`, `null`, missing ⇒ false (+ warning for null/missing/unknown).
- `blockStatus`: `U`, `""`, `" "` ⇒ UNBLOCKED; `B` ⇒ BLOCKED; `null` ⇒ UNKNOWN.
- `target` GSTIN: bad pattern ⇒ validation error, nothing sent; bad check digit ⇒ sent with warning.

### 12.9 Pre-checks
Each of PC1–PC6 at the boundary (exactly 24 h / 72 h / ±8 h / 360 days: not warned) and one minute past it (warned), with the injected clock; both portal date formats; unparseable date ⇒ warning; missing context ⇒ no warnings; pre-check warnings never stop the request (mock records it).

### 12.10 Provider seam
A fake GSP provider (test-only: different base URL, extra header, passthrough codec, plain-JSON envelope) runs `getGstinDetails` and `cancelIrn` through the same core without NIC crypto.

## 13. Deviations and source contradictions (follow the sources, report)
- **GD1. Cancel reason codes 2 and 3 are swapped between the systems.** EI-CNL: 1 Duplicate, **2 Data entry mistake, 3 Order Cancelled**, 4 Others. EWB K1: 1 Duplicate, **2 Order Cancelled, 3 Data Entry mistake**, 4 Others. Kept per system; never translated (D-G14).
- **GD2. Header names (G4)**: underscore names on the e-invoice pages vs hyphen names in the e-invoice Java sample and on all EWB pages (and on EI-EWBCNL, an e-invoice page). Configurable (§6.2).
- **GD3. `status` type and key case**: `"Status": 1` (EI-AUTH success, EI-EWBGET, EI-SYNC), `"status":"0"` (errors), `"Status":"1"` (EI-GET). Tolerant decoding (§7.1).
- **GD4. Info field name**: `InfoDtls` (most e-invoice pages), `Alert` (EI-EWBGET sample), `alert`/`info` (EWB).
- **GD5. Error detail shape**: e-invoice "Base 64 encoded string … JSON array" vs inline fields (EI-AUTH) vs placeholders in every sample; EWB `{ "errorCodes": 240 }` vs EI-EWBCNL's "Base 64 encoded string". Tolerant (§7.2).
- **GD6. e-invoice GSTIN details**: `Status` is in the sample and FAQ but not in the attribute table; the sample JSON is invalid (`"DtDReg":2021-05-04"`, missing opening quote); `StateCode`/`AddrPncd` are numbers while EWB uses strings; `AddrBno` carries `"562160"` (a PIN-like value) in the sample.
- **GD7. EWB GSTIN details sample is invalid JSON** (missing commas after `"txpType":" "` and `"status":"ACT"`), and a stray `x` follows the error sample.
- **GD8. Sample `data` values are not ciphertext.** The EWB cancel/reject/consolidated/vehicle-update/generate samples' `data` strings are plain Base64 of the JSON (checked by decoding, 2026-10-17). Illustrative only; they cannot serve as crypto test vectors. Some even disagree with the decrypted sample shown (reject: `"ewbNo":"181000609270"` string in Base64, number in plain; cancel: `ewayBillNo` string vs number).
- **GD9. Envelope key case for EWB**: tables say `Action`/`Status`, samples use `action`/`status`. Samples followed.
- **GD10. Action strings with spaces** in samples: `"CANEWB "`, `" VEHEWB "`, `"REJEWB "`. Sent trimmed.
- **GD11. AppKey (EWB)**: "Any 32 character random unique id" vs a 44-character Base64 sample (`…+ ==`, itself containing a space). Same as e-invoice: 32 bytes, Base64 (D-G7, §15 V4).
- **GD12. SEK size (EWB)**: "a 32 bit random secure key generated using AES 256". AES-256 means a 32-**byte** key; we require 32 bytes.
- **GD13. Encryption notation**: EWB pages and EI-EWBCNL write `Encrypt(Base64(Request JSON), sek)` (encrypt the Base64 text); e-invoice pages write "encoded string of encrypted … JSON using Sek" (Base64 of the ciphertext of the JSON). Both forms supported, defaults per system (D-G6, §15 V5).
- **GD14. URL quirks**: `irnbydocdetails?doctype=/<Doc. Type>` (stray `/`); `<URL>api/einvewb/ewaybill` (no `/`); path prefixes are inconsistent across e-invoice pages (`/v1.04/auth`, `/eivital/v1.04/…`, `/api/…`, `/eiewb/v1.03/…`, `/irnbydocdetails`), which suggests different `<URL>` bases or gateway prefixes. Every path is configurable (§3.3, §15 V1).
- **GD15. Malformed draft-04 schemas (G7)**: cancel-IRN `required` inside `properties`; vehicle-update `vehicleType` outside `properties` and `ewbNo` not required; update-transporter `transporterId` outside `properties` and pattern with literal `|`; extend-validity requires `TransMode` (property is `transMode`); consolidated `items` in tuple form. Intent applied (§8.2, D-G17).
- **GD16. Schema vs data structure (EWB)**: `cancelRmrk` unlimited vs Text(50); `reasonCode` string(1) vs Number(1); `extnRemarks` string vs "Number … Refer Master"; consolidated `transMode` string enum 1–4 vs Number(3). Schema followed, except lengths (stricter applied).
- **GD17. Sample types vs schema**: `"ewbNo":"161000843009"` (string) and `"fromState":"29"` (string) vs number/integer; `"CnlRsn":"1 "`. We send the schema's type; the conformance tests record the sample failures.
- **GD18. Status value sets differ**: EI-GET `ACT`/`CNL`/`REJ`; EI-DOC and EI-EWBGET `ACT`/`CNL`; GSTIN `ACT`/`CNL`/`INA`/`PRO`. Unknown values are warnings.
- **GD19. Copy-paste text**: EI-CNL's validations mention "Get the RCM Invoice details"; EI-DOC's sample is titled "Get e-Waybill Details by IRN Response". No effect.
- **GD20. Response dates**: `"21/05/2018 23:59:00 PM"` (24-hour time with PM), `"12.00:00 PM"`, and a vehicle-update `validUpto` earlier than its `vehUpdDate`. Dates kept as strings; warnings only.
- **GD21. Capture date**: `sources/README.md` says the API pages were captured on **2026-10-18**, one day after this spec's date (2026-10-17) and two days after the other sources (2026-10-16). Probably a typo; the owner should confirm and correct it (no effect on behaviour). Retrieval dates in this spec and in §20 use the date the README states until corrected.
- **GD22. Crypto details partly rest on uncommitted evidence**: G2 cites the portals' Java sample code, which is not in `sources/`. The RSA padding and key format come only from G2's quote (§16 F4).
- **GD23. Pages list no `user_name` header for EWB** but list it for e-invoice; the EWB GSTIN header is `gstin` on H and `Gstin` elsewhere (case only; harmless).

## 14. Decisions (proposed; owner to approve. All UNVERIFIED; **Needs CA** where marked)
- **D-G1 Provider interface.** Core against `GspProvider` (§2); direct-NIC is the only v0.1 provider; GSP adapters later with their own docs. *Recommend: approve.*
- **D-G2 Result objects, not exceptions** for data/API/transport failures (§7.3), matching the other packages; throw only on programmer/config errors. *Recommend: approve.*
- **D-G3 Credentials by callback** per `(system, gstin)`; no env; public keys per system/environment from the caller. *Recommend: approve.*
- **D-G4 No default base URLs** (none in `sources/`); default paths are the sources' literals, overridable; `einvoice.generateIrn` has no default path until F1 is attached. *Recommend: approve.*
- **D-G5 Header names** default to the documented names per system; presets + custom map; settle on the first live call (V2). *Recommend: approve.*
- **D-G6 Plaintext forms.** Login: Base64(JSON) then RSA (both pages say so). Payloads: EWB `base64-json` (explicit notation), e-invoice `json` (its prose); responses decoded tolerantly and the detected form logged once. *Recommend: approve; revisit after V5.*
- **D-G7 AppKey** = 32 random bytes, Base64 (44 chars), for both systems; SEK key = the raw bytes. *Recommend: approve.*
- **D-G8 Portal timestamps are IST (UTC+05:30)** for `TokenExpiry` and all pre-check dates. *Recommend: approve; V7.*
- **D-G9 Refresh policy** per §5.3: e-invoice proactive `ForceRefreshAccessToken` only in the last 10 minutes (default on); EWB waits out the skew window and re-logs in after expiry. *Recommend: approve.*
- **D-G10 Same token on re-auth** never extends `expiresAt`; the newly returned SEK replaces the cached one. *Recommend: approve; V8.*
- **D-G11 Retries**: none for POST (including auth); GET opt-in, default 0; one GET retry after re-login for caller-listed auth error codes. *Recommend: approve.*
- **D-G12 HMAC** on the EWB `rek` path is verified by default and a mismatch fails the call; message = the Base64(JSON) text. `verifyHmac: false` exists for diagnosis only. *Recommend: approve; V9.*
- **D-G13 GSTIN lookup**: `isActive` only for exactly `ACT` (trimmed); `null` block status ⇒ `UNKNOWN`. **Needs CA** for any business meaning of `INA`/`PRO`/`B`; the client never decides taxability, ITC or whether to transact.
- **D-G14 Cancel reason codes per system** (GD1); separate named constant sets; no cross-mapping. **Needs CA** (meaning of codes).
- **D-G15 Time limits** (§10): hours from the portal timestamp in IST; "within three days" = 72 h; boundaries inclusive; warnings only. **Needs CA** (legal reading of "24 hours", "three days", "8 hours before/after", "360 days").
- **D-G16 Local validation blocks on errors** (reused einvoice/ewaybill validators and our schemas); `skipLocalValidation: true` sends anyway with warning `LOCAL_VALIDATION_SKIPPED`, so a lagging local rule never bricks a user. *Recommend: approve.*
- **D-G17 Malformed schemas**: apply evident intent (GD15) — `ewbNo` required for vehicle update, `transMode` (not `TransMode`) required for extend, every consolidated item validated, anchored transporter pattern, cancel-IRN `Irn`/`CnlRsn` required. *Recommend: approve.*
- **D-G18 Numbers**: strings in memory; wire JSON type per source schema (numbers for `ewbNo`, `fromState`, …); responses accept number or string. *Recommend: approve; V14.*
- **D-G19 GSTIN arguments**: pattern + state code block; mod-36 failure warns only. *Recommend: approve.*
- **D-G20 Error codes as data**: no shipped table in v0.1; `authErrorCodes` caller-supplied; the official list added later from F2 as its own sourced file. *Recommend: approve.*
- **D-G21 Session store** injectable, in-memory default, documented as secret-bearing. *Recommend: approve.*
- **D-G22 e-invoice "Cancel EWB" (sandbox only)** is not implemented; EWB cancel goes through the EWB system (EI-EWBCNL says so for production). *Recommend: approve.*
- **D-G23 Generate IRN response** is provisional (shape of `EinvoiceDetails`) until F1 is attached; unknown keys warn. *Recommend: approve, and attach F1 before the build if possible.*
- **D-G24 Dependencies**: `model`, `einvoice`, `ewaybill` (`workspace:^`); no new runtime dependency; `node:crypto` + injectable `fetch`. *Recommend: approve.*
- **D-G25 Logging**: optional hook, metadata only, redacted, no bodies. *Recommend: approve.*
- **D-G26 Injectable clock, sleep and randomBytes** for deterministic tests. *Recommend: approve.*
- **D-G27 Cross-field transport rules** (road ⇒ vehicle number; rail/air/ship ⇒ transport document; extend's `consignmentStatus`/`transitType`) are **errors** (deterministic payload rules from the validations, like ewaybill V-T rules), unlike the time limits, which only warn. *Recommend: approve.*

## 15. Verify on first live call (sandbox checklist)
Run with the sandbox credentials and the downloaded public keys; record each answer in `docs/specs/gsp.md` and, if a default changes, in a changeset.
- **V1** Base URLs and every path in §3.3 (including whether e-invoice paths share one base; the generate-IRN path).
- **V2** Header names: underscore (`client_id`) vs hyphen (`client-id`) on the e-invoice system; which one the sandbox accepts, for auth and for an authenticated call.
- **V3** Login: RSA key size and format (SPKI PEM vs certificate); RSA plaintext = Base64(JSON) vs raw JSON; `ForceRefreshAccessToken` boolean accepted.
- **V4** EWB `app_key`: 32 raw bytes (Base64) works; SEK decrypt key = raw AppKey bytes for both systems.
- **V5** Payload plaintext form per system (`json` vs `base64-json`) for requests; the form detected in responses.
- **V6** Sandbox token lifetime (60 min e-invoice per EI-AUTH; EWB unknown).
- **V7** `TokenExpiry` time zone (compare with the login time).
- **V8** Re-auth within validity: same token? same SEK? `TokenExpiry` unchanged? `ForceRefreshAccessToken: true` outside the last 10 minutes: error or ignored?
- **V9** EWB `rek` path: is the decrypted `rek` 32 raw bytes or Base64 text; what exactly the HMAC covers.
- **V10** Error envelope shapes: e-invoice `ErrorDetails` (array / Base64 / string), EWB `error.errorCodes` (number, comma string, Base64); the HTTP status on errors.
- **V11** The error codes for invalid/expired token on each system (to populate `authErrorCodes` guidance).
- **V12** EWB `GetGSTINDetails` query parameter name.
- **V13** `irnbydocdetails` `docdate` format and parameter case.
- **V14** Whether numeric fields sent as JSON strings are rejected (confirms D-G18).
- **V15** `sup_gstin`: required for e-commerce operators only; ignored otherwise.
- **V16** Whether `TransMode` (capital) is also accepted on extend validity.

## 16. Files to attach (not in `sources/`)
- **F1** e-invoice **Generate IRN** API page: https://einv-apisandbox.nic.in/version1.03/generate-irn.html sections `#overview`, `#requestPayload`, `#responsePayload`, `#responseSampleJSON` (URL path, envelope, response fields). Only the schema and validations are captured. *Needed before `generateIrn` can have a default path and a non-provisional response schema.*
- **F2** **Error-code lists**: `api-error-codes-list.html` from einv-apisandbox.nic.in and from docs.ewaybillgst.gov.in/apidocs (G9). *Needed for the code table and for `authErrorCodes` guidance; not blocking v0.1.*
- **F3** **API base URLs** (sandbox and production) for both systems, from an official page (e.g. the e-invoice and EWB API onboarding / "API URLs" pages). *Not blocking: the caller passes base URLs; needed for documentation defaults.*
- **F4** The portals' **Java (or .NET) sample encryption code** cited in G2, as file:line excerpts like `sources/gstr1/offline-tool/code-excerpts.md` (license permitting; no AGPL/GPL). *Needed to settle V3/V5/V9 without a live call.*
- **F5** The e-invoice **onboarding** and EWB **pre-requisites** pages quoted in G1. *Not blocking.*
- **F6** e-invoice sandbox **release notes** (source of G9's 2150/2295 statement). *Not blocking.*
- **F7** For each future GSP adapter: that GSP's API documentation (base URLs, headers, auth). *Later track.*
- Not to be committed: NIC public keys (G3; the caller supplies them at runtime), any credential, token or SEK.

## 17. Changeset plan
- **Build PR:** `.changeset/gsp-initial.md` — `"@india-gst-kit/gsp": minor` — "Initial release: NIC e-invoice and e-way bill API client with provider interface, node:crypto login/SEK/AES-ECB/rek-HMAC, session cache, typed errors, GSTIN lookup, and v0.1 operations." `packages/gsp/package.json` (published, `engines.node >=22`, `files: ["dist"]`, same scripts as `einvoice`), `tsconfig*.json`, README replacing "Planned".
- No changes to `model`, `einvoice` or `ewaybill` are expected. If the build finds a missing export (e.g. a response schema), it is added in the same PR with its own `patch` changeset for that package.
- This spec PR: no changeset (docs only).

## 18. Deferred
GSP adapters (F7); signature verification of signed JWTs (needs NIC key, einvoice §8.4); official error-code table (F2); other EWB/e-invoice APIs (get EWB details, by date, multi-vehicle, regenerate consolidated, TRANSIN, HSN, B2C QR); e-invoice cancel-EWB (sandbox only, D-G22); automatic idempotency reconciliation after an unknown POST outcome; persistent session store implementations; rate limiting (no limits are in `sources/`).

## 19. Stop conditions
As in CLAUDE.md. Specific to this package:
- The reason-code and status lists in §8.2/§10 are official lists the package **enforces**: each in its own file with `Source`/`Retrieved`/`Status` header and a legal-facts row; if a source file is missing at build time, stop.
- If a crypto detail cannot be implemented without a source beyond G2 and the pages (e.g. a test needs a real NIC vector), stop and ask for F4; never use a real key or credential.
- Never use the sources' sample GSTINs (`29AKLPM8755F1Z2`, `29BQSPA3829E1Z0`, `29xxxxxxxx`) as valid data; fixtures use `packages/fixtures/src/gstins.ts` only.
- If `pnpm check` cannot be made green without weakening lint/strictness (e.g. `fetch`/`KeyObject` typing), stop and report.
- Any test that would touch the network is a bug: stop and fix the mock.

## 20. `docs/legal-facts.md` rows to add (at build time)
Each row: source URL (the page in the Sources table at the top, under https://einv-apisandbox.nic.in/ or https://docs.ewaybillgst.gov.in/apidocs/), retrieved as stated in `sources/README.md` (GD21), status UNVERIFIED — needs CA. Files under `packages/gsp/src/`.
- e-invoice cancel reasons 1–4 (`codes/einvoice-cancel-reasons.ts`, EI-CNL).
- EWB cancel reasons 1–4 (`codes/ewb-cancel-reasons.ts`, K1) and the 2/3 swap vs e-invoice (GD1).
- EWB vehicle-update reasons 1–4 (`codes/ewb-vehicle-reasons.ts`, K1).
- EWB extension reasons 1, 2, 4, 5, 99 (`codes/ewb-extension-reasons.ts`, K1).
- Consignment status M/T and transit type R/W/O with the transMode rule (`codes/ewb-consignment.ts`, K1, EW-EXT).
- Transport-mode cross-field rules for vehicle update / consolidated / extend (EW-VEH, EW-CEWB, EW-EXT).
- Time limits PC1–PC6 (`precheck.ts`; EI-CNL, EI-GET, EI-DOC, EW-CNL, EW-REJ, EW-EXT, EW-VEH, EW-TRN, EW-CEWB), "warning only".
- GSTIN status values and "active only if ACT"; block status U/''/B (`gstin-details.ts`; EI-GSTIN, EI-SYNC, EW-GSTIN).
- Token lifetime 360 min (60 sandbox), same-token rule, 10-minute force-refresh window (`session.ts`; EI-AUTH, EW-AUTH).
- Decisions D-G8, D-G13, D-G14, D-G15, one row each, "Design decision" (D-G13–D-G15 also "needs CA").
