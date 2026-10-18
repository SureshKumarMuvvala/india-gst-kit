# Spec — `@india-gst-kit/errors` (v0.1, Track H)

Status: **draft 2026-10-18, owner to review** (decisions D-E1–D-E14, §13). Phase 1: spec only, no code. Every official text here is **UNVERIFIED — needs CA** until a chartered accountant signs it off in `docs/legal-facts.md`. Every API behaviour is also **UNVERIFIED until the first live sandbox call** (gsp §15). The **categories** (§6), the **plain-language messages** (§7) and the per-op list order (§5.2) are **our library design, not official**; they are labelled so everywhere they appear, including in code.

Sources (all under `sources/`; provenance and findings X1–X8 in `sources/errors/README.md`):

| Id | File | Page | Rows | Columns |
|---|---|---|---|---|
| **ER-VITAL** | `errors/einvoice-error-codes-VITAL.json` | https://einvoice1.gst.gov.in/others/geterrorcodes/VITAL (auth, user, GSTIN) | 42 | code, message, reason, resolution |
| **ER-INV** | `errors/einvoice-error-codes-INV.json` | https://einvoice1.gst.gov.in/others/geterrorcodes/INV (IRN generate, cancel, get) | 116 | code, message, reason, resolution |
| **ER-EWB** | `errors/einvoice-error-codes-EWB.json` | https://einvoice1.gst.gov.in/others/geterrorcodes/EWB (e-way bill through the IRP) | 77 | code, message |
| **ER-API** | `errors/ewaybill-api-error-codes.json` | https://docs.ewaybillgst.gov.in/apidocs/api-error-codes-list.html (e-way bill system API) | 373 | code, description |
| **GSP** | `docs/specs/gsp.md` | §7 (envelopes, `GspError`), §7.4 + D-G20 (error codes as data), V10/V11, F2 | — | — |
| **API pages** | `sources/einvoice/api/*.txt`, `sources/ewaybill/api/*.txt` | error envelope shapes: e-invoice `ErrorDetails` `{ ErrorCode, ErrorMessage }`; e-way bill `error.errorCodes` (codes only) | — | — |

All four lists were retrieved **2026-10-18**; their SHA-256 sums are in `sources/errors/SHA256SUMS` (all four verified `OK` when this spec was written). Total: **608 rows**, every one assigned a category in Appendix A. Nothing in this spec is filled from memory: no code, message or meaning appears here that is not in those four files. F2 of the gsp spec ("error-code lists not captured") is now **resolved** by these files.

## 1. Purpose and scope

- **Goal:** turn a government error code into something an app can **show** (plain English plus the official text) and **act on** (one category per code, telling the app what kind of next step makes sense).
- **In scope (v0.1):**
  - the four official lists as **generated, verbatim** TypeScript data (§4), with a regeneration script and a conformance test;
  - `describeError(system, code, options?)` — lookup keyed by system + list + code, safe placeholder filling, unknown-code handling (§5);
  - **our** category per code (§6) and **our** short user message per category, with a few per-code overrides (§7);
  - the integration contract for `@india-gst-kit/gsp` (§8) and constants for session-error codes (X4).
- **Out of scope / never:**
  - legal advice, tax advice, or any statement of what the law requires; deciding taxability, the applicable rate, ITC, or whether a business may transact with a GSTIN;
  - **suggesting a tax rate** — the resolution text of INV 2240 lists rates and is **not a rate list** (X7, §7.3);
  - calling any API, retrying anything, or changing a session (that stays in `gsp`; this package is pure data + pure functions);
  - error codes from systems other than the e-invoice IRP and the e-way bill system (GSTN return APIs, GSP-specific codes) — deferred (§15);
  - translations into other languages (deferred; the structure allows them, §7.5).

## 2. Where it lives — new package `@india-gst-kit/errors` (D-E1)

**Recommendation: a new published package `@india-gst-kit/errors`**, not a `gsp` subpath.

| | New package `@india-gst-kit/errors` | `@india-gst-kit/gsp/errors` subpath |
|---|---|---|
| Usable without `gsp` | **yes** — an app that reaches NIC through a third-party GSP SDK still receives NIC codes and wants the same texts; so does a back office that only stores codes from logs | needs `gsp` installed (and its `model`/`einvoice`/`ewaybill` dependencies) just to read a table |
| Dependencies | `zod` (peer) only; no `model`, no `node:crypto` → also usable in a browser bundle | inherits `gsp`'s Node-only surface |
| Release cadence | the portals revise these lists independently of the API; a list update is an `errors` patch/minor without touching the client | every list update bumps the client |
| Size | ~60 KB of text kept out of `gsp` for callers who never show messages | always shipped |
| Cost | one more package (package.json, tsconfig, README, changeset) | none |

`gsp` then **depends on** `@india-gst-kit/errors` (`workspace:^`) and decorates its `api` errors (§8). The dependency points one way only: `errors` never imports `gsp`. The `System` enum (`"einvoice" | "ewaybill"`) is defined in `errors` with the same literals as `gsp`'s `SystemSchema`; a type-level test asserts they stay equal (T-I3). `gsp` keeps its own `SystemSchema` (no breaking change).

**How this changes D-G20** (gsp spec §7.4, §14). D-G20 said: "no shipped table in v0.1; `authErrorCodes` caller-supplied; the official list added later from F2 as its own sourced file". F2 is now captured, so the "later" has arrived. Proposed amendment (to be written into gsp.md §7.4/§14 in the **build** PR, not this one):

- **D-G20 (amended):** the official tables ship in `@india-gst-kit/errors`, each as its own generated, sourced file with a `Source`/`Retrieved`/`Status` header and a legal-facts row — which is exactly what D-G20 required of "a later build". `gsp` attaches `describeError` results to every `api` error entry (§8.1).
- `authErrorCodes` **stays caller-supplied with an empty default** (X4 is "still to be confirmed on a live call", gsp V11). `errors` exports `SESSION_ERROR_CODES` (§8.3) so a caller can opt in with one line. Flip the default only after V11 is answered (D-E10).
- `describeErrorCode(system, code, table)` and `ErrorCodeInfoSchema` in `gsp` stay for one minor version as **deprecated** wrappers (a caller-supplied table still wins over the official one, so nothing that works today changes), then are removed in a later minor with a changeset note (D-E11).
- gsp §7.4's sentence "Codes named in `sources/` … are **not** given meanings in code" is replaced by: "meanings come only from `@india-gst-kit/errors`, whose data is generated from `sources/errors/`".

## 3. Package rules

ESM only, named exports only, Zod 4 (peer `^4.0.0`, dev `4.5.4`), types are `z.infer` of schemas, `z.strictObject` for every object schema. No runtime dependency besides the `zod` peer. `engines.node >=22`, `files: ["dist"]`, scripts as in `einvoice` (`build`, `typecheck`, `test`). Pure functions; nothing throws on data (an unknown code is a normal result, §5.4); functions throw only on programmer errors (a `system` outside the enum, `params` not an array of strings) — and those are caught by the types first.

## 4. Data — generated, verbatim, one file per list

### 4.1 Keys (X1, X2, X3)

