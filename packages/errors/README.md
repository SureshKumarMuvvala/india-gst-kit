# @india-gst-kit/errors

The official **e-invoice (IRP)** and **e-way bill** API error-code lists (India) as verbatim data, with a lookup that
an app can show and act on. Spec: [`docs/specs/errors.md`](../../docs/specs/errors.md).

> Every official text is **UNVERIFIED — needs CA** (`docs/legal-facts.md`) and unverified against live calls. The
> **categories** and **plain-English messages** are this library's design, **not official**. This is not legal or
> tax advice: nothing here decides taxability, a tax rate, ITC or whether to deal with a GSTIN.

- Four lists, retrieved 2026-10-18 and generated from `sources/errors/*.json` (608 rows): e-invoice `VITAL` (auth,
  user, GSTIN), `INV` (IRN generate/cancel/get), `EWB` (e-way bill through the IRP), and the e-way bill system `API`
  list. Text is copied exactly, spelling mistakes included.
- Keyed by **system + list + code**. e-invoice and e-way bill codes are different systems and are never looked up in
  each other's lists. Some e-invoice codes are in two lists (e.g. `5001`); the operation decides which wins.
- Every code has one **category** (ours): `fix-data`, `gstin-status`, `not-allowed`, `already-done`, `not-found`,
  `auth`, `throttled`, `retry-later`, `contact-helpdesk`, `integration`, `unknown` (plus `outcome-unknown`, used by
  clients only).
- `{0}`-style placeholders are filled in one pass with cleaned, length-capped values. Results are **plain text**:
  escape them when you render HTML.
- No runtime dependency besides the `zod` peer; works in Node and in the browser.

```ts
import { describeError } from "@india-gst-kit/errors";

const d = describeError("einvoice", "2150", { op: "einvoice.generateIrn" });
d.category; // "already-done" — fetch the existing IRN, do not resend
d.userMessage; // "The portal says this was already done. Fetch the existing record instead of sending it again."
d.officialMessage; // "Duplicate IRN"
d.officialResolution; // the portal's own resolution text, verbatim
d.source; // { url: "https://einvoice1.gst.gov.in/others/geterrorcodes/INV", retrieved: "2026-10-18", … }

describeError("ewaybill", "99999"); // { known: false, category: "unknown", officialMessage: null, … } — never throws
```

Show `userMessage` first, and keep the official text one click away (the message the portal returned, if any, else
`officialMessage`, plus the code). For INV `2240` the official resolution lists rates: **it is not a rate list**
(note `X7-not-a-rate-list`); show it with "This list is from the portal's error page. It is not a list of applicable
rates."

`SESSION_ERROR_CODES` (`einvoice: 1005`; `ewaybill: 105, 106, 238`) are the token codes to pass to
`@india-gst-kit/gsp`'s `authErrorCodes` if you want a re-login on them (unverified until a live call).

Regenerate the data after a new capture (with a new checksum in `sources/errors/SHA256SUMS`):
`node packages/errors/scripts/gen-error-data.mjs`.
