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
