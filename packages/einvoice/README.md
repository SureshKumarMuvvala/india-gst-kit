# @india-gst-kit/einvoice

Maps a [`@india-gst-kit/model`](../model) `GstDocument` to the GST e-invoice (IRN) request, validates any IRN request offline, and decodes the signed JWTs of the response. Spec: [`docs/specs/einvoice.md`](../../docs/specs/einvoice.md). Every legal/official fact is **UNVERIFIED — needs CA** until signed off in [`docs/legal-facts.md`](../../docs/legal-facts.md).

```ts
import { parseGstDocument } from "@india-gst-kit/model";
import { toIrnRequest, serializeIrnRequest, validateIrnRequest } from "@india-gst-kit/einvoice";

const doc = parseGstDocument(input);
if (doc.success) {
  const r = toIrnRequest(doc.data); // { ok: true, value } | { ok: false, issues }
  if (r.ok) console.log(serializeIrnRequest(r.value)); // amounts are written as exact JSON number literals
}
```

- `toIrnRequest(doc)` — mapping; rejects documents that cannot be e-invoiced (B2C, bill of supply, SEZ-unit or composition supplier, …) and runs the validation on its own output.
- `validateIrnRequest(payload, options?)` — schema (source C) plus rules V1–V28 including the portal's ±1 rupee tolerance. `rupeeTolerance` / `withinTolerance` are exported.
- `serializeIrnRequest` / `parseIrnRequestJson` — JSON text with exact decimals (no `Number` round trip).
- `decodeJwt`, `decodeSignedInvoice`, `decodeSignedQrCode` — **decode only; the signature is not verified** (`signatureVerified` is always `false`). Needs NIC's public key in `sources/` first.

Not included: HTTP/GSP calls, IRN hash, e-way bill, export details, checks that need the portal's databases (spec §5.5).
