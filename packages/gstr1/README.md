# @india-gst-kit/gstr1

Builds a GSTR-1 return from [`@india-gst-kit/model`](../model) `GstDocument`s for one monthly return period and renders it two ways. Spec: [`docs/specs/gstr1.md`](../../docs/specs/gstr1.md). Every legal/official fact is **UNVERIFIED — needs CA** until signed off in [`docs/legal-facts.md`](../../docs/legal-facts.md).

```ts
import {
  buildGstr1,
  toApiSavePayload,
  toOfflineUploadJson,
  serializeGstr1,
} from "@india-gst-kit/gstr1";

const built = buildGstr1({ gstin, period: "102026", documents }); // classify + aggregate, once
if (built.ok) {
  const api = toApiSavePayload(built.value); // GSTN "Save GSTR1 data" v5.0 payload
  const offline = toOfflineUploadJson(built.value); // what the offline tool 3.2.4 writes (v4.1 shapes)
  if (api.ok) console.log(serializeGstr1(api.value)); // amounts are written as exact JSON number literals
}
```

- `buildGstr1` never throws on data problems and collects **all** issues (`Gstr1Issue[]`).
- Sections: `b2b`, `b2cl`, `b2cs`, `cdnr`, `cdnur`, `exp`, `hsn` (B2B/B2C split), `doc_issue`. Return periods from `052025`.
- Both outputs come from the same internal `Gstr1Return` and differ only in the `doc_issue` container (`doc_det_new` with a string `doc_num` vs `doc_det` with an integer one) and the header (`version`/`hash`). Each is validated against a Zod transcription of its schema, and the test suite validates every output against the real S5/S4 JSON Schemas.
- `parseApiSavePayloadJson` / `parseOfflineUploadJson` keep exact number text (`9999999999999.99` survives a round trip).

Not included: amendments, advances, nil-rated supplies (bills of supply), e-commerce, `diff_percent`, IRN fields, the delete flow, file splitting, HTTP/encryption (`gsp`). Whether the portal's offline upload accepts the offline-tool shape is **unverified** (spec Q-2): a live upload writes into a real draft return and must only be done with a CA, never by a test.
