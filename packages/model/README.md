# @india-gst-kit/model

One GST document (tax invoice, bill of supply, credit/debit note) as [Zod 4](https://zod.dev) schemas plus pure helpers: state/UQC tables, GSTIN validation, intra/inter-state decision, GST split arithmetic with `decimal.js`.

```ts
import { parseGstDocument } from "@india-gst-kit/model";

const result = parseGstDocument(input);
if (!result.success) console.log(result.error.issues); // each issue has a path
```

- Money, quantity, rate and date values are strings (`"1180.00"`, `"2026-04-20"`).
- Unknown keys are rejected. An invoice-level discount must be apportioned into line `discount` by the caller.
- No rate list: the model validates arithmetic, it does not decide which rate applies.
- Every legal fact is **UNVERIFIED — needs CA**; see the repository's `docs/legal-facts.md`.

`zod` is a peer dependency (`^4.0.0`). ESM only. MIT.
