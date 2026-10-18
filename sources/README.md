# Official sources

Everything under `sources/` was captured on **2026-10-16** from the official sites below, through a browser in India (the cloud build environment cannot reach these sites). Each e-invoice file was checked against the live page by SHA-256 at capture time; the GSTR-2B files (`recon/`) were downloaded by hand and are recorded with the hash of the file as uploaded.

Status of every fact taken from these files: **UNVERIFIED — needs CA**, until signed off in `docs/legal-facts.md`.

## Files

| File | Official page | Notes | SHA-256 check |
|---|---|---|---|
| `einvoice/master-codes/state-codes.csv` | https://einvoice1.gst.gov.in/Others/MasterCodes (table "State Code") | Source **A** | sha256 of file content without the trailing newline = `abf9c694…f2aeb`, equal to the page table |
| `einvoice/master-codes/uqc.csv` | same page (table "Unit Code") | Source **B**, 45 codes | `d71eba5a…c89b4`, equal |
| `einvoice/master-codes/state-pincode-ranges.csv` | same page (state / first-3-pincode-digits table) | for address validation later | `1f383ab8…3fcac`, equal |
| `einvoice/master-codes/country-codes.csv` | same page (table "Country Code") | for exports (deferred) | `fbd3e3c2…1332d`, equal |
| `einvoice/master-codes/currency-codes.csv` | same page (table "Currency Code") | for exports (deferred); note `BDT` appears twice on the page | `77bc4fd9…cd7c2`, equal |
| `einvoice/generate-irn-json-schema.json` | https://einv-apisandbox.nic.in/version1.03/generate-irn.html#JSONSchema | Source **C**. Whitespace re-indented; content identical (compact-JSON sha256 `92e10dda…c298d` equals the page). Schema quirks such as keys with trailing spaces (`"AddlDocDtls "`) and `"type": " number"` are the publisher's and are kept as published. | equal |
| `einvoice/generate-irn-validations.txt` | same page, section "Validations" | Source **C**. Whitespace-normalised text (sha256 `a21aeab3…5b9e1` equals the page) | equal |
| `einvoice/sample-signed-einvoice.json` | https://einvoice1.gst.gov.in/Documents/SampleJson.json | Official sample IRN response (signed invoice + signed QR JWTs); for the `einvoice` package. Re-indented; compact-JSON sha256 `27d5bbe0…59066` equals the page | equal |

### GSTR-2B (Track C, `recon`)

Captured by hand from https://developer.gst.gov.in/apiportal/taxpayer/returns on 2026-10-16. Full provenance, the v4.4 → v4.5 change summary and the schema quirks are in `recon/README.md`.

| File | Official page | Notes | SHA-256 |
|---|---|---|---|
| `recon/gstr2b-get-all-details-v4.5-response-schema.json` | https://developer.gst.gov.in/apiportal/taxpayer/returns (GSTR-2B Get All Details, response) | Source **H**, authoritative. v4.5, **Draft**, published 20-07-2026 | `3351e86b…02e95` (file as uploaded; not checked against the live page) |
| `recon/gstr2b-get-all-details-v4.4-response-schema.json` | same page | v4.4, **Draft**, published 25-02-2026; kept for the change summary only | `80ef571d…2b000` (same) |

Not captured: the Port Code table (1,062 rows) on the master-codes page — only needed for export details, which are deferred.

## Findings that affect the spec

