# @india-gst-kit/gstr3b

Assembles and checks a GSTR-3B return: outward figures derived from a [`@india-gst-kit/gstr1`](../gstr1) return, ITC and every other tax decision supplied by the caller, a provenance trail for each amount, the Save GSTR3B v7.1 payload (Draft schema) and a per-box diff against the portal's Auto Calc v7.1 response. Spec: [`docs/specs/gstr3b.md`](../../docs/specs/gstr3b.md). Every legal/official fact is **UNVERIFIED — needs CA** until signed off in [`docs/legal-facts.md`](../../docs/legal-facts.md). This is not tax advice.

```ts
import {
  outwardFromGstr1,
  sumGstr2bRecords,
  assembleGstr3b,
  toSavePayload,
  serializeGstr3b,
  parseAutoCalcJson,
  compareWithAutoCalc,
} from "@india-gst-kit/gstr3b";

const outward = outwardFromGstr1(gstr1Return, {
  recipientTypes: { [compositionGstin]: "COMPOSITION" },
});
const itc = sumGstr2bRecords(chosenRecords, { label: "2B Oct, CA-approved" }); // totals only; you choose the records
const draft = assembleGstr3b({
  gstin,
  period: "102026",
  outward: outward.ok ? outward.value : undefined,
  fromGstr2b: [{ box: "4A.OTH", sign: "+", totals: itc, groupIndexes: [0] }],
  entries: [
    {
      box: "4B.RUL",
      label: "CA working 10/2026",
      amounts: { igst: "120.00", cgst: "0.00", sgst: "0.00", cess: "0.00" },
    },
  ],
  itcNet: "COMPUTE", // 4C = Σ4A − Σ4B
});
if (draft.ok) {
  const payload = toSavePayload(draft.value.return);
  if (payload.ok) send(serializeGstr3b(payload.value)); // money as exact 2-dp JSON number literals
}
const portal = parseAutoCalcJson(autoCalcText);
if (portal.ok && draft.ok)
  compareWithAutoCalc(draft.value.return, portal.value, { tolerance: "0.00" });
```

**Never decides tax.** Taxability, ITC eligibility, reversals, ineligible ITC, interest and late fee are never computed: 4A–4D, 5, 5.1, 3.1 (c)–(e), 3.1 (d) and 3.1.1 are filled only by labelled caller entries (or, for 4A and 3.1 (d), by totals of 2B records the caller selected). Composition and UIN-holder recipients come only from `recipientTypes`. The compare never corrects anything.

- `outwardFromGstr1(gstr1, ctx)` — 3.1 (a), 3.1 (b) and 3.2 from the GSTR-1 tables `gstr1` builds (4A, 4B, 5A, 6A–6C, 7A(1), 7B(1), 9B), using only the GSTR-1 → 3B mapping in the Auto Calc schema; credit notes subtract. Lists what it cannot place (`unmapped`) and the Auto Calc tables it does not cover (`notCovered`).
- `sumGstr2bRecords(records)` — groups [`@india-gst-kit/recon`](../recon) `Gstr2bRecord`s by document type × `itcavl` × reverse charge × origin × period. Never filters or nets.
- `assembleGstr3b(input)` — sums trail entries into a `Gstr3bReturn`; every box equals the sum of its entries.
- `validateGstr3b(ret | draft)` — money format and sign per SV field, `ret_period`, GSTIN (model check digit and the 3B PAN-structured pattern), 3.2 place of supply, duplicate POS, trail sums; warnings for 4C ≠ 4A − 4B and Σ3.2 > 3.1 (a). No CGST = SGST check (no source).
- `toSavePayload` / `serializeGstr3b` / `parseSavePayloadJson` — the complete SV v7.1 payload, lossless.
- `parseAutoCalcJson` / `compareWithAutoCalc` — strict lossless parse of all three Auto Calc blocks; per-box diff with a caller tolerance; the ITC pairing is opt-in (`confirmItcMapping`).

Not included: quarterly/QRMP (`det_q`), GSTR-1A, late fee (not in the Save v7.1 schema), interest computation, saving/filing (see `gsp` later), GSTR-1 tables that `gstr1` does not build (spec §14).

`src/autocalc-shape.ts` is generated from the source schema by `scripts/gen-autocalc-shape.mjs`.
