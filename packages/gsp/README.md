# @india-gst-kit/gsp

Client for the NIC **e-invoice (IRP)** and **e-way bill** APIs (India). Spec: [`docs/specs/gsp.md`](../../docs/specs/gsp.md).

> **Every API fact here is UNVERIFIED until the first live sandbox call** (spec §15), and every legal fact is
> UNVERIFIED — needs CA (`docs/legal-facts.md`). This is not tax advice. The client reports what the portal says; it
> never decides taxability, ITC or whether to transact.

- Provider interface: the same core works direct-to-NIC (`createNicDirectProvider`) or, later, through a GSP adapter.
- `node:crypto` only: RSA PKCS#1 v1.5 login, AppKey, SEK, AES-ECB payloads, the e-way bill `rek` + HMAC path.
- Sessions cached per GSTIN; the same token on re-auth is never extended; forced refresh only in the last 10 minutes; one login in flight.
- Injectable `fetch`, clock, sleep, random source and session store. Nothing is read from the environment.
- Every operation returns a `GspResult` (`ok` + `value`, or `error` of kind `validation` / `auth` / `api` / `transport` / `protocol` / `crypto` / `config`). Secrets are redacted from errors and logs.

```ts
import { createGspClient, createNicDirectProvider, Secret } from "@india-gst-kit/gsp";

const client = createGspClient({
  provider: createNicDirectProvider({
    // No defaults exist: no official base URL is in sources/ (spec D-G4). Use your sandbox/production URLs.
    baseUrls: { einvoice: "https://<e-invoice host>", ewaybill: "https://<e-way bill host>" },
    tokenLifetimeMinutes: { einvoice: 60 }, // sandbox
  }),
  credentials: async ({ system, gstin }) => ({
    clientId: "…",
    clientSecret: new Secret("…"),
    username: "…",
    password: new Secret("…"),
    publicKey: "-----BEGIN PUBLIC KEY-----…", // downloaded from the portal after login (G3)
  }),
});

const r = await client.einvoice.generateIrn({ gstin, request: irnRequest });
if (!r.ok && r.error.kind === "transport" && r.error.outcome === "unknown") {
  // The request may have reached the IRP. POSTs are never retried: reconcile first.
  await client.einvoice.getIrnByDocDetails({
    gstin,
    docType: "INV",
    docNum: "…",
    docDate: "DD/MM/YYYY",
  });
}
```

### Error codes

Every `api` error entry is described by [`@india-gst-kit/errors`](../errors): besides the `code` and the `message`
the portal returned, it carries `system`, `list`, `category` (the library's, not official), `officialMessage` (from
the official list) and `userMessage` (plain English, ours). `summarizeGspError(error)` gives one category and message
for any `GspError`, leading with the most important entry:

```ts
import { summarizeGspError, SESSION_ERROR_CODES } from "@india-gst-kit/gsp";

const r = await client.einvoice.generateIrn({ gstin, request: irnRequest });
if (!r.ok) {
  const s = summarizeGspError(r.error);
  if (s.category === "already-done" || s.category === "outcome-unknown") {
    // fetch the existing IRN (getIrnByDocDetails) instead of sending again
  }
  show(s.userMessage, s.entries); // official text and code one click away
}

// opt in to a re-login on the token codes (unverified until a live call):
createGspClient({ /* … */ authErrorCodes: SESSION_ERROR_CODES });
```

`describeErrorCode`, `ErrorCodeInfoSchema` and the `errorCodeTable` option are **deprecated** (kept for one minor
version); a table passed as `errorCodeTable` still overrides `officialMessage`.

Before the first live call, work through the checklist in spec §15 (header names, paths, plaintext forms, AppKey
size, time zone, error shapes). Tests run only against an in-process mock (`test/mock-nic.ts`) with keys generated
inside the test run.