1. **No official sample GSTINs exist publicly (source E).** The sandbox's sample JSONs use placeholders (`"29xxxxxxxx"`). The sandbox only issues dummy GSTINs to registered GSPs after login.
2. **The GSTINs inside the portal's sample signed invoice are illustrative, not valid.** `37BZNPM9430M1KL` and `03BZNPM9430M1KL` both fail the documented mod-36 check digit (it computes `E` and `P` respectively; both end in `L`). They must not be used as "valid" fixtures or as proof of the algorithm.
3. **No official document describing the GSTIN check-digit algorithm was found (source D).**
4. **The only official GSTIN pattern published here is loose:** `^([0-9]{2}[0-9A-Z]{13})$` (supplier/e-commerce), and `^(([0-9]{2}[0-9A-Z]{13})|URP)$` for buyer/ship-to (`URP` = unregistered person, used for exports). No PAN-structured or TDS/TCS-specific pattern is published in source C.
5. **State codes:** no code `28`; `25` (Daman and Diu) is still listed but the validations say it is **withdrawn as a place of supply**; `96` and `99` are both "OTHER COUNTRIES" (the schema says POS outside India is `96`); `97` is "Other Territory". Codes are published without a leading zero (`1`, not `01`), while GSTINs carry two digits.
6. **Validations state "Tax rate 0.5% is withdrawn."**
7. **Document number:** `^([a-zA-Z1-9]{1}[a-zA-Z0-9\/-]{0,15})$`, max 16; "should not be starting with 0, / and -".
8. **Precision:** `Qty` max `9999999999.999` and `UnitPrice` max `999999999999.999` (3 decimals); money fields 2 decimals.
9. **Tolerance:** the portal accepts tax and totals within about ±1 rupee of the calculated value. That tolerance belongs in the `einvoice` package, not in the model.

Sources **F** (rate notifications) and **G** (UTGST definition of union territory) are on cbic-gst.gov.in, which the build environment can reach; they are fetched by the build session.

## GSTR-1 (Track A)

Captured 2026-10-16 from this machine (India); see **`sources/gstr1/README.md`** for files, URLs and SHA-256. Summary:

- The authoritative format is the GSTN API schema **"GSTR1 – Save GSTR1 data" v5.0** (FINAL, published 23-02-2026), `sources/gstr1/gstr1-save-v5.0-schema.json`; v4.1 (published 04-02-2025) is kept alongside for comparison. The owner downloaded it by hand on 2026-10-16 from https://developer.gst.gov.in/apiportal/taxpayer/returns; the page is behind a bot challenge. It supersedes v1.1, which GSTN's troubleshooting guide still names.
- Also captured (secondary source): the official **GST Offline Tool** (zip from tutorial.gst.gov.in, release 3.2.4): Excel template V2.2 help and master sheets, per-section CSV templates (sample GSTINs and two real-looking company names redacted), the tool's data JSON files, and file:line excerpts of the code that writes the upload JSON.
- Finding: the offline tool validates recipient GSTINs with a PAN-structured pattern **and a mod-36 check character** (`sources/gstr1/offline-tool/code-excerpts.md` §4). This is the first official artefact implementing the check digit the model uses (still UNVERIFIED — it is code, not a published specification).
- Finding: the tool's UQC drop-down (45 codes) is identical to the e-invoice master list (`sources/einvoice/master-codes/uqc.csv`).

---

# E-way bill sources (`sources/ewaybill/`, Track D)

Captured on **2026-10-16** with `curl` from a machine in India; neither site needed a login or CAPTCHA. Each page was downloaded twice, and both downloads had the same SHA-256 (the pages are static HTML).

**How the files were made.** The raw HTML pages are **not** committed. They contain commented-out content (withdrawn rules, and GSTINs that may be real; see finding E7). Each file below was extracted from the page as a browser renders it:

1. HTML comments (`<!-- … -->`) removed.
2. Tags stripped and entities decoded. U+00A0 (non-breaking space) between JSON tokens is replaced by a plain space.
3. JSON re-indented with 2 spaces, key order kept. "compact sha256" is the SHA-256 of `JSON.stringify(JSON.parse(file))`, and it equals the same digest of the JSON extracted from the page.
4. Tables written as CSV, with `rowspan` cells repeated on every row they span.
5. Prose written one line per paragraph or list item, whitespace collapsed.

To re-verify, download the page, check the raw-page SHA-256, then repeat the steps above. Status of every fact: **UNVERIFIED — needs CA**.

## Pages (raw HTML SHA-256)

