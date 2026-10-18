# GSTR-3B sources (`sources/gstr3b/`)

Downloaded by hand by the maintainer on **2026-10-18** from the GST developer portal, https://developer.gst.gov.in/apiportal/taxpayer/returns (View API List; the download sits behind a CAPTCHA). Files are committed byte-for-byte as downloaded and renamed only to add the version. No sample JSON was offered.

| File | Portal API (id) | Version | Published | Portal status | SHA-256 |
|---|---|---|---|---|---|
| `GSTR3B - Save GSTR3B data request_schema v7.1.json` | GSTR3B – Save GSTR3B data (2269) | v7.1 | 23-03-2026 | Draft | `043917ea6fcbe34e97e851fde6cfe9a472aaefb2be503e9438973b16e67480ae` |
| `GSTR3B - Get ITC Liability Auto Calc Details response_schema v7.1.json` | GSTR3B – Get ITC Liability Auto Calc Details (3183) | v7.1 | 23-03-2026 | Draft | `ce61f5522b6bd3d5323e3cd38a48857b138202614e6cb5a69bde3becc9cb987b` |

Other versions listed on 2026-10-18: Save v7.0 (15-09-2025) and v6.0 (19-07-2024); Auto Calc v7.0 (15-09-2025) and v6.0 (30-07-2024). All versions are marked **Draft**, as with GSTR-2B v4.5 (`sources/recon/`).

Other GSTR-3B APIs on the portal (not downloaded): File GSTR3B (2272), Get GSTR3B Details (2268), Offset Liability (2271), Validate GSTR3B against AutoCalculated data (3198), Get system calculated interest (3330), Re-compute interest (3332), Save past liability breakup (3331), ITC reversal / RCM opening-balance and ledger APIs (3454–3456, 3601–3603).

## First observations (for the spec session to confirm)

- **R1. Save request = the return's tables.** `sup_details` (3.1 a–e: `osup_det`, `osup_zero`, `osup_nil_exmp`, `isup_rev`, `osup_nongst`), `inter_sup` (3.2: `comp_details`, `uin_details`, `unreg_details` by `pos`), `eco_dtls` (3.1.1: `eco_sup`, `eco_reg_sup`), `itc_elg` (4: `itc_avl` types IMPG/IMPS/ISRC/ISD/OTH, `itc_rev` RUL/OTH, `itc_net`, `itc_inelg` RUL/OTH), `inward_sup` (5: GST/NONGST, inter/intra), `intr_ltfee` (5.1 interest). Only `gstin` and `ret_period` (MMYYYY) are required at the top level.
- **R2. Amounts are JSON numbers** with `multipleOf 0.01`; most allow negatives (`negVal`), reversals/interest/inward do not (`nonEmptyCost`); `itc_net` may be negative.
- **R3. The schema's GSTIN pattern is the PAN-structured one** (`[0-9]{2}[a-zA-Z]{5}[0-9]{4}[a-zA-Z][1-9A-Za-z][Zz1-9A-Ja-j][0-9a-zA-Z]`), stricter than the loose official pattern the model uses and different from the e-invoice schema. It also accepts lower case.
- **R4. `pos` in 3.2 is `^(3[0-8]|[12][0-9]|0[1-9]|97)$`**: no 96/99, and 25 and 28 are allowed here.
- **R5. The Auto Calc response maps GSTR-1/1A/IFF and GSTR-2B tables onto 3B boxes** (e.g. `osup_3_1a.det.tbl4a … tbl11_ii`, plus IMS credit/debit-note rows), with `subtotal`, monthly `det` and quarterly `det_q`, and filing/generation dates (`r1fildt`, `r2bgendt`, `r3bgendt`, `r1afildt`). This is the official statement of which GSTR-1 table feeds which 3B box.
- **R6.** The response schema is large (≈1.5 MB pretty-printed). No GSTIN-shaped values were found in it.

## Notified forms (F1, and F4 for GSTR-1) — fetched 2026-10-18

Fetched by the build session (Track G) with `curl` from the GST Council website, which is reachable from the build environment. Status: **UNVERIFIED — needs CA**.

| File | URL | Notes | SHA-256 |
|---|---|---|---|
| `cgst-rules-2017-part-b-forms-18052021.pdf` | https://gstcouncil.gov.in/sites/default/files/2024-04/18052021-cgst-rules-2017-part-b-forms.pdf (linked from https://gstcouncil.gov.in/CGST-Rules as "CGST Rules 2017 – Part B Forms") | 5,544,806 bytes, 453 pages, `Last-Modified: Mon, 22 Apr 2024 10:47:16 GMT`; PDF created 21-05-2021. **Consolidation as of 18-05-2021**: amendments to the forms after that date are not in it. | `9b5ae908fae791b25f903795eb5dfcd30485f18d68f6f34b6b30e1a41b1fdafa` |
| `form-gstr3b-excerpt-18052021.txt` | the PDF above, pages 152–154 (printed 146–147): FORM GSTR-3B [See rule 61(5)] and its three instructions | `pdftotext -layout` (poppler) output, verbatim, with a 6-line provenance header | `96eaa09912e5ede939fdb33a5188e6085238cf6f324f64f4a039a0476fc00d03` |

The GSTR-1 excerpt from the same PDF is in `sources/gstr1/form-gstr1-excerpt-18052021.txt` (see `sources/gstr1/README.md`).

**What this version of the form does and does not contain** (used by `docs/specs/gstr3b.md` §13):
- Tables 3.1 (a)–(e), 3.2, 4 (A)(1)–(5), (B)(1)–(2), (C) "Net ITC Available (A) – (B)", (D)(1)–(2), 5, 6.1, 6.2; instructions 1–3 (taxable value = invoices + debit notes − credit notes + advances − adjustments; amendments adjusted, not shown separately).
- **No Table 3.1.1 and no Table 5.1.** Interest and late fee appear only as columns of 6.1 "Payment of tax". The current form (with 3.1.1 / 5.1, matching the Save v7.1 schema) is a later amendment that is **not** in this consolidation. `taxinformation.cbic.gov.in`, where CBIC links the current rules, is unreachable from the build environment.

URLs tried on 2026-10-18 without finding the forms: https://cbic-gst.gov.in/gst-forms.html (404), https://cbic-gst.gov.in/central-tax-rules.html (404), https://cbic-gst.gov.in/cgst-rules.html (404), https://cbic-gst.gov.in/forms.html (404), https://cbic-gst.gov.in/legalprovisions.html and https://cbic-gst.gov.in/gst-acts.html (200, link only to taxinformation.cbic.gov.in). Found via https://gstcouncil.gov.in/central-gst → https://gstcouncil.gov.in/CGST-Rules (also https://gstcouncil.gov.in/en/CGST-Rules: same two PDFs, Part A rules 01-06-2021 and Part B forms 18-05-2021).
