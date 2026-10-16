# @india-gst-kit/ewaybill

Maps a [`@india-gst-kit/model`](../model) `GstDocument` plus movement details to the e-way bill payloads, validates payloads (ours or anyone else's) against the published schemas and the offline-checkable rules, and parses the decrypted responses. Spec: [`docs/specs/ewaybill.md`](../../docs/specs/ewaybill.md). Every legal/official fact is **UNVERIFIED — needs CA** until signed off in [`docs/legal-facts.md`](../../docs/legal-facts.md). This is not tax advice.

```ts
import { ewbRoute, toEwbRequest, serializeEwbRequest } from "@india-gst-kit/ewaybill";

const movement = {
  transport: { distanceKm: "150", mode: "ROAD", vehicleNo: "KA01AB1234", vehicleType: "REGULAR" },
};
ewbRoute(doc, { supplierEInvoiceEnabled: false }); // { route: "GENERATE" | "IRN" | "NONE", reasons }
const r = toEwbRequest(doc, movement, { supplierEInvoiceEnabled: false });
if (r.ok)
  console.log(serializeEwbRequest(r.value)); // compact JSON, exact decimals
else console.log(r.issues);
```

- **Three routes** (`ewbRoute`): the Generate E-way Bill API (`toEwbRequest`), EWB generation by IRN (`toEwbByIrnRequest`), and the `EwbDtls` block of an IRN request (`toIrnEwbDtls`, validated like the others). Whether the supplier is enabled for e-invoicing is portal data, so it is an input.
- **Validation**: `validateEwbRequest`, `validateEwbByIrnRequest`, `validateEwbDtls` return `{ ok, value?, issues }`. Each issue has a stable `rule` (`S-…` schema, `V-T…` transport, `V-G…` Generate, `V-B…` by-IRN) and a severity; warnings never make `ok` false.
- **JSON**: numbers are strings in memory and raw number literals on the wire (`serializeEwbRequest`, `parseEwbRequestJson`, and the by-IRN equivalents). `transDistance` is a JSON string on the Generate route and `Distance` a JSON number on the IRN routes, as the schemas say.
- **Responses**: `parseEwbResponseData`, `parseEwbByIrnResponseData` parse the decrypted `data`; unknown keys are warnings.
- No function throws on bad data; a mapper never truncates or alters it.

Not included: deciding **whether** an e-way bill is required, inward e-way bills, challans and bills of entry, HTTP/encryption (`gsp`), Part-B update/cancel/extend, validity calculation, and everything that needs the portal's databases (Vahan, PIN and HSN masters, GSTIN status, PIN-to-PIN distance) — spec §1 and §9.

A leading-zero HSN (chapters 01–09) cannot be sent on the Generate route (`hsnCode` is a JSON number), so it is a mapping error, `HSN_LEADING_ZERO`.