| Id | Page | Raw-page SHA-256 |
|---|---|---|
| **H** | https://docs.ewaybillgst.gov.in/apidocs/version1.03/generate-eway-bill.html (E-way bill API v1.03, "Generate E-way Bill") | `db59366d388c99ef09535d18ec3412047e001bb931674265096edb44e098144b` |
| **I** | https://einv-apisandbox.nic.in/version1.03/ewaybill-generation-irn.html (e-invoice API v1.03, "EWB Generation by IRN") | `9e9620aeea2738fab640d97b99d766872e94c010b3b5f0ca6b77ea217e35876a` |
| **J** | https://einv-apisandbox.nic.in/Mapping_of_ewaybill_schema.html ("Mapping of E-way bill schema with API (IRN) schema") | `4818ef17fbd4298ea8fae5189e96a5975ba9f1a05a2affc3eaa3dad3dd7bfaf6` |
| **K1** | https://docs.ewaybillgst.gov.in/apidocs/master-codes-list.html | `ab2c16460e7b0c37e8b6effed0e6c0b8f30e13536feab56d4f22adbbad955b0b` |
| **K2** | https://docs.ewaybillgst.gov.in/apidocs/state-code.html | `c783ca14e84cfda6c3c85f2ebce33513b88271aabec6dbf841ca737199b60c70` |
| **K3** | https://docs.ewaybillgst.gov.in/apidocs/sub-docType-mapping.html | `ba3348a7e0781206d484402955cd9d369fe6a572753752c95c6a30303601453d` |
| **K4** | https://docs.ewaybillgst.gov.in/apidocs/tax_rates.html | `54ebec70bddfe076a3227dbcf543f9d317bab8b00d38202109ee58d53e039f0c` |
| **L** | https://docs.ewaybillgst.gov.in/apidocs/release-notes.html (latest entry dated 30/07/2026) | `a23685c9da052ec12191efb5058bcdb64420a37be37ae3f0507fd7406e4ce2b4` |

## Files (file SHA-256)

| File | From | What | File SHA-256 |
|---|---|---|---|
| `ewaybill/generate-ewaybill-schema.json` | H `#JSONSchema` | Generate EWB request schema (draft-04 as declared; 40 properties). Compact sha256 `52755ac6…ef0fe4fa` | `7f9b4ba5…ca335220` |
| `ewaybill/generate-ewaybill-sample-request.json` | H `#requestSampleJSON` (the decrypted `data` JSON; the encrypted sample is not kept) | Official sample request. Compact sha256 `2106de2f…7092f9f6` | `696b7945…f28835d2` |
| `ewaybill/generate-ewaybill-sample-response.txt` | H `#responseSampleJSON` | Sample envelope, decrypted success `data` and error JSON (kept as text). The envelope’s base64 `data` decodes to a *different* object (`ewayBillNo 123456789`, date `"16 / 09 / 2017 10: 30: 00 AM"`) from the decrypted sample shown (`123456789012`, `"25/09/2018  10:30:00 AM"`, `validUpto "26/09/2018  12.00:00 PM"`) | `8538bf2f…6366dae6` |
| `ewaybill/generate-ewaybill-data-structure.csv` | H `#dataStructure` | Field table: type/length, description, sample, allowed characters | `84bf6bbd…8b94671a` |
| `ewaybill/generate-ewaybill-validations.txt` | H `#validations` and `#faq` | Validations and FAQ | `d9cdb38b…4c26a592` |
| `ewaybill/generate-ewaybill-overview.txt` | H `#overview`, `#requestPayload`, `#responsePayload` | URL, headers, envelope | `a315bb9d…5bbbd7e2` |
| `ewaybill/ewb-by-irn-schema.json` | I `#JSONSchema` | EWB-by-IRN request schema. Compact sha256 `06e78b4a…e2350549` | `25b1de74…5fea7f87` |
| `ewaybill/ewb-by-irn-sample-request.json` | I `#SampleJSON` | Sample request. Compact sha256 `15d5a555…8b18d125` | `20513b63…4d0d1833` |
| `ewaybill/ewb-by-irn-sample-response.json` | I `#SampleJSON` | Sample success response. Compact sha256 `0baa01ae…ca04eae2` | `443ccc47…40a26646` |
| `ewaybill/ewb-by-irn-validations.txt` | I `#validations` | Validations | `bd22bdc2…139fa531` |
| `ewaybill/ewb-by-irn-overview.txt` | I `#overview`, payloads | URL `api/einvewb/ewaybill`, headers, envelope | `985966a9…c8624d72` |
| `ewaybill/einvoice-to-ewaybill-mapping.csv` | J | The portal's own IRN → EWB field mapping | `7410d53d…d1b9710d` |
| `ewaybill/master-codes/supply-type.csv` | K1 | `O`/`I` | `5435bca6…1ffcbb55` |
| `ewaybill/master-codes/sub-supply-type.csv` | K1 | 1–12 | `86bb79d7…8e65b337` |
| `ewaybill/master-codes/document-type.csv` | K1 | INV, BIL, BOE, CHL, OTH | `a7623f4f…5e041cb4` |
| `ewaybill/master-codes/transportation-mode.csv` | K1 | 1–4, plus 5 "inTransit" | `7b25fe16…d1f22f5c` |
| `ewaybill/master-codes/vehicle-type.csv` | K1 | R / O | `88d22bd8…e7c1fdc0` |
| `ewaybill/master-codes/transaction-types.csv` | K1 | 1–4 | `64f5ae9f…d9856b65` |
| `ewaybill/master-codes/unit.csv` | K1 | 45 UQCs, **the same codes** as `einvoice/master-codes/uqc.csv` | `7fcc3ead…23413f51` |
| `ewaybill/master-codes/valid-formats-of-vehicle-numbers.csv` | K1 | 10 illustrative vehicle-number shapes | `7f2b38d1…4e229b1f` |
| `ewaybill/master-codes/vehicle-update-reason-codes.csv`, `cancellation-reason-codes.csv`, `reasons-for-extension-of-validity.csv`, `e-way-bill-status.csv`, `consignment-status.csv`, `mode-of-generation-code.csv` | K1 | Other masters, for later APIs | `88263429…a5ce68b0`, `05180175…36edc058`, `b45fc63e…61d93c7b`, `cc811f64…9d645da6`, `102fe469…345b8e17`, `c9f5520d…dcbc2ce4` |
| `ewaybill/master-codes/state-codes.csv` | K2 | EWB state list (38 rows) | `321c6fe6…75a7fbda` |
| `ewaybill/master-codes/sub-supply-doc-type-mapping.csv` | K3 | supply type × sub-type → allowed document type and parties (28 rows) | `4cb6684b…5eec35c6` |
| `ewaybill/master-codes/tax-rates.txt` | K4 | "Standard tax rates" the portal validates (text) | `42ce77e2…ff20492c` |
| `ewaybill/release-notes.txt` | L | Release notes | `7f194854…8737e41a` |

