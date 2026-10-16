# @india-gst-kit/recon

Parses a GSTR-2B "Get All Details" response (schema v4.5, Draft) and reconciles a purchase register of [`@india-gst-kit/model`](../model) `GstDocument`s against it. Spec: [`docs/specs/recon.md`](../../docs/specs/recon.md). Every legal/official fact is **UNVERIFIED — needs CA** until signed off in [`docs/legal-facts.md`](../../docs/legal-facts.md). This is not tax advice.

```ts
import { parseGstr2bJson, reconcile, summarise } from "@india-gst-kit/recon";

const parsed = parseGstr2bJson(text); // { ok, value?, raw, issues }
if (parsed.ok && parsed.value) {
  const result = reconcile(register, parsed.value, { amountTolerance: "0.00" });
  // matched · matchedWithDifferences · possibleMatches · in2bOnly · inRegisterOnly · excluded · issues
  console.log(summarise(result));
}
```

- `parseGstr2bJson(text)` — money stays an exact string (numbers are read from their source text); never throws on bad data. Typed sections: B2B, B2BA, CDNR, CDNRA, each from `docdata`, `docRejdata` and the `itcrev` nodes. Other sections stay in `raw`.
- `reconcile(register, gstr2b | gstr2b[], options?)` — exact match on supplier GSTIN + document type + normalised number + date; then amount and place-of-supply / reverse-charge differences; then _suggested_ matches (`AMENDED_FROM`, `DATE_DIFFERS`, `TYPE_DIFFERS`, `NUMBER_DIFFERS`, `NUMBER_LOOSE`) that are never promoted to matched. Every document and record lands in exactly one bucket.
- `summarise(result)` — counts per bucket and per-field totals of the amount differences.
- `normaliseDocNumber`, `looseDocNumber` — the comparison keys.

**Never decides ITC.** `itcavl`, `rsn`, `diffprcnt`, `imsStatus`, … are copied through unchanged next to the register data; classification ignores them, and the package computes no "eligible" or "claimable" figure.

The register must already consist of validated `GstDocument`s (`parseGstDocument`); `reconcile` does not re-parse them.

Not included: fetching 2B, IMS actions, GSTR-3B, ISD / imports / ECO sections and the summaries (kept in `raw`), GSTR-2A (spec §10).
