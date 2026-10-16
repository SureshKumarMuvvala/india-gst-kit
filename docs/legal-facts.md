# Legal facts

Every row is **UNVERIFIED — needs CA** until a chartered accountant signs it off here. "File" is where the fact lives in code. Retrieval dates are 2026-10-16 unless noted.

| Fact | File | Source | Retrieved | Status |
|---|---|---|---|---|
| State codes (40 entries; no 28; zero-padded to 2 digits by the model) | `packages/model/src/states.ts` | https://einvoice1.gst.gov.in/Others/MasterCodes — `sources/einvoice/master-codes/state-codes.csv` | 2026-10-16 | UNVERIFIED — needs CA |
| 25 (Daman and Diu) withdrawn as place of supply; 96 = POS outside India; 97 = Other Territory; 99 also "OTHER COUNTRIES" | `states.ts`, `primitives.ts` | e-invoice validations — `sources/einvoice/generate-irn-validations.txt` | 2026-10-16 | UNVERIFIED — needs CA |
| UQC codes (45) | `packages/model/src/uqc.ts` | https://einvoice1.gst.gov.in/Others/MasterCodes — `sources/einvoice/master-codes/uqc.csv` | 2026-10-16 | UNVERIFIED — needs CA |
| GSTIN pattern `^[0-9]{2}[0-9A-Z]{13}$` (the only official pattern; no PAN-structured, TDS or TCS pattern is published) | `packages/model/src/gstin.ts` | https://einv-apisandbox.nic.in/version1.03/generate-irn.html#JSONSchema — `sources/einvoice/generate-irn-json-schema.json` | 2026-10-16 | UNVERIFIED — needs CA |
| GSTIN check digit: mod-36 (no official algorithm document exists; the portal's own illustrative sample GSTINs fail it) | `gstin.ts` | Public algorithm; `sources/README.md` findings 1–3 | 2026-10-16 | UNVERIFIED — needs CA. Mod-36 checked privately by the owner on 2026-10-16 against 4 real GSTINs (2 states, individuals and a firm): 4/4 passed. Still UNVERIFIED — no official algorithm document. |
| Sample GSTINs used in fixtures: synthetic, computed with mod-36, not real registrations | `packages/fixtures/src/gstins.ts` | n/a (no official samples exist) | 2026-10-16 | Synthetic |
| GST rate format: 0–999.999, ≤3 decimals (`GstRt`). The model holds no rate list | `primitives.ts` | e-invoice JSON schema (above) | 2026-10-16 | UNVERIFIED — needs CA |
| "Tax rate 0.5% is withdrawn" (e-invoice validations; effective date not stated). Informational only — nothing in the model enforces it | none | `sources/einvoice/generate-irn-validations.txt` | 2026-10-16 | UNVERIFIED — needs CA |
| Rate lists, legacy rates with effective dates, `rateInForceOn` | not implemented | needs CBIC rate notifications (source F; `taxinformation.cbic.gov.in` unreachable from the build environment) | — | Deferred (spec §12) |
| HSN/SAC: 4, 6 or 8 digits, not all zeros | `primitives.ts` | JSON schema `HsnCd` | 2026-10-16 | UNVERIFIED — needs CA |
| Service lines use a SAC starting `99` | `schema/line.ts` | Design choice; consistent with "if Is Service … HSN must belong to services" | — | UNVERIFIED — needs CA |
| Document number: `^[a-zA-Z1-9][a-zA-Z0-9/-]{0,15}$`, max 16, not starting with 0, / or - | `primitives.ts` | JSON schema `Doc.No`; validations text | 2026-10-16 | UNVERIFIED — needs CA |
| Quantity ≤ 9999999999.999; UnitPrice ≤ 999999999999.999 | `primitives.ts` | JSON schema | 2026-10-16 | UNVERIFIED — needs CA |
| Intra vs inter: same supplier/POS state ⇒ intra; exports and SEZ always inter | `supply.ts` | e-invoice validations ("The state code of the Supplier GSTIN and POS will decide…", "In case of Exports and SEZ, the supply is always Interstate"). IGST Act ss.7/8 not fetched | 2026-10-16 | UNVERIFIED — needs CA |
| UTGST territories: A&N (35), Lakshadweep (31), D&NH (26), D&D (25), Chandigarh (04), other territory (97). Ladakh and later amendments not retrieved | `packages/model/src/supply.ts` | UTGST Act 2017 s.2(8), CGST Act s.2(114) — `sources/acts/` (https://gstcouncil.gov.in/utgst) | 2026-10-16 | UNVERIFIED — needs CA |
| Composition suppliers issue bills of supply / notes and charge no tax | `schema/document.ts` | Design from CGST composition rules; not sourced from a fetched document | — | UNVERIFIED — needs CA |
| Credit/debit notes reference the original document; amounts positive, direction from `kind` | `schema/document.ts` | Design choice | — | UNVERIFIED — needs CA |
| Rounding: per line half-up to 2 dp; totals are sums of rounded lines; `\|roundOff\| < 1.00` (the portal allows ±99.99) | `money.ts`, `schema/document.ts` | Design choice | — | UNVERIFIED — needs CA |
| CGST/SGST split: `remainder-to-sgst` and `equal-halves` both accepted | `money.ts`, `schema/line.ts` | Design choice | — | UNVERIFIED — needs CA |
| Invoice-level discount not modelled; caller apportions into line `discount` | spec §5.5 | Decision 2026-10-16 | — | Deferred — needs CA |
