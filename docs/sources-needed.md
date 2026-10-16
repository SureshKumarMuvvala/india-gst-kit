# Official sources needed before Track 0 can be built

The planning session could not reach any official GST source: `www.gst.gov.in`, `einvoice1.gst.gov.in`, `tutorial.gst.gov.in`, `cbic-gst.gov.in`, `einv-apisandbox.nic.in` failed (DNS ENOTFOUND / connection closed) and `docs.ewaybillgst.gov.in` returned HTTP 403 (checked 2026-10-16).

Per project rules, no legal/official list is filled from memory. Download the files below and commit them under `sources/` (or attach them to the build session). Record the page URL and the download date for each — that goes into the source comment and `docs/legal-facts.md`.

| # | What | Where (official) | Used for |
|---|---|---|---|
| A | e-Invoice **Master Codes — State Codes** (xlsx/pdf) | einvoice1.gst.gov.in → Others → Master Codes | `STATE_CODES`, incl. "Other Territory"/"Other Country" codes if listed |
| B | e-Invoice **Master Codes — UQC** | same page | `UQC_CODES` |
| C | e-Invoice **JSON schema (INV-01, current version)** and its validations document | einvoice1.gst.gov.in → Documents, or einv-apisandbox.nic.in | GSTIN pattern(s) incl. TDS/TCS/non-resident formats; allowed GST rates; decimal precision for qty/price/amounts; document-number rules; supply-type codes |
| D | Any GSTN/CBIC document describing the **GSTIN check-digit** algorithm | gst.gov.in / GSTN developer docs | `gstinCheckDigit()`. If none exists, the publicly documented mod-36 algorithm is used, marked UNVERIFIED |
| E | Officially published **sample / test GSTINs** (e.g. e-invoice sandbox documentation) | einv-apisandbox.nic.in | fixtures; check-digit tests |
| F | **GST rate notifications** — current rates and abolished rates with effective dates (e.g. CBIC rate notifications and their amendments) | cbic-gst.gov.in | `GST_RATES_OFFERED`, `GST_RATES_LEGACY` |
| G | **Union territories using UTGST** — UTGST Act definition of "Union territory" / CGST Act s.2(114) | cbic-gst.gov.in (Acts) | `usesUtgst()` |

If any of these cannot be obtained, the build session stops and reports which one is missing.