Full digests: `sources/ewaybill/SHA256SUMS` (check with `cd sources/ewaybill && sha256sum -c SHA256SUMS`). Digests are of the files as committed (UTF-8, LF line endings). A Windows checkout with `core.autocrlf=true` rewrites line endings and will not match; check `git show HEAD:<path> | sha256sum` instead.

## Findings that affect the ewaybill spec

- **E1. There are three ways to get an e-way bill:**
  1. the EWB API "Generate" (H), with a full payload;
  2. the e-invoice API "EWB by IRN" (I), with only the IRN plus transport details;
  3. an `EwbDtls` block inside the IRN request (source C).

  H states that the Generate API is **blocked** for suppliers enabled for e-invoice, for B2B and export tax invoices dated on or after 01/10/2020. Those must use routes 2 or 3.
- **E2. The rules for transport mode "Ship" disagree across three official pages:**
  - Source C: vehicle number and/or transport document; vehicle type must be ODC.
  - I: transport document number and date; vehicle number and type must be absent.
  - H: transport document is a must; the vehicle can be ODC with a vehicle number.
- **E3. State codes differ from the e-invoice master (source A):**
  - The EWB list has no `25` and no `96`.
  - `26` is "DADRA AND NAGAR HAVELI & DAMAN AND DIU".
  - H: "For 'Other Country', State code as 96 as well as 99 are accepted but system stores the state code as 99".
- **E4. Schema vs validations conflicts in H:**
  - `fromGstin`/`toGstin` have `minLength 15`, but the validations say to pass `URP` for unregistered persons.
  - The GSTIN patterns are unanchored and contain a literal `|` inside a character class.
  - `docDate` has the same 2010–2029 year pattern as source C.
  - `transDistance` is a JSON **string** in the schema ("<4000 km"), `Number(5)` "Max Value = 4000" in the data structure, and a number 0–4000 in I and C.
  - `hsnCode` is a JSON **number**, so an HSN with a leading zero (chapters 01–09) cannot be written exactly.