- A row's identity is **`(system, list, code)`**:
  - `system`: `"einvoice"` (IRP) or `"ewaybill"` (e-way bill system). Different systems, different code spaces: an e-way bill code is **never** looked up in an e-invoice list or the reverse (X2).
  - `list`: `"VITAL" | "INV" | "EWB"` for `einvoice` (the portal's own path segments), `"API"` for `ewaybill`. The pair is checked: `ewaybill` has only `"API"`, `einvoice` never has `"API"` (`ErrorListIdSchema` is a discriminated pair, T-D7).
  - `code`: the official code **string as published**, e.g. `"2150"`, `"_3109"`. Not a number: `_3109` is not numeric (X3), and strings avoid any `"0105"`/`105` question.
- Codes repeat across e-invoice lists (X1): `3029`, `3074`–`3079`, `5001` are in VITAL **and** INV; `4001` in INV **and** EWB, sometimes with different wording. Each list keeps its own row; nothing is merged or de-duplicated. §5.2 says how a lookup picks one.
- `_3109` is its own code. A returned `"3109"` does **not** match `_3109` (no code appears as `3109` in any list, so it would be `unknown`; reported in §12 E3).

### 4.2 Files

Generated under `packages/errors/src/data/`, one per source file, never edited by hand:

| File | Export | From | Rows |
|---|---|---|---|
| `einvoice-vital.ts` | `EINVOICE_VITAL_ERRORS` | ER-VITAL | 42 |
| `einvoice-inv.ts` | `EINVOICE_INV_ERRORS` | ER-INV | 116 |
| `einvoice-ewb.ts` | `EINVOICE_EWB_ERRORS` | ER-EWB | 77 |
| `ewaybill-api.ts` | `EWAYBILL_API_ERRORS` | ER-API | 373 |

Each file starts with the CLAUDE.md header plus the generator line and the source checksum:

```ts
// Source: https://einvoice1.gst.gov.in/others/geterrorcodes/INV — sources/errors/einvoice-error-codes-INV.json
// Retrieved: 2026-10-18
// Status: UNVERIFIED — needs CA
// GENERATED by scripts/gen-error-data.mjs from the file above (sha256 cd665b24…8c64) — do not edit by hand.
// Text is verbatim, including the portal's spelling mistakes (e.g. "Messege", "registerd", "Inavalid").
export const EINVOICE_INV_ERRORS = [
  { code: "2143", message: "Invoice does not belongs to the user GSTIN", reason: "User is attempting …", resolution: "Certain operations …" },
  …
] as const satisfies readonly OfficialErrorRow[];
```

- **Row shape** `OfficialErrorRowSchema = z.strictObject({ code: z.string().min(1), message: z.string().min(1), reason: z.string().min(1).optional(), resolution: z.string().min(1).optional() })`.
  - ER-VITAL/ER-INV columns map to `code, message, reason, resolution`; ER-EWB `code, message`; ER-API `code, description → message`.
  - An **empty cell** (`""`) means "the portal published no text": the key is **omitted**, never stored as `""`. This is the only transformation; every non-empty cell is copied **byte for byte** (the capture already normalised whitespace, see `sources/errors/README.md`). No trimming, no spelling fixes, no Unicode normalisation (the curly quotes in e.g. INV 2143 "other’s" stay).
- Row order = source order (the portal's order; it is not always numeric, e.g. `_3109` first in VITAL).
- **Prettier:** the four data files are added to `.prettierignore` (as `gstr3b/src/autocalc-shape.ts` is), so formatting never alters generated text; the generator itself writes stable output (one row per line, `JSON.stringify` for every string).
- Source/retrieved metadata is also exported as data: `ERROR_LIST_SOURCES: Record<ListKey, { url, file, retrieved: "2026-10-18", sha256, status: "UNVERIFIED — needs CA" }>`, so `describeError` can return provenance (§5.1).

### 4.3 Generator — `packages/errors/scripts/gen-error-data.mjs`

Run: `node packages/errors/scripts/gen-error-data.mjs` (from the repo root or anywhere; paths are resolved from `import.meta.url`, as `gen-autocalc-shape.mjs` does). It:

1. reads `sources/errors/SHA256SUMS` and **refuses** to run if any of the four files' SHA-256 differs (a changed capture must come with a new checksum and a new `Retrieved` date — §14 stop condition);
2. parses each file as a JSON array of arrays; **refuses** if the header row is not exactly the expected one (`["Error Code","Error Messege","Reason for Error","Resolution"]` for VITAL/INV, `["Error Code","Error Messege"]` for EWB, `["Error Code","Error Description"]` for API — all three confirmed against the files when this spec was written), if any row has a different column count, if a code is empty, or if a code repeats **within** one list;
3. writes the four data files (header with URL, retrieved date, status, sha256) and `src/data/sources.ts` (`ERROR_LIST_SOURCES`);
4. never touches `src/categories.ts` or `src/messages.ts` (ours, hand-written, §6/§7).

The script is plain Node ESM with no dependencies, so it runs before `pnpm install` if needed. It is **not** run by `pnpm check`; the test below catches drift.

### 4.4 Conformance test (T-D1–T-D8)

`test/data-conformance.test.ts` re-reads `sources/errors/*.json` (paths relative to the test file), verifies `SHA256SUMS`, rebuilds the expected rows with the same mapping, and asserts **deep equality** with the exported arrays (count, order, every string). It also imports the generator's pure `render()` function and asserts the generated **file text** equals the committed file byte for byte, so a hand edit of a data file fails the gate.

## 5. Lookup — `describeError`

### 5.1 Signature and result

```ts
describeError(
  system: "einvoice" | "ewaybill",
  code: string,
  options?: {
    list?: ErrorListId;          // exact list, e.g. "INV"; must belong to `system`
    op?: string;                 // a gsp OperationId such as "einvoice.generateIrn" → list order (§5.2)
    params?: readonly string[];  // values for {0}, {1}, … (§5.3)
    returnedMessage?: string;    // the message the API actually returned, if any (e-invoice ErrorMessage)
  },
): ErrorDescription
```

`ErrorDescriptionSchema` (`z.strictObject`; `ErrorDescription = z.infer<…>`):

| Field | Type | Meaning |
|---|---|---|
| `system` | `"einvoice" \| "ewaybill"` | as passed |
| `list` | `ErrorListId \| null` | the list the row came from; `null` when unknown |
| `code` | `string` | the code after trimming ASCII whitespace (`" 2150 "` → `"2150"`); nothing else is normalised |
| `known` | `boolean` | `true` when a row was found |
| `category` | `ErrorCategory` | §6 — **ours** |
| `officialMessage` | `string \| null` | official message with placeholders filled (§5.3); `null` when unknown |
| `officialMessageTemplate` | `string \| null` | the verbatim official message, placeholders untouched |
| `officialReason` | `string \| null` | verbatim reason (ER-VITAL/ER-INV only), placeholders filled |
| `officialResolution` | `string \| null` | verbatim resolution (ER-VITAL/ER-INV only), placeholders filled |
| `returnedMessage` | `string \| null` | `options.returnedMessage`, sanitised (§5.3) but otherwise as received; this is the most specific text when the portal sends one (e-invoice `ErrorMessage` usually has its placeholders already filled) |
| `userMessage` | `string` | **our** plain-English text (§7), placeholders filled |
| `userMessageSource` | `"category" \| "code"` | whether the text is the category default or a per-code override (§7.2) |
| `otherLists` | `{ list, officialMessage }[]` | other lists of the same system that carry the same code (X1), so a UI can show "also listed as …" — empty for most codes |
| `notes` | `ErrorNote[]` | machine flags: `"X1-in-other-lists"`, `"X3-underscore-code"`, `"X7-not-a-rate-list"`, `"X8-malformed-placeholder"`, `"missing-params"`, `"list-guessed"` (no `list`/`op` and the code is in more than one list) |
| `source` | `{ url, retrieved, status } \| null` | provenance of the row; `null` when unknown |

`describeErrors(system, entries, options?)` maps a list of `{ code, message? }` (gsp's `ApiErrorEntry` shape) to descriptions, passing each entry's `message` as `returnedMessage`. `primaryError(descriptions)` picks the one to lead with (§6.3).

### 5.2 Choosing the list (X1)

- `options.list` given → look only there. A list that does not belong to `system` is a programmer error (type error; runtime `TypeError`).
- Otherwise, the candidate lists for `system` are tried **in order** and the first hit wins; the other hits go to `otherLists`. The order (**ours**, D-E4) comes from `options.op`:

| `op` (gsp `OperationId`) | e-invoice list order |
|---|---|
| `einvoice.auth`, `einvoice.getGstinDetails`, `einvoice.syncGstinDetails` | VITAL → INV → EWB |
| `einvoice.generateIrn`, `einvoice.cancelIrn`, `einvoice.getEinvoiceByIrn`, `einvoice.getIrnByDocDetails` | INV → VITAL → EWB |
| `einvoice.getEwbByIrn`, `einvoice.generateEwbByIrn` | EWB → INV → VITAL |
| no `op`, or an `op` not in this table | INV → VITAL → EWB, and note `"list-guessed"` if the code is in more than one list |

  `ewaybill` has one list; `op` only matters for e-invoice. Rationale: the VITAL page is "auth, user, GSTIN", INV is "IRN generation, cancel, get", EWB is "e-way bill through the IRP" (`sources/errors/README.md`); the remaining lists follow because a generate call also runs the GSTIN checks (VITAL `3029`, `3074`–`3079`).
- Why it matters: of the nine X1 codes, only **`5001`** gets a different category by list (VITAL `retry-later`; INV `fix-data`, because INV's reason/resolution say "not as per the published schema … check the data against the published schema"). The other eight have the same category in both lists (Appendix A), so a wrong guess changes only the wording.

### 5.3 Placeholders, filled safely (X8)

The lists use positional placeholders `{0}`, `{1}`, `{2}` (ER-INV 3038/3039 use `{1}`/`{2}` with `{0}` in a different position). One is malformed: ER-EWB 4074 "…transaction type `{0)`".

- **Recognised token:** exactly `{` + one or more ASCII digits + `}` (`/\{(\d+)\}/g`). Nothing else is a placeholder; `{0)` is **literal text** (the data stays verbatim; D-E6). 4074 gets note `"X8-malformed-placeholder"` and a per-code user message that needs no parameter (§7.2).
- **Single pass:** the template is scanned once; replacement text is never scanned again, so a value containing `{1}` stays literally `{1}` (no injection, no recursion).
- **Value sanitising** (each `params[i]` and `returnedMessage`): collapse every run of whitespace (including tab and newline) to one space; remove the remaining C0/C1 control characters (U+0000–U+001F, U+007F–U+009F) and the bidi controls U+200E, U+200F, U+202A–U+202E, U+2066–U+2069; trim; cut to **100** characters (params) / **500** (`returnedMessage`) and append `…` when cut. No HTML escaping: every result is **plain text**, and the README says the app must escape it when rendering HTML (the official texts contain quotes and apostrophes).
- **Missing params:** a placeholder whose index has no value stays as the literal `{n}` in `officialMessage` and the result gets note `"missing-params"`; `userMessage` never shows a raw `{n}` — a per-code override that needs a missing value falls back to the category text. Extra params are ignored.
- Placeholders are filled the same way in `officialReason`/`officialResolution` (no reason/resolution cell contains one today — checked; the code does not rely on that).
- The e-way bill system returns **codes only** (gsp §7.2), so for `ewaybill` there are never params from the API; the e-invoice API returns `ErrorMessage` with the values already in it, which is why `returnedMessage` exists. Params are for callers who know the values (e.g. a line number from their own validation).

### 5.4 Unknown codes

A code not in any candidate list (including gsp's synthetic `"UNKNOWN"` from an unrecognised envelope, gsp §7.2):

- `known: false`, `list: null`, `category: "unknown"`, `officialMessage`/`Template`/`Reason`/`Resolution`: `null`, `source: null`, `otherLists: []`;
- `userMessage`: the `unknown` category text (§7.1), which does **not** guess a meaning;
- `returnedMessage` is still passed through (sanitised) — for e-invoice it is then the only text, and the UI should show it;
- an empty or whitespace-only code is `unknown` too (never a throw).
- A code that exists only in the **other** system's lists is still `unknown` (X2); the result does **not** say "did you mean …".

## 6. Categories — **our design, not official** (D-E2, D-E3)

### 6.1 Definitions

Every listed code has **exactly one** category. Categories describe **what kind of next step makes sense for an app**, not what the law says. They are assigned by us from the official message (and reason/resolution where published) and are listed per code in Appendix A for the owner to review. Code and docs label them "library classification, not official".

| Category | Meaning (ours) | What an app should do |
|---|---|---|
| `fix-data` | A value in the request is missing, malformed for its field, inconsistent with another value, or not accepted by a portal rule. | Show the message next to the document; let the user correct it; resend. |
| `gstin-status` | The portal reports a GSTIN in the request as inactive, cancelled, blocked (e.g. returns not filed), not enabled for e-invoicing, or of a type the operation does not accept. | Show which GSTIN; suggest checking its status on the GST portal (for e-invoice, the official resolution of 3028/3029 names the "Sync GSTIN from GST CP" API). Never conclude anything about the business relationship. |
| `not-allowed` | The portal will not do this action for this document or user in its current state: a time limit has passed, the document is cancelled/closed/expired/verified, the user is not the owner or assigned party, the document was made on another system (NIC1/NIC2), or the action does not apply to this kind of document. | Do **not** resend unchanged. Explain; offer the alternative the official text names, if any. |
| `already-done` | The portal already holds the result this request would create (X5) or the change is already in effect. | **Fetch, don't retry**: e.g. `getIrnByDocDetails` / `getEwbByIrn`; store the result. |
| `not-found` | The record asked for is not on the portal (or not available to this user for this request). | Check the number/date; after an unknown POST outcome, this is the signal that the earlier POST did not create the record. |
| `auth` | Login, credentials, token, client id/secret, keys, or user↔GSTIN/client mapping. | Re-login for an expired token (X4, §8.3); otherwise an admin must fix the API credentials. Not a data problem. |
| `throttled` | The portal is limiting or blocking requests (X6), including a duplicate request in flight (813). | Stop sending; wait; for 813 check whether the first request succeeded before resending. Never auto-retry in a loop. |
| `retry-later` | A temporary portal-side failure ("try after some time", "could not retrieve", "error while …") with no data fix implied. | Allow a later retry. For a POST (generate/cancel/…), first check whether it took effect (gsp §6.3). |
| `contact-helpdesk` | The official message itself says to contact the helpdesk and names no other action. | Show the code and the time; offer to copy the details. |
| `integration` | The request is not in the shape the API expects (invalid JSON, missing header, schema version, date format, empty payload): a fault in the calling software, not in the user's data. | Tell the user it is a software problem; log for the developer. |
| `unknown` | Not in any list (§5.4), or listed but with no usable meaning (only ER-EWB 4058 "Check"). | Show the code and any returned message. |
| `outcome-unknown` | **Never assigned to an official code.** Reserved for clients: a request may have reached the portal but no answer came back (gsp `transport` with `outcome: "unknown"`). | Check status (fetch) before resending. |

Borderline rules we applied (each is a judgment the owner may change in Appendix A):

1. **Format vs. value.** A wrong *date/JSON format* or missing *header/parameter* is `integration` (the software formats it); a wrong *value* (invalid GSTIN text, wrong state code, wrong amount) is `fix-data`.
2. **GSTIN problems.** "Invalid GSTIN" with no further reason → `fix-data` (likely a typo). Inactive/cancelled/blocked/not enabled/"invalid or does not exist in e-invoice system" (3028, whose resolution says sync from CP) → `gstin-status`. Rules about the **kind** of taxpayer for this transaction (composition, SEZ supplier, ISD recipient, supplier type) → `not-allowed` (2231, 2297, 2298, 2300, 703, 704, 714), except where the fix is plainly a different value in the same document (2246–2248, 2212: recipient type vs supply type → `fix-data`).
3. **Date limits** that depend on the document's real date (2284, 2305, 4043, 819, 820) → `not-allowed`: the user cannot "fix" a true date. A *future* date → `fix-data`.
4. **"Could not retrieve …" / "Error in …"** with no helpdesk mention → `retry-later`; with "contact helpdesk" → `contact-helpdesk`; "try after some time; if issue persists, contact helpdesk" (2146, 2147, VITAL 5001) → `retry-later`.
5. **Login-step failures** that the reason attributes to the payload (VITAL 1007, EWB 107 "Authentication failed. Pls. inform the helpdesk") → `auth`, not `contact-helpdesk`: the app's next step is the login path.
6. **Officer / verification / RFID / dashboard codes** in ER-API (e.g. 242–250, 351–356, 415–443, 600–603, 651–652, 670–685) are categorised by the same rules although a taxpayer client never calls those APIs; they are kept because the list is kept whole (§12 E7).

### 6.2 Counts

| Category | einvoice/VITAL | einvoice/INV | einvoice/EWB | ewaybill/API | Total |
|---|---|---|---|---|---|
| `fix-data` | 7 | 76 | 53 | 207 | 343 |
| `gstin-status` | 8 | 9 | 1 | 8 | 26 |
| `not-allowed` | 1 | 17 | 10 | 72 | 100 |
| `already-done` | 1 | 3 | 2 | 3 | 9 |
| `not-found` | 1 | 3 | 3 | 7 | 14 |
| `auth` | 14 | 0 | 1 | 14 | 29 |
| `throttled` | 4 | 0 | 1 | 3 | 8 |
| `retry-later` | 4 | 4 | 2 | 37 | 47 |
| `contact-helpdesk` | 0 | 0 | 1 | 8 | 9 |
| `integration` | 2 | 4 | 2 | 14 | 22 |
| `unknown` | 0 | 0 | 1 | 0 | 1 |
| `outcome-unknown` | 0 | 0 | 0 | 0 | 0 |
| **Total** | **42** | **116** | **77** | **373** | **608** |

Codes per category, by list (the same assignment as Appendix A, grouped for review):

| List | Category | n | Codes |
|---|---|---|---|
| einvoice/VITAL | `fix-data` | 7 | 3079, 3092, 3093, 3097, 3099, 3100, 3102 |
| einvoice/VITAL | `gstin-status` | 8 | 1014, 3029, 3074, 3075, 3076, 3077, 3078, 3103 |
| einvoice/VITAL | `not-allowed` | 1 | 3101 |
| einvoice/VITAL | `already-done` | 1 | 3106 |
| einvoice/VITAL | `not-found` | 1 | 3001 |
| einvoice/VITAL | `auth` | 14 | 1005, 1006, 1007, 1008, 1010, 1011, 1012, 1013, 1015, 1016, 1017, 1018, 1019, 3000 |
| einvoice/VITAL | `throttled` | 4 | _3109, 3095, 3096, 3108 |
| einvoice/VITAL | `retry-later` | 4 | 3104, 3105, 3107, 5001 |
| einvoice/VITAL | `integration` | 2 | 1004, 3098 |
| einvoice/INV | `fix-data` | 76 | 2159, 2162, 2163, 2169, 2172, 2173, 2174, 2176, 2177, 2182, 2183, 2184, 2185, 2186, 2187, 2189, 2192, 2193, 2194, 2200, 2201, 2202, 2203, 2211, 2212, 2213, 2227, 2228, 2232, 2233, 2234, 2235, 2238, 2239, 2240, 2242, 2243, 2244, 2246, 2247, 2248, 2258, 2259, 2260, 2261, 2262, 2265, 2266, 2267, 2268, 2269, 2271, 2272, 2273, 2274, 2275, 2276, 2280, 2281, 2285, 2288, 2290, 2292, 2294, 2299, 2301, 2303, 2307, 3038, 3039, 3040, 3041, 3047, 3048, 3079, 5001 |
| einvoice/INV | `gstin-status` | 9 | 2195, 3026, 3028, 3029, 3074, 3075, 3076, 3077, 3078 |
| einvoice/INV | `not-allowed` | 17 | 2143, 2226, 2230, 2231, 2270, 2278, 2283, 2284, 2286, 2297, 2298, 2300, 2302, 2304, 2305, 2306, 9999 |
| einvoice/INV | `already-done` | 3 | 2150, 2287, 2295 |
| einvoice/INV | `not-found` | 3 | 2148, 2154, 2296 |
| einvoice/INV | `retry-later` | 4 | 2146, 2147, 4001, 5002 |
| einvoice/INV | `integration` | 4 | 2255, 2279, 2282, 2293 |
| einvoice/EWB | `fix-data` | 53 | 4008, 4009, 4011, 4012, 4013, 4014, 4016, 4018, 4019, 4020, 4021, 4022, 4023, 4024, 4027, 4028, 4029, 4030, 4031, 4032, 4033, 4034, 4035, 4036, 4038, 4039, 4040, 4042, 4044, 4045, 4046, 4047, 4048, 4049, 4050, 4051, 4052, 4059, 4060, 4063, 4064, 4065, 4066, 4067, 4068, 4069, 4070, 4071, 4072, 4073, 4074, 4075, 4076 |
| einvoice/EWB | `gstin-status` | 1 | 4015 |
| einvoice/EWB | `not-allowed` | 10 | 4000, 4010, 4037, 4041, 4043, 4054, 4055, 4056, 4057, 4061 |
| einvoice/EWB | `already-done` | 2 | 4002, 4026 |
| einvoice/EWB | `not-found` | 3 | 4003, 4005, 4007 |
| einvoice/EWB | `auth` | 1 | 4025 |
| einvoice/EWB | `throttled` | 1 | 4062 |
| einvoice/EWB | `retry-later` | 2 | 4001, 4004 |
| einvoice/EWB | `contact-helpdesk` | 1 | 4053 |
| einvoice/EWB | `integration` | 2 | 4006, 4017 |
| einvoice/EWB | `unknown` | 1 | 4058 |
| ewaybill/API | `fix-data` | 207 | 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 229, 230, 231, 232, 233, 234, 235, 236, 242, 243, 244, 249, 251, 252, 253, 254, 255, 256, 278, 282, 283, 301, 302, 303, 304, 305, 306, 307, 308, 320, 321, 344, 351, 352, 353, 354, 355, 356, 358, 359, 360, 361, 362, 369, 370, 371, 372, 373, 374, 375, 376, 377, 378, 385, 386, 389, 390, 393, 394, 395, 396, 398, 399, 400, 402, 406, 407, 408, 409, 410, 413, 416, 420, 421, 422, 424, 426, 428, 430, 432, 433, 434, 436, 437, 438, 439, 441, 443, 450, 451, 600, 602, 603, 607, 608, 609, 610, 611, 612, 614, 615, 616, 617, 618, 619, 620, 621, 622, 623, 624, 627, 628, 629, 630, 631, 632, 633, 634, 638, 640, 641, 642, 643, 644, 651, 652, 659, 670, 671, 672, 678, 679, 680, 701, 702, 705, 706, 707, 708, 709, 710, 711, 712, 713, 721, 724, 726, 727, 729, 801, 802, 803, 804, 805, 806, 807, 808, 809, 815, 816, 823, 828, 831, 832, 833, 834, 835, 836, 837, 838, 839, 840, 842, 855, 857, 858, 861, 862, 863, 864, 865 |
| ewaybill/API | `gstin-status` | 8 | 654, 655, 715, 716, 717, 718, 719, 722 |
| ewaybill/API | `not-allowed` | 72 | 117, 280, 281, 311, 312, 315, 316, 338, 339, 341, 342, 343, 345, 346, 348, 363, 366, 379, 380, 381, 382, 384, 392, 412, 435, 444, 445, 446, 447, 448, 449, 452, 453, 635, 636, 637, 645, 646, 648, 649, 650, 656, 657, 700, 703, 704, 714, 720, 728, 810, 811, 812, 814, 817, 818, 819, 820, 821, 827, 830, 843, 844, 845, 846, 847, 848, 849, 850, 851, 852, 853, 856 |
| ewaybill/API | `already-done` | 3 | 431, 604, 829 |
| ewaybill/API | `not-found` | 7 | 387, 391, 405, 411, 417, 418, 682 |
| ewaybill/API | `auth` | 14 | 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 237, 238 |
| ewaybill/API | `throttled` | 3 | 118, 658, 813 |
| ewaybill/API | `retry-later` | 37 | 313, 322, 325, 326, 327, 328, 329, 330, 331, 334, 336, 337, 347, 350, 364, 365, 367, 368, 397, 401, 403, 415, 419, 423, 425, 427, 429, 440, 442, 613, 673, 675, 676, 677, 681, 683, 685 |
| ewaybill/API | `contact-helpdesk` | 8 | 240, 309, 317, 357, 383, 388, 647, 841 |
| ewaybill/API | `integration` | 14 | 100, 113, 114, 227, 228, 239, 245, 246, 247, 248, 250, 601, 826, 854 |

### 6.3 Several errors in one response

An e-invoice response can carry several `ErrorDetails` entries; an e-way bill `errorCodes` string can carry several codes. `primaryError(descriptions)` returns the one to lead with, by this precedence (**ours**, D-E5), ties broken by the portal's order:

`auth` → `throttled` → `already-done` → `integration` → `gstin-status` → `not-allowed` → `fix-data` → `not-found` → `retry-later` → `contact-helpdesk` → `outcome-unknown` → `unknown`

Reasoning: a broken session or a block makes every other message moot; "already done" means the document exists, so data errors on the resend do not matter; a software fault should not be shown to the user as a data error. All descriptions stay available; the UI decides how many to show.

### 6.4 Where categories live in code

`packages/errors/src/categories.ts`, **hand-written**, header `// Library classification — NOT official. Owner-reviewed table: docs/specs/errors.md Appendix A.` Shape: per list key, `Record<ErrorCategory, readonly string[]>` (codes), as in Appendix A. Tests (§10) prove: every code in the generated data has exactly one category; no category entry names a code that is not in the data; and the table in Appendix A of this spec equals `categories.ts` (the test parses the appendix), so the reviewed table and the code cannot drift.

## 7. Plain-language text — **our wording, not official** (D-E7, D-E8)

Simple English, short sentences, no jargon beyond words on the portal itself (GSTIN, IRN, e-way bill, Part-B). Every `ErrorDescription` carries the official text alongside (§5.1); the UI should always offer "show official message". Code header for `src/messages.ts`: `// Our wording — NOT official text. No legal or tax advice. Never suggests a tax rate (X7).`

### 7.1 Per category

| Category | `userMessage` (ours) |
|---|---|
| `fix-data` | Some details were not accepted by the portal. Correct them and try again. |
| `gstin-status` | The portal reports a problem with a GSTIN in this request, such as inactive, cancelled, blocked or not enabled. Check the GSTIN's status on the GST portal. |
| `not-allowed` | The portal does not allow this action for this document now. Sending it again will not help. |
| `already-done` | The portal says this was already done. Fetch the existing record instead of sending it again. |
| `not-found` | The portal could not find this record. Check the number and date. |
| `auth` | Signing in to the government portal failed or has expired. Sign in again, or ask your administrator to check the API login details. |
| `throttled` | The portal is limiting requests right now. Wait a few minutes before trying again. |
| `retry-later` | The portal had a temporary problem. Try again later. |
| `contact-helpdesk` | The portal could not complete this request and asks you to contact its helpdesk. Note the error code and the time. |
| `integration` | The request was not in the format the portal expects. This is a software problem; please contact your software provider. |
| `unknown` | The portal returned an error that is not in its published list. Note the error code and contact your software provider. |
| `outcome-unknown` | We could not confirm whether the portal received this request. Check its status before sending it again. |

### 7.2 Per-code overrides (only where the official text is unclear or misleading)

| List | Code | `userMessage` (ours) | Why |
|---|---|---|---|
| einvoice/VITAL | 1014 | This GSTIN is inactive or not enabled for e-invoicing on the portal. | Official message is only "Inactive User"; the reason explains it. |
| einvoice/VITAL | 3095 | The portal has temporarily stopped e-invoice requests from this software because it received many requests with errors. Stop sending and contact your software provider. | Long official text; the next step is not stated. |
| einvoice/VITAL | 3096 | The portal has temporarily stopped e-invoice requests for this user or GSTIN because it received many requests with errors. Stop sending and contact your software provider. | As 3095. |
| einvoice/INV | 2154 | No IRN details were found for this request. | Reason/resolution are copies of 2150's duplicate-IRN text and contradict the message (§12 E2). |
| einvoice/INV | 2240 | The GST rate on line {0} was not accepted by the portal. Check the rate for this item with your accountant. | The official resolution lists rates; it is **not a rate list** (X7). Our text never names a rate. |
| einvoice/INV | 2278 | An IRN was generated for this document number and later cancelled. The portal will not accept the same document number again. | Category `not-allowed` text would hide the reason; differs from X5 (§12 E4). |
| einvoice/EWB | 4058 | The portal returned code 4058 with only the word "Check". The published list gives no other meaning. | Official message is one word. |
| einvoice/EWB | 4074 | A ship-to GSTIN is required for this transaction type. | Malformed placeholder `{0)` (X8). |
| ewaybill/API | 366 | E-way bills generated today cannot be fetched with this request; earlier days' can. | Spelling errors make the official text hard to read. |
| ewaybill/API | 813 | The same request was sent twice at the same moment. Wait, then check whether the first one went through before sending again. | Next step (check before resend) is not stated. |

An override with a placeholder (2240) falls back to its category text when the parameter is missing (§5.3).

### 7.3 Rules for our wording (tested, T-M3–T-M6)

- **No legal or tax advice.** Our texts say what the portal reported and what kind of step to take in the software. They never say what the law requires, whether tax is payable, or whether a party may be dealt with. Banned words in our texts: "must pay", "liable", "penalty", "illegal", "offence", "you are required by law".
- **Never a tax rate (X7).** No our-text contains a percentage, the word "rate" followed by a number, or the 2240 resolution's list. `describeError` returns the 2240 resolution verbatim in `officialResolution` (the data is kept whole) with note `"X7-not-a-rate-list"`; the README tells UIs to show that note with it ("This list is from the portal's error page. It is not a list of applicable rates."). No code in this repository reads rates from it.
- **Never invent meaning.** A per-code override restates only what the official message/reason/resolution says, or says that it says nothing more (4058).
- Our texts carry no placeholders except `{0}` in 2240; they never include user data other than via `params`.

### 7.4 Official text availability

`officialMessage`, `officialReason`, `officialResolution` and `source` are always present for a known code. The README recommends: show `userMessage` first; offer "Official message" (the `returnedMessage` if the portal sent one, else `officialMessage`) and the error code; show `officialResolution` where present (with the X7 note for 2240).

### 7.5 Later languages

`messages.ts` exports `USER_MESSAGES_EN`; `describeError` takes no locale in v0.1. A later `options.messages` (a full table of the same shape, validated by schema) can add other languages without changing categories or data (deferred, §15).

## 8. Integration with `@india-gst-kit/gsp` (build PR changes `gsp`)

### 8.1 Decorated `api` errors

`ApiErrorEntrySchema` (gsp §7.3) gains fields filled by the client from `describeErrors(system, errors, { op })`:

```ts
ApiErrorEntrySchema = z.strictObject({
  code: z.string(),
  message: z.string().optional(),          // as returned by the portal (unchanged)
  system: SystemSchema,                     // new
  list: ErrorListIdSchema.nullable(),       // new — null when unknown
  category: ErrorCategorySchema,            // new — ours
  officialMessage: z.string().nullable(),   // new — from the official list, placeholders filled
  userMessage: z.string(),                  // new — ours
  notes: z.array(ErrorNoteSchema),          // new
});
```

- Applied to every `api` error, including one wrapped in `auth.cause`.
- `parseEinvoiceErrors` / `parseEwbErrors` (exported, gsp §21) keep returning `{ code, message? }`; decoration happens in the client after decoding, so the envelope parsers stay pure.
- Redaction (gsp §6.4) runs on the decorated entry like any other string field.
- A caller-supplied `errorCodeTable` (the deprecated `describeErrorCode` path) overrides `officialMessage` for matching `(system, code)`; nothing else.

### 8.2 `summarizeGspError(error)` (new gsp export)

Returns `{ category: ErrorCategory, userMessage: string, primary?: ApiErrorEntry, entries: ApiErrorEntry[] }` for **any** `GspError`:

| `GspError` | `category` | `userMessage` |
|---|---|---|
| `api` | `primaryError` of its entries (§6.3) | that entry's `userMessage` |
| `auth` with `cause.kind === "api"` | as `api` (usually `auth`) | as `api` |
| `auth` with another cause | `auth` | `auth` category text |
| `validation` | `fix-data` | `fix-data` text (the `issues` hold the details) |
| `transport`, `outcome: "not-sent"` | `retry-later` | `retry-later` text |
| `transport`, `outcome: "unknown"` | `outcome-unknown` | `outcome-unknown` text |
| `protocol`, `crypto`, `config` | `integration` | `integration` text |

### 8.3 Session codes (X4) — `SESSION_ERROR_CODES`

```ts
export const SESSION_ERROR_CODES = { einvoice: ["1005"], ewaybill: ["105", "106", "238"] } as const;
```

Exported by `errors` with a comment citing X4 and gsp V11 ("UNVERIFIED until a live call"). It is a **subset** of the `auth` category: the other `auth` codes (wrong password, wrong client secret) must **not** trigger a re-login loop. `gsp`'s `authErrorCodes` default stays empty (D-G20 amended, D-E10); a caller opts in with `authErrorCodes: SESSION_ERROR_CODES`. A test asserts every code in it exists in its list and is in `auth`.

### 8.4 How BDB would use it (one example)

Generating an IRN from BDB's invoice screen:

```ts
import { summarizeGspError } from "@india-gst-kit/gsp";

const r = await client.einvoice.generateIrn({ gstin, request: irnRequest });
if (!r.ok) {
  const s = summarizeGspError(r.error);
  switch (s.category) {
    case "already-done":            // 2150 / 2295 (X5): the IRN exists — fetch it, never resend
    case "outcome-unknown": {       // no answer came back: same reconcile path
      const got = await client.einvoice.getIrnByDocDetails({ gstin, docType: "INV", docNum, docDate });
      if (got.ok) return markGenerated(invoiceId, got.value);
      if (s.category === "outcome-unknown") return queueRetry(invoiceId); // not found ⇒ the POST did not land
      return showProblem(invoiceId, s);
    }
    case "fix-data":
    case "gstin-status":
      // one line per entry: our text, with "Official message" and the code one click away
      return showOnInvoice(invoiceId, s.entries.map((e) => ({ text: e.userMessage, official: e.message ?? e.officialMessage, code: e.code })));
    case "auth":     return notifyAdmin("e-invoice API login", s.userMessage);
    case "throttled": return queueRetry(invoiceId, { notBeforeMinutes: 5 });
    case "retry-later": return queueRetry(invoiceId, { reconcileFirst: true });
    default:          return showProblem(invoiceId, s); // not-allowed, not-found, contact-helpdesk, integration, unknown
  }
}
```

BDB never decides from a category whether an invoice is taxable or which rate applies; `fix-data` only means "the portal did not accept a value; let the user correct it".

## 9. Exports (`packages/errors/src/index.ts`)

- Schemas + inferred types: `ErrorSystemSchema`, `ErrorListIdSchema`, `ErrorCategorySchema` (`ERROR_CATEGORIES` tuple in §6.1 order), `ErrorNoteSchema`, `OfficialErrorRowSchema`, `ErrorDescriptionSchema`.
- Data: `EINVOICE_VITAL_ERRORS`, `EINVOICE_INV_ERRORS`, `EINVOICE_EWB_ERRORS`, `EWAYBILL_API_ERRORS`, `ERROR_LIST_SOURCES`.
- Ours: `ERROR_CATEGORY_BY_CODE` (from `categories.ts`), `USER_MESSAGES_EN`, `SESSION_ERROR_CODES`, `CATEGORY_PRECEDENCE`.
- Functions: `describeError`, `describeErrors`, `primaryError`, `fillPlaceholders` (the §5.3 filler, exported for UIs that format their own templates), `listOrderForOp`.
- No default export.

## 10. Test list (Vitest; written first)

**Data (T-D)**
- T-D1 `SHA256SUMS` matches all four source files; a changed byte fails.
- T-D2 Each generated array deep-equals the rows rebuilt from its source file (count 42/116/77/373, order, every string).
- T-D3 The generator's `render()` output equals each committed data file byte for byte (hand edits fail).
- T-D4 Empty cells are absent keys, never `""`; non-empty cells are unchanged (spot: INV 2143 curly quote `’`, API 111 "registerd", VITAL header "Messege" is checked by the generator).
- T-D5 No code repeats within a list; `_3109` exists in VITAL and `3109` does not exist anywhere.
- T-D6 X1: the codes in more than one e-invoice list are exactly `3029, 3074, 3075, 3076, 3077, 3078, 3079, 5001` (VITAL∩INV) and `4001` (INV∩EWB); no other overlap.
- T-D7 `ErrorListIdSchema` accepts `einvoice/VITAL|INV|EWB` and `ewaybill/API` only.
- T-D8 Every data file starts with the `Source`/`Retrieved: 2026-10-18`/`Status: UNVERIFIED — needs CA` header.

**Categories (T-C)**
- T-C1 Every code of every list has exactly one category; no extra codes in `categories.ts`.
- T-C2 Appendix A of `docs/specs/errors.md` (parsed) equals `categories.ts`.
- T-C3 Counts equal §6.2.
- T-C4 `outcome-unknown` is assigned to no official code; `unknown` only to EWB 4058.
- T-C5 X5/X6 spot checks: INV 2150, 2295 and EWB 4026, API 604 are `already-done`; VITAL 3095, 3096, 3108, `_3109` and API 118, 658, 813 are `throttled`; INV 2278 is `not-allowed` (D-E3 deviation from X5, §12 E4).
- T-C6 `SESSION_ERROR_CODES` ⊂ `auth` and every code exists (X4).
- T-C7 `primaryError` follows §6.3, ties by input order; empty input ⇒ `undefined`.

**Lookup (T-L)**
- T-L1 `describeError("einvoice", "2150")` ⇒ INV row, `already-done`, official message verbatim, `source.url` = INV page.
- T-L2 `list` given ⇒ only that list; `describeError("einvoice", "5001", { list: "VITAL" })` ⇒ `retry-later`; `{ list: "INV" }` ⇒ `fix-data`.
- T-L3 `op` ordering per §5.2 for each op group; `5001` with `einvoice.auth` ⇒ VITAL, with `einvoice.generateIrn` ⇒ INV; `4001` with `einvoice.generateEwbByIrn` ⇒ EWB; `otherLists` lists the rest.
- T-L4 No `op`/`list` and a multi-list code ⇒ INV first and note `list-guessed`; single-list code ⇒ no note.
- T-L5 X2: `describeError("ewaybill", "2150")` ⇒ `unknown`; `describeError("einvoice", "105")` ⇒ `unknown`.
- T-L6 Unknown: `"99999"`, `""`, `"  "`, `"UNKNOWN"` ⇒ `known: false`, `category: "unknown"`, nulls, no throw; `returnedMessage` passed through sanitised.
- T-L7 Code trimming: `" 2150 "` ⇒ found; `"3109"` ⇒ unknown (X3); `"02150"` ⇒ unknown.
- T-L8 `ewaybill` + `op` is accepted and ignored.
- T-L9 Result parses with `ErrorDescriptionSchema` for every code of every list (608 cases) and for unknowns.

**Placeholders (T-P)**
- T-P1 INV 2176 with `["1234"]` ⇒ "HSN code(s)-1234 is invalid".
- T-P2 INV 3039 `{1}`/`{0}`/`{2}` filled by index regardless of order.
- T-P3 A value containing `{1}` is not re-expanded; a value with control/bidi characters is cleaned; a 300-char value is cut to 100 with `…`.
- T-P4 Missing param ⇒ literal `{0}` kept in `officialMessage`, note `missing-params`, `userMessage` has no `{` (2240 falls back to the `fix-data` text).
- T-P5 EWB 4074 `{0)` is not replaced, note `X8-malformed-placeholder`, override user message.
- T-P6 `officialMessageTemplate` always equals the verbatim data.
- T-P7 `returnedMessage` cut at 500 with `…`.

**Messages (T-M)**
- T-M1 Every category has a non-empty English message; every override key exists in the data.
- T-M2 `userMessageSource` is `"code"` exactly for the §7.2 rows.
- T-M3 No our-text contains `%`, a number after "rate", the 2240 resolution text, or any banned phrase (§7.3).
- T-M4 2240's `officialResolution` is returned verbatim with note `X7-not-a-rate-list`, and its `userMessage` contains no digit except via `params`.
- T-M5 Our texts are ≤ 200 characters and contain no placeholder other than 2240's `{0}`.
- T-M6 No our-text equals or contains a full official message (they are ours, not copies).

**Integration (T-I)** — in the build PR, in `packages/gsp/test/`
- T-I1 A mocked status-0 e-invoice generate with `ErrorDetails` `[{ErrorCode:"2150",ErrorMessage:"Duplicate IRN"}]` ⇒ entry has `list: "INV"`, `category: "already-done"`, `officialMessage`, `userMessage`, `message: "Duplicate IRN"`.
- T-I2 EWB `{ errorCodes: "238,240" }` ⇒ two entries; `summarizeGspError` ⇒ `auth` (precedence) with 240 still in `entries`.
- T-I3 `errors`' system enum equals `gsp`'s `SystemSchema` options (type and runtime).
- T-I4 `summarizeGspError` table §8.2, one case per row.
- T-I5 Deprecated `describeErrorCode` with a caller table still works and overrides `officialMessage`.
- T-I6 Redaction: a decorated entry with a registered secret in `message` is redacted (gsp §12.4).
- T-I7 `authErrorCodes: SESSION_ERROR_CODES` re-logs in on 1005 for a GET (existing gsp behaviour, new constant).

## 11. Issue/note codes

`ErrorNote`: `X1-in-other-lists`, `X3-underscore-code`, `X7-not-a-rate-list`, `X8-malformed-placeholder`, `missing-params`, `list-guessed`. No warnings or errors are emitted; `describeError` always returns a description.

## 12. Source observations and anything unclear (E1–E10)

- **E1. Same message, different code, same list.** API 103 and 104 are both "Invalid Client -Id"; API 246, 248, 250 are all "Invalid Vehicle Release Date Format"; API 225 and 355 are both "Invalid Vehicle Number Format" (304 "Invalid vehicle format"); API 301 and 344 are both "Invalid eway bill number"; API 322 and 350 are both "Could not generate consolidated eway bill". Kept as published; same category.
- **E2. INV 2154 "IRN details are not found"** has reason and resolution copied from 2150 (duplicate IRN). The message and the reason contradict each other. Categorised by the message (`not-found`) with a per-code user message; the official reason/resolution are still returned verbatim. *Owner: confirm on a live call which situation 2154 really signals.*
- **E3. `_3109`** (X3) has the same message as 3108. Whether the API ever returns the code with the underscore is unknown; `"3109"` is not matched to it (T-L7). *Verify on a live call (gsp V10).*
- **E4. X5 vs our category for INV 2278.** X5 lists 2278 among "already done … fetch, not retry". The official resolution says a new document number must be used, and a fetch would return a **cancelled** IRN, so we put it in `not-allowed` (with an override message). *Owner decision (D-E3).*
- **E5. Codes beyond X5/X6 that we also put in those categories:** `already-done` also has INV 2287, EWB 4002 (e-way bill already exists for the IRN), API 431 (Part-A already generated by you), 829 (already closed), VITAL 3106 (no change, same status). `throttled` also has EWB 4062 (same message as 3108). *Owner: confirm.*
- **E6. INV 5001 vs VITAL 5001** (X1): same code, different reason; categories differ (`fix-data` vs `retry-later`). The list order of §5.2 decides; without `op`/`list` INV wins.
- **E7. Officer-only codes.** ER-API includes codes for officer verification, RFID, dashboards and watch lists (e.g. 242–250, 351–356, 364–367, 415–443, 600–603, 613, 651–652, 670–685) that a taxpayer client never receives. Kept (the list is kept whole); categorised by the same rules.
- **E8. Ambiguous "could not retrieve".** API 326 "Could not retrieve GSTIN details for the given GSTIN number" and 337 (HSN) may mean "not found" rather than a temporary failure. Put in `retry-later` by rule 4 (§6.1). *Verify on a live call.*
- **E9. Status/rule wording vs reality.** Several codes carry thresholds or dates in their messages (282/283 "turnover less than 5Cr", 819 "01/07/2017", 820 "180 days", 821 "360 days", 3092/3093 turnover bands, VITAL 1005 "valid for 6 hours"). These are **messages**, kept verbatim; nothing in this package enforces or reasons from them. (They also differ from other sources: e.g. 1005 says 6 hours, gsp's EI-AUTH says 360 min — consistent — while 2283/2305/4043 take the number of days as a parameter.)
- **E10. Envelope shapes still unverified (gsp V10).** e-invoice errors may come as an array, an object, a JSON string or Base64; e-way bill codes as a number, comma string or Base64. This package receives codes only after gsp has decoded them; nothing here depends on V10.

No source needed by this spec is missing. The lists are **descriptive** (we show them; we do not enforce them), so the "source for an enforced legal list unavailable" stop condition does not arise.

## 13. Decisions (proposed; owner to approve. All UNVERIFIED; **Needs CA** where marked)

- **D-E1 New package `@india-gst-kit/errors`** (§2), `zod` peer only; `gsp` depends on it. *Recommend: approve.*
- **D-E2 Category set** of §6.1 (11 assigned + `outcome-unknown` reserved), labelled ours everywhere. *Recommend: approve.*
- **D-E3 Category per code** as in Appendix A, including the borderline rules of §6.1 and INV 2278 → `not-allowed` (deviates from X5, E4). *Owner review required (table).*
- **D-E4 List order per op** (§5.2); default INV → VITAL → EWB with note `list-guessed`. *Recommend: approve.*
- **D-E5 Precedence** for several errors (§6.3). *Recommend: approve.*
- **D-E6 Placeholders**: only `{digits}` are placeholders, single pass, sanitised values (100/500 chars), missing ⇒ literal kept + note; data stays verbatim, including 4074's `{0)`. *Recommend: approve.*
- **D-E7 User messages** per category (§7.1) and the ten per-code overrides (§7.2), English only. *Owner review required (wording).*
- **D-E8 Wording rules** (§7.3): no legal/tax advice, never a rate, never invent meaning; 2240's resolution returned verbatim with the X7 note. **Needs CA** (that the texts give no advice).
- **D-E9 Data stays whole**: all 608 rows including officer-only codes and spelling mistakes; empty cells omitted. *Recommend: approve.*
- **D-E10 `authErrorCodes` default stays empty**; `SESSION_ERROR_CODES` (X4) exported for opt-in; revisit after gsp V11. *Recommend: approve.*
- **D-E11 `describeErrorCode`/`ErrorCodeInfoSchema` in gsp deprecated**, kept for one minor as an override path. *Recommend: approve.*
- **D-E12 Code matching**: trim ASCII whitespace only; no numeric normalisation; `3109` ≠ `_3109`. *Recommend: approve; E3.*
- **D-E13 Unknown codes** never throw and never guess (§5.4); other system's lists are never searched (X2). *Recommend: approve.*
- **D-E14 Spec–code lock**: a test parses Appendix A, so changing a category means changing this spec in the same PR. *Recommend: approve.*

## 14. Stop conditions (build session)

As in CLAUDE.md, plus:
- `sources/errors/SHA256SUMS` does not match a source file, or a header row differs from §4.3 → stop and ask for a fresh capture (new `Retrieved` date and legal-facts update).
- A code in the data has no category, or Appendix A and `categories.ts` disagree, and the fix is not a typo → stop and ask the owner (categories are their decision).
- Any our-text would need to state a rate, a legal consequence or a deadline not in the official text → stop.
- Changing `gsp`'s `ApiErrorEntrySchema` breaks a public type in a way a minor bump cannot cover → stop and report.
- `pnpm check` cannot be made green without weakening lint/strictness → stop and report.

## 15. Deferred

Other languages (§7.5); GSTN return-API and GSP-specific error codes; codes seen on live calls but missing from the lists (a later "observed codes" file, sourced from logs, needs its own legal-facts row); automatic re-login defaults (after V11); any UI component; resolving E2/E3/E8 (live calls).

## 16. Changeset plan

- **This spec PR:** no changeset (docs only).
- **Build PR:**
  - `.changeset/errors-initial.md` — `"@india-gst-kit/errors": minor` — "Initial release: the e-invoice (VITAL, INV, EWB) and e-way bill API error-code lists as generated, verbatim data (retrieved 2026-10-18); `describeError` with per-op list choice and safe placeholder filling; library categories and plain-English messages (ours, not official); `SESSION_ERROR_CODES`."
  - `.changeset/gsp-error-descriptions.md` — `"@india-gst-kit/gsp": minor` — "`api` error entries carry `system`, `list`, `category`, `officialMessage`, `userMessage`, `notes` from `@india-gst-kit/errors`; new `summarizeGspError`; `describeErrorCode`/`ErrorCodeInfoSchema` deprecated."
  - `packages/errors/package.json` (published, `engines.node >=22`, `files: ["dist"]`, scripts as `einvoice`, peer/dev `zod`), `tsconfig*.json`, `vitest.config.ts`, README; `.prettierignore` gains the four data files; CLAUDE.md layout line gains `packages/errors`; `gsp.md` §7.4/§14/§16 F2/§18 updated per §2.

## 17. `docs/legal-facts.md` rows to add (at build time)

Each: retrieved 2026-10-18, status **UNVERIFIED — needs CA**.

| Fact | File | Source |
|---|---|---|
| e-invoice error codes, VITAL list (42; auth, user, GSTIN), verbatim | `packages/errors/src/data/einvoice-vital.ts` | https://einvoice1.gst.gov.in/others/geterrorcodes/VITAL — `sources/errors/einvoice-error-codes-VITAL.json` |
| e-invoice error codes, INV list (116; IRN generate/cancel/get), verbatim; 2240's rate text is **not** a rate list (X7) | `packages/errors/src/data/einvoice-inv.ts` | https://einvoice1.gst.gov.in/others/geterrorcodes/INV — `sources/errors/einvoice-error-codes-INV.json` |
| e-invoice error codes, EWB list (77; e-way bill via IRP), verbatim; 4074's `{0)` malformed (X8) | `packages/errors/src/data/einvoice-ewb.ts` | https://einvoice1.gst.gov.in/others/geterrorcodes/EWB — `sources/errors/einvoice-error-codes-EWB.json` |
| e-way bill API error codes (373), verbatim | `packages/errors/src/data/ewaybill-api.ts` | https://docs.ewaybillgst.gov.in/apidocs/api-error-codes-list.html — `sources/errors/ewaybill-api-error-codes.json` |
| Session/token codes e-invoice 1005; e-way bill 105, 106, 238 (X4; to confirm live, gsp V11) | `packages/errors/src/session-codes.ts` | the VITAL and API lists above; `sources/errors/README.md` X4 |
| errors D-E2/D-E3: library categories per code (ours, not official) | `packages/errors/src/categories.ts` | Spec errors §6, Appendix A — Design decision |
| errors D-E7/D-E8: plain-language messages (ours, no legal/tax advice, never a rate) | `packages/errors/src/messages.ts` | Spec errors §7 — Design decision, **needs CA** |

## Appendix A — category per code (owner review; **ours, not official**)

The message column is the official message, verbatim (Markdown-escaped only). Reason and resolution are in the source files and in `describeError`. T-C2 parses the **Code** and **Category** columns of these four tables.

### einvoice/VITAL — 42 codes

| Code | Category | Official message (verbatim) |
|---|---|---|
| `_3109` | `throttled` | You have exceeded the limit for this operation |
| `1004` | `integration` | Header GSTIN is required |
| `1005` | `auth` | Invalid Token |
| `1006` | `auth` | User Name is required |
| `1007` | `auth` | Authentication failed. Pls. inform the helpdesk |
| `1008` | `auth` | Invalid login credentials |
| `1010` | `auth` | Invalid Client-ID/Client-Secret |
| `1011` | `auth` | Client Id is required |
| `1012` | `auth` | Client Secret is required |
| `1013` | `auth` | Decryption of password failed |
| `1014` | `gstin-status` | Inactive User |
| `1015` | `auth` | Invalid GSTIN for this user |
| `1016` | `auth` | Decryption of App Key failed |
| `1017` | `auth` | Incorrect user id/User does not exists |
| `1018` | `auth` | Client Id is not mapped to this user |
| `1019` | `auth` | Incorrect Password |
| `3000` | `auth` | Invalid login credentials |
| `3001` | `not-found` | Requested data is not available |
| `3029` | `gstin-status` | GSTIN is inactive or cancelled |
| `3074` | `gstin-status` | GSTIN - {0} is cancelled and document date - {1} is later than de-registration date |
| `3075` | `gstin-status` | GSTIN- {0} is cancelled and de-registration date is not available |
| `3076` | `gstin-status` | GSTIN - {0} is inactive |
| `3077` | `gstin-status` | GSTIN - {0} is cancelled and document date - {1} is earlier than registration date |
| `3078` | `gstin-status` | GSTIN- {0} is cancelled and registration date is not available |
| `3079` | `fix-data` | For active GSTINs the document date should not be earlier than registration date |
| `3092` | `fix-data` | Your PAN has Enabled with 5 Cr. Please enter turn over below 10 Cr |
| `3093` | `fix-data` | Please enter turn over between 0.5Cr and 1Cr |
| `3095` | `throttled` | e-Invoice operations are temporarily disabled for the CLIENT - {0} as large number of erroneous requests have been received from the client for quite sometimes. |
| `3096` | `throttled` | e-Invoice operations are temporarily disabled for this USERNAME/GSTIN - {0} as large number of erroneous requests have been received from the USERNAME/GSTIN for quite sometimes. |
| `3097` | `fix-data` | Password cannot be same as any of the last 5 passwords for this user account |
| `3098` | `integration` | Invalid IRP code |
| `3099` | `fix-data` | Password must not be too common |
| `3100` | `fix-data` | Old Password is incorrect |
| `3101` | `not-allowed` | You are not authorized to change password of this user account as the gstin does not match |
| `3102` | `fix-data` | This mobile number is already in use |
| `3103` | `gstin-status` | Password cannot be reset as this GSTIN is cancelled |
| `3104` | `retry-later` | Some error occured while logging Client change status |
| `3105` | `retry-later` | Error while updating the change/(s) |
| `3106` | `already-done` | No changes made as the requested status is the same as the current status. |
| `3107` | `retry-later` | Some error occured while logging User change status |
| `3108` | `throttled` | You have exceeded the limit for this operation |
| `5001` | `retry-later` | Application error, issue with application while processing the request. Please try again. If error persists kindly raise the ticket along with request JSON, error details and timestamp of the error occurrence. |

### einvoice/INV — 116 codes

| Code | Category | Official message (verbatim) |
|---|---|---|
| `2143` | `not-allowed` | Invoice does not belongs to the user GSTIN |
| `2146` | `retry-later` | Unable to create IRN, Pls. try after some time |
| `2147` | `retry-later` | Unable to sign invoice, Pl try after some time |
| `2148` | `not-found` | Requested IRN data is not available |
| `2150` | `already-done` | Duplicate IRN |
| `2154` | `not-found` | IRN details are not found |
| `2159` | `fix-data` | Invalid value for reverse charge applicable field |
| `2162` | `fix-data` | Reverse Charge is not applicable for this transaction |
| `2163` | `fix-data` | The document date should not be future date . |
| `2169` | `fix-data` | Request for IRN is neither from supplier GSTIN or e-Commerce GSTIN |
| `2172` | `fix-data` | For Intra-state transaction, IGST amount is not applicable; only CGST and SGST amounts are applicable |
| `2173` | `fix-data` | You have exceeded the limit of number of items |
| `2174` | `fix-data` | For inter-state transaction, CGST and SGST amounts are not applicable; only IGST amount is applicable |
| `2176` | `fix-data` | HSN code(s)-{0} is invalid |
| `2177` | `fix-data` | Unit Quantity Code(s)-{0} is/are not as per master |
| `2182` | `fix-data` | Taxable value of all items is not equal to total taxable value |
| `2183` | `fix-data` | SGST value of all items is not equal to total SGST Value |
| `2184` | `fix-data` | CGST value of all items must be equal to total CGST value |
| `2185` | `fix-data` | IGST value of all items must be equal to total IGST Value |
| `2186` | `fix-data` | Cess value of all items must be equal to total Cess Value |
| `2187` | `fix-data` | State Cess Value of all items must be equal to total State CessValue |
| `2189` | `fix-data` | Total Invoice Value is not matching with calculated value |
| `2192` | `fix-data` | TotAmt value should be equal to (Qty \* UnitPrice) for HSN {0} |
| `2193` | `fix-data` | For Sl. No. {0}, Taxable Value (AssAmt) value is not equal to (TotAmt - Discount) |
| `2194` | `fix-data` | For Sl. No {0}, Total item value does not match with taxable and tax values of that item |
| `2195` | `gstin-status` | e-Commerce GSTIN is not registered as TCS-GSTIN |
| `2200` | `fix-data` | State code {0} is invalid for dispatch details or ship details |
| `2201` | `fix-data` | Invalid Port Code |
| `2202` | `fix-data` | Invalid Country Code |
| `2203` | `fix-data` | Invalid Foreign Currency |
| `2211` | `fix-data` | Supplier and recipient GSTIN should not be the same. |
| `2212` | `fix-data` | The recipient GSTIN cannot be URP for supply type {0} |
| `2213` | `fix-data` | The supplier GSTIN cannot be URP |
| `2226` | `not-allowed` | You are not authorised to get IRN data |
| `2227` | `fix-data` | For Sl. No {0}, SGST and CGST amounts are not equal |
| `2228` | `fix-data` | Item list cannot be empty |
| `2230` | `not-allowed` | This IRN cannot be cancelled because e-way bill has been generated , you can cancel e-way bill and then try cancelling IRN |
| `2231` | `not-allowed` | Cannot generate e-Invoice as the supplier GSTIN - {0} is SEZ |
| `2232` | `fix-data` | POS is incorrect for {0} transaction |
| `2233` | `fix-data` | Duplicate SI numbers are not allowed in line items |
| `2234` | `fix-data` | For Sl. No {0}, SGST and CGST amount passed does not match with taxable value and tax rate |
| `2235` | `fix-data` | For Sl. No {0}, IGST amount passed is not matching with taxable value and tax rate |
| `2238` | `fix-data` | For Sl. No {0}, Quantity is not passed |
| `2239` | `fix-data` | For Sl. No {0}, Unit Quantity Code (UQC) is not passed |
| `2240` | `fix-data` | For Sl. No {0}, GST rate of tax is incorrect or not as notified |
| `2242` | `fix-data` | Recipient POS is incorrect for transaction type {0} |
| `2243` | `fix-data` | POS code is invalid |
| `2244` | `fix-data` | Recipient pincode is not provided for the transaction - {0} |
| `2246` | `fix-data` | Recepient cannot be SEZ for - {0} transaction |
| `2247` | `fix-data` | Recepient should be SEZ for transaction {0} |
| `2248` | `fix-data` | Recepient has to be URP in case of Export transactions |
| `2255` | `integration` | Requested Payload is empty |
| `2258` | `fix-data` | Supplier GSTIN state codedoes not match with the state code passed in supplier details |
| `2259` | `fix-data` | Invalid supplier state code |
| `2260` | `fix-data` | The recipient state code is invalid |
| `2261` | `fix-data` | The recipient state code is incorrect for {0} transaction |
| `2262` | `fix-data` | For Intra-state supply, IGST cannot be charged |
| `2265` | `fix-data` | Recipient GSTIN state code does not match with the state code passed in recipient details |
| `2266` | `fix-data` | For Sl. No {0}, Cess amount passed does not match with the calculated value |
| `2267` | `fix-data` | For Sl. No {0}, State Cess amount passed is not as per calculated value |
| `2268` | `fix-data` | IGST on instra state supply is not applicable to export/SEZ transactions |
| `2269` | `fix-data` | Recipient state code is incorrect for transaction type {0} |
| `2270` | `not-allowed` | The allowed cancellation time limit is crossed, you cannot cancel the IRN |
| `2271` | `fix-data` | SHIP TO - state code is not valid statecode for B2B, SEZ and Deemed Export transactions |
| `2272` | `fix-data` | SHIP TO - PIN code cannot be 999999 for B2B, SEZ and Deemed Export transactions |
| `2273` | `fix-data` | Dispatch from PIN code cannot be 999999 |
| `2274` | `fix-data` | Recipient PIN code cannot be 999999 for {0} transaction. |
| `2275` | `fix-data` | Recipient PIN code should be 999999 for Direct Export |
| `2276` | `fix-data` | Supplier PIN code cannot be 999999 |
| `2278` | `not-allowed` | IRN is already generated and is cancelled for this Document number. The duplicate IRN cannot be generated for the same number. |
| `2279` | `integration` | Invalid schema version |
| `2280` | `fix-data` | Invalid document type |
| `2281` | `fix-data` | Inavalid document number |
| `2282` | `integration` | Invalid document date format |
| `2283` | `not-allowed` | IRN details cannot be provided as it is generated more than {0} days prior |
| `2284` | `not-allowed` | IRN cannot be generated for the document date which is prior to {0} |
| `2285` | `fix-data` | Invalid value for IGST on intra field |
| `2286` | `not-allowed` | Cannot generate the ewaybill for cancelled IRN |
| `2287` | `already-done` | Ewaybill already exists for the given IRN |
| `2288` | `fix-data` | Invalid Recipient GSTIN |
| `2290` | `fix-data` | Invalid Total Invoice Value |
| `2292` | `fix-data` | Invalid document date |
| `2293` | `integration` | Invalid date format -(The correct format is dd/MM/yyyy) |
| `2294` | `fix-data` | Reverse charge is mandatory if IGST on intra is applicable |
| `2295` | `already-done` | IRN is already generated and registered with GSTN Lookup Portal by other IRP |
| `2296` | `not-found` | Data not Found |
| `2297` | `not-allowed` | Reverse charge supply is not allowed for ISD recipients |
| `2298` | `not-allowed` | Recipient cannot be composition/UIN taxpayer for Deemed Exports |
| `2299` | `fix-data` | E-Commerce Operator GSTIN field should be empty when Tax Payer generates e-Invoice |
| `2300` | `not-allowed` | Supplier GSTIN should be of type Regular or SED or Casual Taxable Person |
| `2301` | `fix-data` | E-Commerce Operator GSTIN field should not be empty when e-Commerce operator generates e-Invoice |
| `2302` | `not-allowed` | Status of the IRN is not active |
| `2303` | `fix-data` | For B2B transactions, buyer POS can be foreign country(96) only for Goods Transport Services (services by way of transportation of goods) |
| `2304` | `not-allowed` | You are not authorised to perform this operation |
| `2305` | `not-allowed` | IRN cannot be generated with document date prior to {0} days from today for suppliers with turnover above {1} |
| `2306` | `not-allowed` | Supplier has not given the consent to download the IRN by recepient. |
| `2307` | `fix-data` | Future date cannot be accepted |
| `3026` | `gstin-status` | E-Invoice Options are not enabled for this GSTIN -{0} |
| `3028` | `gstin-status` | GSTIN -{0} is invalid. |
| `3029` | `gstin-status` | GSTIN -{0} is inactive or cancelled |
| `3038` | `fix-data` | {0} details Details:Pincode-{1} does not exists |
| `3039` | `fix-data` | Pincode -{1} of {0} does not belong to his/her State - {2} |
| `3040` | `fix-data` | Buyer or Ship Details:Pincode - {0} does not exists |
| `3041` | `fix-data` | Buyer or Ship Details:Pincode -{0} does not belong to the state-{1} |
| `3047` | `fix-data` | The HSN - {0} does not belong to Goods |
| `3048` | `fix-data` | The HSN - {0} does not belong to Service |
| `3074` | `gstin-status` | GSTIN - {0} is cancelled and document date - {1} is later than DRegistration Date |
| `3075` | `gstin-status` | GSTIN- {0} is cancelled and DRegistration Date is not available |
| `3076` | `gstin-status` | GSTIN - {0} is inactive |
| `3077` | `gstin-status` | GSTIN - {0} is cancelled and document date - {1} is earlier than registration date |
| `3078` | `gstin-status` | GSTIN- {0} is cancelled and registration date is not available |
| `3079` | `fix-data` | For active GSTINs the document date should not be earlier than registration date |
| `4001` | `retry-later` | Error ocurred while creating Eway Bill |
| `5001` | `fix-data` | Application error, issue with application while processing the request. Please try again. If error persists kindly raise a ticket along with request JSON, error details and timestamp of the error occurrence. |
| `5002` | `retry-later` | Application error, issue with application while processing the request. Please try again. If error persists kindly raise a ticket along with request JSON, error details and timestamp of the error occurrence. |
| `9999` | `not-allowed` | Invoice is not active |

### einvoice/EWB — 77 codes

| Code | Category | Official message (verbatim) |
|---|---|---|
| `4000` | `not-allowed` | Status of the IRN is not active |
| `4001` | `retry-later` | Error ocurred while creating Eway Bill |
| `4002` | `already-done` | EwayBill is already generated for this IRN |
| `4003` | `not-found` | Requested IRN data is not available |
| `4004` | `retry-later` | Error while retrieving IRN details |
| `4005` | `not-found` | Eway Bill details are not found |
| `4006` | `integration` | Requesting parameter cannot be empty |
| `4007` | `not-found` | Requested e-Way Bill is not available |
| `4008` | `fix-data` | Please enter valid e-waybill number |
| `4009` | `fix-data` | E Way Bill can be generated provided at least HSN of one item belongs to goods. |
| `4010` | `not-allowed` | E-way Bill cannot generated for Debit Note, Credit Note and Services. |
| `4011` | `fix-data` | Vehicle number should be passed in case of transportation mode is Road. |
| `4012` | `fix-data` | The transport document number should be passed for transportation modes air and rail |
| `4013` | `fix-data` | The distance between the pincodes given is too high or low. |
| `4014` | `fix-data` | Invalid Vehicle Number |
| `4015` | `gstin-status` | EWayBill will not be generated for blocked User -{0} |
| `4016` | `fix-data` | Transport document date cannot be a future date |
| `4017` | `integration` | Incorrect date format |
| `4018` | `fix-data` | Invalid Transporter ID |
| `4019` | `fix-data` | Provide Transporter ID in order to generate Part A of e-Way Bill |
| `4020` | `fix-data` | Invalid vehicle type . |
| `4021` | `fix-data` | Transporter document date cannot be earlier than the invoice date. |
| `4022` | `fix-data` | vehicle type should be passed in case of transportation mode is Road. |
| `4023` | `fix-data` | The transport document date should be passed for of transportation modes air and rail. |
| `4024` | `fix-data` | Vehicle type should not be ODC when transmode is other than road and ship |
| `4025` | `auth` | Invalid User-Id |
| `4026` | `already-done` | Duplicate EwayBill for the given document numer, EwbNo - ({0}) |
| `4027` | `fix-data` | Transporter Id is mandatory for generation of Part A slip |
| `4028` | `fix-data` | Transport mode is mandatory as Vehicle Number/Transport Document Number is given |
| `4029` | `fix-data` | Valid distance to be sent in case of same pin codes, you cannot send 0 as distance in this case. |
| `4030` | `fix-data` | The distance between the pincodes {0} and {1} is not available in the system, you need to pass the actual distance. |
| `4031` | `fix-data` | Ship to details are mandatory for export transactions to generate e-Way Bill. |
| `4032` | `fix-data` | Ship to state code cannot be other country code(96) for e-Way Bill generation |
| `4033` | `fix-data` | Ship to PIN code cannot be 999999 for e-Way Bill generation |
| `4034` | `fix-data` | Since the you passed Supplier/Recepient/Dispatch from/Ship to Pincode as 999999, distance cannot be 0 |
| `4035` | `fix-data` | Dispatch state code cannot be other country code(96) for e-Way Bill generation |
| `4036` | `fix-data` | Dispatch PIN code cannot be 999999 for e-Way Bill generation |
| `4037` | `not-allowed` | You are not authorised to get data |
| `4038` | `fix-data` | The distance between the pincodes given is too high |
| `4039` | `fix-data` | Vehicle type can not be regular when transport mode is ship |
| `4040` | `fix-data` | For Ship Transport, either vehicle number or transport document number is required |
| `4041` | `not-allowed` | You don't have permission to get EWB details generated by main user. |
| `4042` | `fix-data` | Invalid RR number |
| `4043` | `not-allowed` | You cannot generate e-waybill with document date earlier than {0} days |
| `4044` | `fix-data` | Transportation mode should be road for Gold EwayBill |
| `4045` | `fix-data` | Transporter name should not be given for Gold e-Waybill |
| `4046` | `fix-data` | Transport document number should not be given for Gold e-Waybill |
| `4047` | `fix-data` | Transport document date should not be given for Gold e-Waybill |
| `4048` | `fix-data` | Vehicle number should not be given for Gold e-Waybill |
| `4049` | `fix-data` | Vehicle Type should not be given for Gold e-Waybill |
| `4050` | `fix-data` | Transportation mode is mandatory for Gold e-Waybill |
| `4051` | `fix-data` | Inter-State ewaybill is not allowed for gold |
| `4052` | `fix-data` | Transporter id should not be given for Gold e-Waybill |
| `4053` | `contact-helpdesk` | Could not cancel eway bill, please contact helpdesk. |
| `4054` | `not-allowed` | Gen mode should be irp in order to cancel ewaybill. |
| `4055` | `not-allowed` | You can cancel the ewaybill within 24 hours from Part B entry. |
| `4056` | `not-allowed` | Eway bill is already verified, you cannot cancel it. |
| `4057` | `not-allowed` | This eway bill is either not generated by you or cancelled. |
| `4058` | `unknown` | Check |
| `4059` | `fix-data` | Invalid reason. |
| `4060` | `fix-data` | Remarks is mandatory. |
| `4061` | `not-allowed` | This ewb is not generated through this IRP |
| `4062` | `throttled` | You have exceeded the limit for this operation |
| `4063` | `fix-data` | e-Waybill cannot be created with combination of sin items with other items |
| `4064` | `fix-data` | Seller Address is required for sin item |
| `4065` | `fix-data` | Buyer Address is required for sin item |
| `4066` | `fix-data` | Seller Location is required for sin item |
| `4067` | `fix-data` | Buyer Location is required for sin item |
| `4068` | `fix-data` | Quantity unit code is mandatory for sin item |
| `4069` | `fix-data` | Invalid unit code for sin item |
| `4070` | `fix-data` | Quantity is mandatory for sin item |
| `4071` | `fix-data` | SGST and CGST rates are mandatory for each sin item incase of intra state e-Waybill |
| `4072` | `fix-data` | IGST rates are mandatory for each sin item incase of inter state e-Waybill |
| `4073` | `fix-data` | Ship-to GSTIN is not required as the transaction type is {0} |
| `4074` | `fix-data` | Ship-to GSTIN is mandatory for the transaction type {0) |
| `4075` | `fix-data` | Invalid ship-to GSTIN |
| `4076` | `fix-data` | Bill-to and ship-to GSTIN should not be same for this transaction type |

### ewaybill/API — 373 codes

| Code | Category | Official message (verbatim) |
|---|---|---|
| `100` | `integration` | Invalid Json |
| `101` | `auth` | Invalid Username |
| `102` | `auth` | Invalid Password |
| `103` | `auth` | Invalid Client -Id |
| `104` | `auth` | Invalid Client -Id |
| `105` | `auth` | Invalid Token |
| `106` | `auth` | Token Expired |
| `107` | `auth` | Authentication failed. Pls. inform the helpdesk |
| `108` | `auth` | Invalid login credentials. |
| `109` | `auth` | Decryption of data failed |
| `110` | `auth` | Invalid Client-ID/Client-Secret |
| `111` | `auth` | GSTIN is not registerd to this GSP |
| `112` | `auth` | IMEI does not belong to the user |
| `113` | `integration` | os-type is mandatory in header |
| `114` | `integration` | Invalid os-type parameter value |
| `117` | `not-allowed` | This option is not enabled in Eway Bill 2 |
| `118` | `throttled` | Try after 5 minutes |
| `201` | `fix-data` | Invalid Supply Type |
| `202` | `fix-data` | Invalid Sub-supply Type |
| `203` | `fix-data` | Sub-transaction type does not belongs to transaction type |
| `204` | `fix-data` | Invalid Document type |
| `205` | `fix-data` | Document type does not match with transaction & Sub trans type |
| `206` | `fix-data` | Invaild Invoice Number |
| `207` | `fix-data` | Invalid Invoice Date |
| `208` | `fix-data` | Invalid Supplier GSTIN |
| `209` | `fix-data` | Blank Supplier Address |
| `210` | `fix-data` | Invalid or Blank Supplier PIN Code |
| `211` | `fix-data` | Invalid or Blank Supplier state Code |
| `212` | `fix-data` | Invalid Consignee GSTIN |
| `213` | `fix-data` | Invalid Consignee Address |
| `214` | `fix-data` | Invalid Consignee PIN Code |
| `215` | `fix-data` | Invalid Consignee State Code |
| `216` | `fix-data` | Invalid HSN Code |
| `217` | `fix-data` | Invalid UQC Code |
| `218` | `fix-data` | Invalid Tax Rate for Intra State Transaction |
| `219` | `fix-data` | Invalid Tax Rate for Inter State Transaction |
| `220` | `fix-data` | Invalid Trans mode |
| `221` | `fix-data` | Invalid Approximate Distance |
| `222` | `fix-data` | Invalid Transporter Id |
| `223` | `fix-data` | Invalid Transaction Document Number |
| `224` | `fix-data` | Invalid Transaction Date |
| `225` | `fix-data` | Invalid Vehicle Number Format |
| `226` | `fix-data` | Both Transaction and Vehicle Number Blank |
| `227` | `integration` | User Gstin cannot be blank |
| `228` | `integration` | User id cannot be blank |
| `229` | `fix-data` | Supplier name is required |
| `230` | `fix-data` | Supplier place is required |
| `231` | `fix-data` | Consignee name is required |
| `232` | `fix-data` | Consignee place is required |
| `233` | `fix-data` | Eway bill does not contains any items |
| `234` | `fix-data` | Total amount/Taxable amout is mandatory |
| `235` | `fix-data` | Tax rates for Intra state transaction is blank |
| `236` | `fix-data` | Tax rates for Inter state transaction is blank |
| `237` | `auth` | Invalid client -Id/client-secret |
| `238` | `auth` | Invalid auth token |
| `239` | `integration` | Invalid action |
| `240` | `contact-helpdesk` | Could not generate eway bill, pls contact helpdesk |
| `242` | `fix-data` | Invalid or Blank Officer StateCode |
| `243` | `fix-data` | Invalid or Blank IR Number |
| `244` | `fix-data` | Invalid or Blank Actual Vehicle Number Format |
| `245` | `integration` | Invalid Verification Date Format |
| `246` | `integration` | Invalid Vehicle Release Date Format |
| `247` | `integration` | Invalid Verification Time Format |
| `248` | `integration` | Invalid Vehicle Release Date Format |
| `249` | `fix-data` | Actual Value cannot be less than or equal to zero |
| `250` | `integration` | Invalid Vehicle Release Date Format |
| `251` | `fix-data` | CGST nad SGST TaxRate should be same |
| `252` | `fix-data` | Invalid CGST Tax Rate |
| `253` | `fix-data` | Invalid SGST Tax Rate |
| `254` | `fix-data` | Invalid IGST Tax Rate |
| `255` | `fix-data` | Invalid CESS Rate |
| `256` | `fix-data` | Invalid Cess Non Advol value |
| `278` | `fix-data` | User Gstin does not match with Transporter Id |
| `280` | `not-allowed` | Status is not ACTIVE |
| `281` | `not-allowed` | Eway Bill is already expired hence update transporter is not allowed. |
| `282` | `fix-data` | At least 4 digit HSN code is mandatory for taxpayers with turnover less than 5Cr. |
| `283` | `fix-data` | At least 6 digit HSN code is mandatory for taxpayers with turnover 5Cr. and above |
| `301` | `fix-data` | Invalid eway bill number |
| `302` | `fix-data` | Invalid transporter mode |
| `303` | `fix-data` | Vehicle number is required |
| `304` | `fix-data` | Invalid vehicle format |
| `305` | `fix-data` | Place from is required |
| `306` | `fix-data` | Invalid from state |
| `307` | `fix-data` | Invalid reason |
| `308` | `fix-data` | Invalid remarks |
| `309` | `contact-helpdesk` | Could not update vehicle details, pl contact helpdesk |
| `311` | `not-allowed` | Validity period lapsed, you cannot update vehicle details |
| `312` | `not-allowed` | This eway bill is either not generated by you or cancelled |
| `313` | `retry-later` | Error in validating ewaybill for vehicle updation |
| `315` | `not-allowed` | Validity period lapsed, you cannot cancel this eway bill |
| `316` | `not-allowed` | Eway bill is already verified, you cannot cancel it |
| `317` | `contact-helpdesk` | Could not cancel eway bill, please contact helpdesk |
| `320` | `fix-data` | Invalid state to |
| `321` | `fix-data` | Invalid place to |
| `322` | `retry-later` | Could not generate consolidated eway bill |
| `325` | `retry-later` | Could not retrieve data |
| `326` | `retry-later` | Could not retrieve GSTIN details for the given GSTIN number |
| `327` | `retry-later` | Could not retrieve data from hsn |
| `328` | `retry-later` | Could not retrieve transporter details from gstin |
| `329` | `retry-later` | Could not retrieve States List |
| `330` | `retry-later` | Could not retrieve UQC list |
| `331` | `retry-later` | Could not retrieve Error code |
| `334` | `retry-later` | Could not retrieve user details by userid |
| `336` | `retry-later` | Could not retrieve transporter data by gstin |
| `337` | `retry-later` | Could not retrieve HSN details for the given HSN number |
| `338` | `not-allowed` | You cannot update transporter details, as the current tranporter is already entered Part B details of the eway bill |
| `339` | `not-allowed` | You are not assigned to update the tranporter details of this eway bill |
| `341` | `not-allowed` | This e-way bill is generated by you and hence you cannot reject it |
| `342` | `not-allowed` | You cannot reject this e-way bill as you are not the other party to do so |
| `343` | `not-allowed` | This e-way bill is cancelled |
| `344` | `fix-data` | Invalid eway bill number |
| `345` | `not-allowed` | Validity period lapsed, you cannot reject the e-way bill |
| `346` | `not-allowed` | You can reject the e-way bill only within 72 hours from generated timel |
| `347` | `retry-later` | Validation of eway bill number failed, while rejecting ewaybill |
| `348` | `not-allowed` | Part-B is not generated for this e-way bill, hence rejection is not allowed. |
| `350` | `retry-later` | Could not generate consolidated eway bill |
| `351` | `fix-data` | Invalid state code |
| `352` | `fix-data` | Invalid rfid date |
| `353` | `fix-data` | Invalid location code |
| `354` | `fix-data` | Invalid rfid number |
| `355` | `fix-data` | Invalid Vehicle Number Format |
| `356` | `fix-data` | Invalid wt on bridge |
| `357` | `contact-helpdesk` | Could not retrieve eway bill details, pl. contact helpdesk |
| `358` | `fix-data` | GSTIN passed in request header is not matching with the user gstin mentioned in payload JSON |
| `359` | `fix-data` | User GSTIN should match to GSTIN(from) for outward transactions |
| `360` | `fix-data` | User GSTIN should match to GSTIN(to) for inward transactions |
| `361` | `fix-data` | Invalid Vehicle Type |
| `362` | `fix-data` | Transporter document date cannot be earlier than the invoice date |
| `363` | `not-allowed` | E-way bill is not enabled for intra state movement for you state |
| `364` | `retry-later` | Error in verifying eway bill |
| `365` | `retry-later` | Error in verifying consolidated eway bill |
| `366` | `not-allowed` | You will not get the ewaybills generated today, howerver you cann access the ewaybills of yester days |
| `367` | `retry-later` | Could not retrieve data for officer login |
| `368` | `retry-later` | Could not update transporter |
| `369` | `fix-data` | GSTIN/Transin passed in request header should match with the transported Id mentioned in payload JSON |
| `370` | `fix-data` | GSTIN/Transin passed in request header should not be the same as supplier(fromGSTIN) or recepient(toGSTIN) |
| `371` | `fix-data` | Invalid or Blank Supplier Ship-to State Code |
| `372` | `fix-data` | Invalid or Blank Consignee Ship-to State Code |
| `373` | `fix-data` | The Supplier ship-to state code should be Other Country for Sub Supply Type- Export |
| `374` | `fix-data` | The Consignee pin code should be 999999 for Sub Supply Type- Export |
| `375` | `fix-data` | The Supplier ship-from state code should be Other Country for Sub Supply Type- Import |
| `376` | `fix-data` | The Supplier pin code should be 999999 for Sub Supply Type- Import |
| `377` | `fix-data` | Sub Supply Type is mentioned as Others, the description for that is mandatory |
| `378` | `fix-data` | The supplier or conginee belong to SEZ, Inter state tax rates are applicable here |
| `379` | `not-allowed` | Eway Bill can not be extended.. Already Cancelled |
| `380` | `not-allowed` | Eway Bill Can not be Extended. Not in Active State |
| `381` | `not-allowed` | There is No PART-B/Vehicle Entry.. So Please Update Vehicle Information.. |
| `382` | `not-allowed` | You Cannot Extend as EWB can be Extended only 8 hour before or after w.r.t Validity of EWB..!! |
| `383` | `contact-helpdesk` | Error While Extending..Please Contact Helpdesk. |
| `384` | `not-allowed` | You are not current transporter or Generator of the ewayBill, with no transporter details. |
| `385` | `fix-data` | For Rail/Ship/Air transDocDate is mandatory |
| `386` | `fix-data` | Reason Code, Remarks is mandatory. |
| `387` | `not-found` | No Record Found for Entered consolidated eWay bill. |
| `388` | `contact-helpdesk` | Exception in regenration of consolidated eWayBill!!Please Contact helpdesk |
| `389` | `fix-data` | Remaining Distance Required |
| `390` | `fix-data` | Remaining Distance Can not be greater than Actual Distance. |
| `391` | `not-found` | No eway bill of specified tripsheet, neither ACTIVE nor not Valid. |
| `392` | `not-allowed` | Tripsheet is already cancelled, Hence Regeration is not possible |
| `393` | `fix-data` | Invalid GSTIN |
| `394` | `fix-data` | For other than Road Transport, TransDoc number is required |
| `395` | `fix-data` | Eway Bill Number should be numeric only |
| `396` | `fix-data` | Either Eway Bill Number Or Consolidated Eway Bill Number is required for Verification |
| `397` | `retry-later` | Error in Multi Vehicle Movement Initiation |
| `398` | `fix-data` | Eway Bill Item List is Empty |
| `399` | `fix-data` | Unit Code is not matching with any of the Unit Code from ItemList |
| `400` | `fix-data` | total quantity is exceeding from multi vehicle movement initiation quantity |
| `401` | `retry-later` | Error in inserting multi vehicle details |
| `402` | `fix-data` | total quantity can not be less than or equal to zero |
| `403` | `retry-later` | Error in multi vehicle details |
| `405` | `not-found` | No record found for multi vehicle update with specified ewbNo groupNo and old vehicleNo/transDocNo with status as ACT |
| `406` | `fix-data` | Group number cannot be empty or zero |
| `407` | `fix-data` | Invalid old vehicle number format |
| `408` | `fix-data` | Invalid new vehicle number format |
| `409` | `fix-data` | Invalid old transDoc number |
| `410` | `fix-data` | Invalid new transDoc number |
| `411` | `not-found` | Multi Vehicle Initiation data is not there for specified ewayBill and group No |
| `412` | `not-allowed` | Multi Vehicle movement is already Initiated,hence PART B updation not allowed |
| `413` | `fix-data` | Unit Code is not matching with unit code of first initiaton |
| `415` | `retry-later` | Error in fetching in verification data for officer |
| `416` | `fix-data` | Date range is exceeding allowed date range |
| `417` | `not-found` | No verification data found for officer |
| `418` | `not-found` | No record found |
| `419` | `retry-later` | Error in fetching search result for taxpayer/transporter |
| `420` | `fix-data` | Minimum six character required for Tradename/legalname search |
| `421` | `fix-data` | Invalid pincode |
| `422` | `fix-data` | Invalid mobile number |
| `423` | `retry-later` | Error in fetching ewaybill list by vehicle number |
| `424` | `fix-data` | Invalid PAN number |
| `425` | `retry-later` | Error in fetching Part A data by IR Number |
| `426` | `fix-data` | For Vehicle Released vehicle release date and time is mandatory |
| `427` | `retry-later` | Error in saving Part-A verification Report |
| `428` | `fix-data` | For Goods Detained,Vehicle Released feild is mandatory |
| `429` | `retry-later` | Error in saving Part-B verification Report |
| `430` | `fix-data` | Goods Detained Field required. |
| `431` | `already-done` | Part-A for this ewaybill is already generated by you. |
| `432` | `fix-data` | invalid vehicle released value |
| `433` | `fix-data` | invalid goods detained parameter value |
| `434` | `fix-data` | invalid ewbNoAvailable parameter value |
| `435` | `not-allowed` | Part B is already updated,hence updation is not allowed |
| `436` | `fix-data` | Invalid Consignee ship to State Code for the given pincode |
| `437` | `fix-data` | Invalid Supplier ship from State Code for the given pincode |
| `438` | `fix-data` | Invalid Latitude |
| `439` | `fix-data` | Invalid Longitude |
| `440` | `retry-later` | Error in inserting in verification data |
| `441` | `fix-data` | Invalid verification type |
| `442` | `retry-later` | Error in inserting verification details |
| `443` | `fix-data` | invalid invoice available value |
| `444` | `not-allowed` | This eway bill cannot be cancelled as it is generated from NIC1 |
| `445` | `not-allowed` | This eway bill cannot be cancelled as it is generated from NIC2 |
| `446` | `not-allowed` | Transport detais cannot be updated here as it is generated from NIC1 |
| `447` | `not-allowed` | Transport detais cannot be updated here as it is generated from NIC2 |
| `448` | `not-allowed` | Part B cannot be updated as this Ewaybill Part A is generated in NIC1 |
| `449` | `not-allowed` | Part B cannot be updated as this Ewaybill Part A is generated in NIC2 |
| `450` | `fix-data` | For outward-export ewaybill, To GSTIN has to be either URP or SEZ |
| `451` | `fix-data` | For inward-import ewaybill, From GSTIN has to be either URP or SEZ |
| `452` | `not-allowed` | Consolidate Ewaybill cannot be generated as this Ewaybill is generated in NIC2 |
| `453` | `not-allowed` | You cannot consolidate ewaybills generated at NIC1 and NIC2 together |
| `600` | `fix-data` | Invalid category |
| `601` | `integration` | Invalid date format |
| `602` | `fix-data` | Invalid File Number |
| `603` | `fix-data` | For file details file number is required |
| `604` | `already-done` | E-way bill(s) are already generated for the same document number, you cannot generate again on same document number |
| `607` | `fix-data` | dispatch from gstin is mandatary |
| `608` | `fix-data` | ship to from gstin is mandatary |
| `609` | `fix-data` | invalid ship to from gstin |
| `610` | `fix-data` | invalid dispatch from gstin |
| `611` | `fix-data` | Invalid document type for the given supply type |
| `612` | `fix-data` | Invalid transaction type |
| `613` | `retry-later` | Exception in getting Officer Role |
| `614` | `fix-data` | Transaction type is mandatory |
| `615` | `fix-data` | Dispatch From GSTIN cannot be sent as the transaction type selected is Regular |
| `616` | `fix-data` | Ship to GSTIN cannot be sent as the transaction type selected is Regular |
| `617` | `fix-data` | Bill-from and dispatch-from gstin should not be same for this transaction type |
| `618` | `fix-data` | Bill-to and ship-to gstin should not be same for this transaction type |
| `619` | `fix-data` | Transporter Id is mandatory for generation of Part A slip |
| `620` | `fix-data` | Total invoice value cannot be less than the sum of total assessible value and tax values |
| `621` | `fix-data` | Trans mode is mandatory since vehicle number is present |
| `622` | `fix-data` | Trans mode is mandatory since trans doc number is present |
| `623` | `fix-data` | IGST value is not applicable for Intra State Transaction |
| `624` | `fix-data` | SGST/CGST value is not applicable for Inter State Transaction |
| `627` | `fix-data` | Total value should not be negative |
| `628` | `fix-data` | Total invoice value should not be negative |
| `629` | `fix-data` | IGST value should not be negative |
| `630` | `fix-data` | CGST value should not be negative |
| `631` | `fix-data` | SGST value should not be negative |
| `632` | `fix-data` | Cess value should not be negative |
| `633` | `fix-data` | Cess non advol should not be negative |
| `634` | `fix-data` | Vehicle type should not be ODC when transmode is other than road |
| `635` | `not-allowed` | You cannot update part B, as the current tranporter is already entered Part B details of the eway bill |
| `636` | `not-allowed` | You are not assigned to update part B |
| `637` | `not-allowed` | You cannot extend ewaybill, as the current tranporter is already entered Part B details of the ewaybill |
| `638` | `fix-data` | Transport mode is mandatory as Vehicle Number/Transport Document Number is given |
| `640` | `fix-data` | Tolal Invoice Value is mandatory |
| `641` | `fix-data` | For outward CKD/SKD/Lots supply type, Bill To state should be as Other Country, since the Bill To GSTIN given is of SEZ unit |
| `642` | `fix-data` | For inward CKD/SKD/Lots supply type, Bill From state should be as Other Country, since the Bill From GSTIN given is of SEZ unit |
| `643` | `fix-data` | For regular transaction, Bill from state code and Dispatch from state code should be same |
| `644` | `fix-data` | For regular transaction, Bill to state code and Ship to state code should be same |
| `645` | `not-allowed` | You cannot do Multi Vehicle movement, as current transporeter already entered part B |
| `646` | `not-allowed` | You are not assigned to do multi vehicle movement |
| `647` | `contact-helpdesk` | Could not insert RFID data, pl. contact helpdisk |
| `648` | `not-allowed` | Multi Vehicle movement is already Initiated,hence generation of consolidated eway bill is not allowed |
| `649` | `not-allowed` | You cannot generate consolidated eway bill , as the current tranporter is already entered Part B details of the eway bill |
| `650` | `not-allowed` | You are not assigned to generate consolidated ewaybill |
| `651` | `fix-data` | For Category Part-A or Part-B ewbdt is mandatory |
| `652` | `fix-data` | For Category EWB03 procdt is mandatory |
| `654` | `gstin-status` | This GSTIN has generated a common Enrolment Number. Hence you are not allowed to generate Eway bill |
| `655` | `gstin-status` | This GSTIN has generated a common Enrolment Number. Hence you cannot mention it as a tranporter |
| `656` | `not-allowed` | This Eway Bill does not belongs to your state |
| `657` | `not-allowed` | Eway Bill Category wise details will be available after 4 days only |
| `658` | `throttled` | You are blocked for accesing this API as the allowed number of requests has been exceeded for this duration |
| `659` | `fix-data` | Remarks is mandatory |
| `670` | `fix-data` | Invalid Month Parameter |
| `671` | `fix-data` | Invalid Year Parameter |
| `672` | `fix-data` | User Id is mandatory |
| `673` | `retry-later` | Error in getting officer dashboard |
| `675` | `retry-later` | Error in getting EWB03 details by acknowledgement date range |
| `676` | `retry-later` | Error in getting EWB Not Available List by entered date range |
| `677` | `retry-later` | Error in getting EWB Not Available List by closed date range |
| `678` | `fix-data` | Invalid Uniq No |
| `679` | `fix-data` | Invalid EWB03 Ack No |
| `680` | `fix-data` | Invalid Close Reason |
| `681` | `retry-later` | Error in Closing EWB Verification Data |
| `682` | `not-found` | No Record available to Close |
| `683` | `retry-later` | Error in fetching WatchList Data |
| `685` | `retry-later` | Exception in fetching dashboard data |
| `700` | `not-allowed` | You are not assigned to extend e-waybill |
| `701` | `fix-data` | Invalid Vehicle Direction |
| `702` | `fix-data` | The distance between the pincodes given is too high |
| `703` | `not-allowed` | Since the consignor is Composite Taxpayer, inter state transactions are not allowed |
| `704` | `not-allowed` | Since the consignor is Composite Taxpayer, Tax rates should be zero |
| `705` | `fix-data` | Invalid transit type |
| `706` | `fix-data` | Address Line1 is mandatory |
| `707` | `fix-data` | Address Line2 is mandatory |
| `708` | `fix-data` | Address Line3 is mandatory |
| `709` | `fix-data` | Pin to pin distance is not available for the given pin codes |
| `710` | `fix-data` | Invalid state code for the given pincode |
| `711` | `fix-data` | Invalid value for isInTransit field |
| `712` | `fix-data` | Transit Type is not required as the good are not in movement |
| `713` | `fix-data` | Transit Address is not required as the good are not in movement |
| `714` | `not-allowed` | Document type - Tax Invoice is not allowed for composite tax payer |
| `715` | `gstin-status` | The Consignor GSTIN is blocked from e-waybill generation as Return is not filed for past 2 months |
| `716` | `gstin-status` | The Consignee GSTIN is blocked from e-waybill generation as Return is not filed for past 2 months |
| `717` | `gstin-status` | The Transporter GSTIN is blocked from e-waybill generation as Return is not filed for past 2 months |
| `718` | `gstin-status` | The User GSTIN is blocked from Transporter Updation as Return is not filed for past 2 months |
| `719` | `gstin-status` | The Transporter GSTIN is blocked from Transporter Updation as Return is not filed for past 2 months |
| `720` | `not-allowed` | E Way Bill should be generated as part of IRN generation or with reference to IRN in E Invoice System, Since Supplier is enabled for E Invoice. |
| `721` | `fix-data` | The distance between the given pincodes are not available in the system. Please provide distance. |
| `722` | `gstin-status` | Consignee GSTIN is cancelled and document date is later than the De-Registration date |
| `724` | `fix-data` | HSN code of at least one item should be of goods to generate e-Way Bill |
| `726` | `fix-data` | Vehicle type can not be regular when transportation mode is ship |
| `727` | `fix-data` | For Ship Transport, either vehicle number or transport document number is required |
| `728` | `not-allowed` | You can cancel the ewaybill within 24 hours from Part B entry |
| `729` | `fix-data` | TransDoc date is required for transport mode Ship as the transport document number is provided |
| `801` | `fix-data` | Transporter id should not be given for Gold e-Waybill |
| `802` | `fix-data` | Transporter name should not be given for Gold e-Waybill |
| `803` | `fix-data` | Transport document number should not be given for Gold e-Waybill |
| `804` | `fix-data` | Transport docuemnt date should not be given for Gold e-Waybill |
| `805` | `fix-data` | Vehicle number should not be given for Gold e-Waybill |
| `806` | `fix-data` | Vehicle Type should not be given for Gold e-Waybill |
| `807` | `fix-data` | Transportation mode is mandatory for Gold e-Waybill |
| `808` | `fix-data` | Inter-State ewaybill is not allowed for gold |
| `809` | `fix-data` | Other items are not allowed with Gold e-Waybill |
| `810` | `not-allowed` | Transporter can not be updated for Gold e-Waybill |
| `811` | `not-allowed` | Vehicle can not be updated for Gold e-Waybill |
| `812` | `not-allowed` | Consolidated e-Waybill cannot be generated for Gold e-Waybill |
| `813` | `throttled` | Duplicate request at the same time |
| `814` | `not-allowed` | Multi Vehicle Movement cannot be initiated for Gold e-Waybill |
| `815` | `fix-data` | Tranportation mode should be road for Gold e-Waybill |
| `816` | `fix-data` | Tranportation mode should be road for extending Gold e-Waybill |
| `817` | `not-allowed` | MultiVehicleMovement cannot be initiated.Eway Bill is not in Active State |
| `818` | `not-allowed` | Validity period lapsed.Cannot generate consolidated Eway Bill |
| `819` | `not-allowed` | Ewaybill cannot be generated for the document date which is prior to 01/07/2017 |
| `820` | `not-allowed` | You cannot generate e-Waybill with document date earlier than 180 days |
| `821` | `not-allowed` | e-Waybill cannot be extended as the allowed limit is 360 days |
| `823` | `fix-data` | Invalid RR No. |
| `826` | `integration` | Pls provide the required parameter or payload. |
| `827` | `not-allowed` | You are not authorized to close the e-way bill. |
| `828` | `fix-data` | Closure Date cannot be earlier than EwayBill Date. |
| `829` | `already-done` | The e-way bill is already closed. |
| `830` | `not-allowed` | You cannot close the e-Waybill as there is no PART-B/Vehicle entry. |
| `831` | `fix-data` | e-Waybill cannot be created with combination of sin items with other items. |
| `832` | `fix-data` | From address is required for sin item. |
| `833` | `fix-data` | From Place is required for sin item . |
| `834` | `fix-data` | To address is required for sin item . |
| `835` | `fix-data` | To Place is required for sin product. |
| `836` | `fix-data` | Quantity unit code is mandatory for sin item . |
| `837` | `fix-data` | Invalid unit code for sin item . |
| `838` | `fix-data` | Quantity is mandatory for sin item. |
| `839` | `fix-data` | SGST and CGST rates are mandatory for each sin item incase of intra state e-Waybill. |
| `840` | `fix-data` | IGST rates are mandatory for each sin item incase of inter state e-Waybill . |
| `841` | `contact-helpdesk` | Could not close e-waybill, contact helpdesk. |
| `842` | `fix-data` | Closure date cannot be later than the current date. |
| `843` | `not-allowed` | You cannot cancel ewaybill, as it is already closed. |
| `844` | `not-allowed` | You cannot extend ewaybill, as it is already closed. |
| `845` | `not-allowed` | Consolidated EwayBill cannot be generated as it is already closed. |
| `846` | `not-allowed` | Muti Vehicle cannot be added, as it is already closed |
| `847` | `not-allowed` | Muti Vehicle Initiation cannot be done, as it is already closed. |
| `848` | `not-allowed` | Multi Vehicle cannot be updated, as it is already closed. |
| `849` | `not-allowed` | You cannot reject ewaybill, as it is already closed. |
| `850` | `not-allowed` | You cannot update transporter, as it is already closed. |
| `851` | `not-allowed` | You cannot update vehicle details, as it is already closed. |
| `852` | `not-allowed` | Ewaybill is not generated by you or not valid. |
| `853` | `not-allowed` | e-Way bill cannot be closed as it is already rejected |
| `854` | `integration` | Closure Date format is invalid. Allowed format is dd/MM/yyyy. |
| `855` | `fix-data` | Supplier GSTIN could not be TDS or TCS. |
| `856` | `not-allowed` | Suppliers enabled for eInvoicing should generate E Way Bills for sin products based on IRNs for B2B/ Export transactions. |
| `857` | `fix-data` | SHIP TO - state code is not valid statecode for BILL\_TO\_SHIP\_TO and Combination transaction types. |
| `858` | `fix-data` | SHIP TO - PIN code must belong to the ActToStateCode for BILL\_TO\_SHIP\_TO and Combination transaction types. |
| `861` | `fix-data` | Closure Date field is mandatory for closing e-way bill. |
| `862` | `fix-data` | Remarks field is mandatory for closing e-way bill. |
| `863` | `fix-data` | Ship to tradename is mandatory for BILL\_TO\_SHIP\_TO and Combination transaction types. |
| `864` | `fix-data` | Ship to GSTIN cannot be sent as the transaction type selected is bill from and dispatch from. |
| `865` | `fix-data` | BILL TO - GSTIN state code does not match with the to-state code passed for BILL\_TO\_SHIP\_TO and Combination transaction types. |