- **E5. The official samples are not internally consistent.**
  - H's sample:
    - `fromGstin` = `toGstin`;
    - `toStateCode 27` with a `29…` GSTIN;
    - `totalValue 56099` but item `taxableAmount 5609889`;
    - `otherValue` is the string `"-100"`, although the schema says number.
  - I's sample: `"TransId": "12XXXXXX"` (8 characters) and `"Irn": ""`, both against its own schema.
- **E6. The sample GSTIN `29ABCDE8755F1Z2` (H's sample and data structure) fails the mod-36 check digit:** it computes `8`, the published digit is `2`. It is an obvious placeholder, like the portal samples in finding 2 above. It must never be used as a valid fixture.
- **E7. Commented-out (hidden) content in H and I:**
  - the `dispatchFromGSTIN`/`dispatchFromTradeName` and `shipToGSTIN`/`shipToTrdName` fields;
  - "Ship-to GSTIN is mandatory for transaction types 2 and 4";
  - `ExpShipDtls.Gstin`/`TrdNm` "mandatory".

  This matches L: the 22/05/2026 "mandatory Ship-To GSTIN" change was **put on hold on 30/07/2026**. The hidden blocks contain two GSTINs (`29AC…1ZJ`, `29AA…1ZV`) that **pass** mod-36 and may be real. They are not committed and are no evidence for the algorithm.
- **E8. K4's rate list is undated.** It lists IGST 0.5 (CGST/SGST 0.25), although source C says "Tax rate 0.5% is withdrawn". Per CLAUDE.md no rate list is enforced (no rate notifications, no CA).
- **E9. K1's vehicle-number formats are illustrative shapes** (`AB121234`, `TMXXXXXXXXXXXXX`, …). The list of valid first-two-letter state (RTO) prefixes it refers to is **not** published on these pages.

# API documentation (`sources/einvoice/api/`, `sources/ewaybill/api/`, for `gsp`)

Captured on **2026-10-18** through a browser in India from the public developer portals **https://einv-apisandbox.nic.in/** (e-invoice, NIC IRP) and **https://docs.ewaybillgst.gov.in/apidocs/** (e-way bill). No login or CAPTCHA was needed.

**How the files were made.** Each page was fetched in the browser, `<script>`/`<style>` removed, and every top-level `div[id]` section (overview, request/response payload, samples, JSON schema, data structure, validations, FAQ) rendered and written as `=== #<id> ===` followed by the section's rendered text (`innerText`). HTML comments are not rendered, so commented-out content is not included. Normalisation: U+00A0 (no-break space) → space; trailing spaces before a newline removed; runs of 3+ newlines collapsed to 2. Each file's SHA-256 was computed in the browser and matched against the committed file. Changes after that check:

- Sample values longer than 200 characters in `Data`/`data`/`SignedInvoice`/`SignedQRCode` were replaced, in the browser before hashing, with `<omitted: long sample value, see source page>`. One omitted signed e-invoice sample (`get-irn-by-doc-details`) decodes to a document naming what looks like a real company.
- In `einvoice/api/v1.04-get-gstin-details.txt` and `v1.04-sync-gstin-details-from-cp.txt` the sample trade/legal name was replaced with `<redacted name>` after the check (pre-redaction SHA-256 `89f758dc…bac6315f` and `106a5a54…55138aa8`).
- The sample GSTINs left in the e-way bill files (`29AKLPM8755F1Z2`, `29BQSPA3829E1Z0`) **fail** mod-36 and must never be used as valid (same as the e-invoice portal samples).

File digests: `einvoice/api/SHA256SUMS`, `ewaybill/api/SHA256SUMS`. Raw page SHA-256 at capture (pages are static HTML, but may change):

| File | Page | Raw page SHA-256 |
|---|---|---|
| `einvoice/api/v1.04-authentication.txt` | `version1.04/authentication.html` | `7190deeb9c9ae34727075b7d074ab94d207a59f321a4e9a2f5894fa23739624d` |
| `einvoice/api/v1.04-get-gstin-details.txt` | `version1.04/get-gstin-details.html` | `535160acc0244bdfa997e422a8ec8719f07516cf09c2b99690a82fbc6b20a205` |
| `einvoice/api/v1.04-sync-gstin-details-from-cp.txt` | `version1.04/Sync-GSTIN-Details-from-CP.html` | `0e836c97a664e10997d5882dc705249f47c7455f71af37ba2b75829c61e5c732` |
| `einvoice/api/v1.03-cancel-irn.txt` | `version1.03/cancel-irn.html` | `cb7ddbf0d40d40a01d02f655cdd19cfaf28d5862dcc9f242b59c85ac8f103401` |
| `einvoice/api/v1.03-get-einvoice-details.txt` | `version1.03/get-eInvoicedetails.html` | `1f84c22ec59546f2bf6d7cf953c79b986d1b9681780840921b1302611504f83e` |
| `einvoice/api/v1.03-get-irn-by-doc-details.txt` | `version1.03/Get_IRNdetailsbyDocDetails.html` | `c3ea764f47fb5bbeeb61a9dfcac2f27d641fba67d75e1cc5726b1b27548cb516` |
| `einvoice/api/v1.03-cancel-ewaybill-sandbox-only.txt` | `version1.03/cancel-eway-bill.html` | `f07e90d1e5d9ac02471460782473365c02bd78a9b4c28e4070f57ca6742fbbdf` |
| `einvoice/api/v1.03-get-ewaybill-details-by-irn.txt` | `version1.03/get-ewaybill-details-by-irn.html` | `dbef6d51f7194f3cddcc5a5496d460e5bb353e6e6ffea2aaa8b147296f99703c` |
| `ewaybill/api/v1.03-authentication.txt` | `version1.03/authenticationV1.03.html` | `d6069016a21682c5d64e9578bbade30248a5e183fb879272e265bf597c2f3573` |
| `ewaybill/api/v1.03-vehicle-number-update.txt` | `version1.03/vehicle-number-update.html` | `5173d4156e011220914d239333c04e4624ced369f9f89e6c945cf0458d42428b` |
| `ewaybill/api/v1.03-consolidated-ewaybill.txt` | `version1.03/consolidated-eway-bill.html` | `9fa9e7c6107a7e56a28baa79d14e4f0da2c11b11af919a052572912627edec3b` |
| `ewaybill/api/v1.03-cancel-ewaybill.txt` | `version1.03/cancel-eway-bill.html` | `9ebb330aaf5fa3b0606f9dc9eace7154c9d37eedf62caf25a81676148f3356fa` |
| `ewaybill/api/v1.03-extend-validity.txt` | `version1.03/extend-validity.html` | `33f310d28e8d4b3664866b8c7b104ab0ae3ae73fd6b6236b1c8b7129b4a7fc08` |
| `ewaybill/api/v1.03-get-gstin-details.txt` | `version1.03/get-gstin-details.html` | `013898c4c2d0e3d9ab0c07710f67473f8f941267ae254e37d654948bccdd04db` |
| `ewaybill/api/v1.03-update-transporter.txt` | `version1.03/update-transporter.html` | `df5004d04406043cbc003d45cec92f55ba1bc1fb4cdc904815048e365b3a8ad0` |
| `ewaybill/api/v1.03-reject-ewaybill.txt` | `version1.03/reject-eway-bill.html` | `af402519c89437e8d7e439e944f4008682f26a159f7cbb239f99d73b34bdbbe1` |

## Findings that affect the `gsp` spec

- **G1. Who may call these APIs directly.** e-invoice: "tax payers with annual turnover of ₹100 crore and above in their previous financial year" (onboarding page), up to 4 whitelisted static IPs, a test summary report, and production credentials via the portal; others go through a GSP or an ERP. e-way bill: direct access needs "around 10 thousand transactions per month per GSTIN" and up to 3 static IPs (pre-requisites page). Neither page is committed; quoted here. **So most users of this kit reach NIC through a GSP**; the `gsp` package needs a provider interface, with "direct NIC" as one provider.
- **G2. Crypto (from the pages above plus the portals' Java sample code, which is not committed).** Login payload: JSON → Base64 → RSA with the portal's public key (`RSA/ECB/PKCS1PADDING`, X.509 SubjectPublicKeyInfo PEM). `AppKey`/`app_key`: 32 random bytes (Base64, 44 chars). Response `Sek` is AES-256-ECB (PKCS#7) encrypted with the AppKey; request/response `Data` is AES-256-ECB with the decrypted SEK. e-way bill `GetGSTINDetails` instead returns `data` encrypted with a per-response `rek` (itself encrypted with the SEK) and an `hmac` = HMAC-SHA256 of the Base64 data keyed with `rek`.
- **G3. Public keys are behind a login.** The sandbox release notes say the signing/encryption public key "is available for download. Please login to download the same". Not captured; needed only for live calls (the user downloads it after sandbox registration).
- **G4. Header names differ.** e-invoice pages list `client_id`/`client_secret`/`Gstin`/`user_name`/`AuthToken` (plus optional `sup_gstin`), but the e-invoice Java sample sends `client-id`/`client-secret`/`gstin`; the e-way bill pages use `client-id`/`client-secret`/`Gstin`/`authtoken`. Settle on the live sandbox (verify-on-first-call item).
- **G5. Token.** Valid 360 minutes (60 in the e-invoice sandbox). Calling auth again before expiry returns the **same** token without extending it; `ForceRefreshAccessToken: true` gives a new one only in the last 10 minutes.
- **G6. Time limits stated in validations.** Cancel IRN: within 24 h, not if an active e-way bill exists. Get e-invoice / IRN by document details: within 3 days of generation. Cancel EWB: 24 h, generator only. Reject EWB: 72 h, other party. Extend validity: 8 h before to 8 h after expiry, current transporter (or generator if none), not beyond 360 days; transMode 1–4 → `consignmentStatus` `M` and blank `transitType`; transMode 5 → `T` and `R`/`W`/`O`. Part-B/vehicle update and consolidated EWB: only while active and valid.
- **G7. Schema quirks.** Several draft-04 schemas are malformed: cancel-IRN puts `required` inside `properties`; vehicle-update puts `vehicleType` outside `properties`; update-transporter puts `transporterId` outside `properties`; extend-validity requires `TransMode` (capital T) but the property is `transMode`. Transcribe to Zod by hand with conformance tests, as for the IRN schema. Sample values disagree with schema types in places (e.g. `"ewbNo":"161000843009"` string vs `number`; `fromState` `"29"` vs integer).
- **G8. Lookup fields.** e-invoice GetGSTIN returns `Gstin, TradeName, LegalName, AddrBnm, AddrBno, AddrFlno, AddrSt, AddrLoc, StateCode, AddrPncd, TxpType, Status (ACT/CNL/INA/PRO), BlkStatus (U/''/B), DtReg, DtDReg`; "Considered active only if status='ACT'". `syncgstin` refreshes the IRP's copy from the GST common portal. The e-way bill lookup returns a smaller set (`gstin, tradeName, legalName, address1, address2, stateCode, pinCode, txpType, status, blkStatus`).
- **G9. Multiple IRPs.** Release notes: error 2295 when the IRN was already generated on another IRP, in addition to 2150 for duplicates on NIC-IRP. The error-code list (`api-error-codes-list.html`) is not captured yet.

## Additions for the gsp spec (2026-10-18)

- `einvoice/api/v1.03-generate-irn.txt`: Generate IRN page, sections overview, request payload, response payload and response sample (spec F1). Same method as above. Raw page SHA-256 `bb6ef70084b29cd53c48d0ca0337e5eadeec90c41e9136d6d770e8f36c7f4b2c`. The request sample section is left out: it duplicates `einvoice/SampleJson.json` and the schema.
- `einvoice/api/java-sample-excerpts.md`: file:line excerpts of both portals' Java sample code (spec F4). **G10:** both samples generate the AppKey with `gen.init(128)` (16 bytes), against "32 bytes" in the text.
- **Not captured (spec F2, F3):**
  - The e-way bill error-code list (`docs.ewaybillgst.gov.in/apidocs/api-error-codes-list.html`, one table of 374 rows, raw page SHA-256 `21c6657a…a07365`) is reachable but not transcribed, because spec D-G20 ships no error table.
  - The e-invoice error codes are not on the sandbox portal. They are on `https://einvoice1.gst.gov.in/others/geterrorcodes/{VITAL,INV,EWB}`, which was not opened.
  - No official base URL appears on any captured page; the pages write `<URL>`.
