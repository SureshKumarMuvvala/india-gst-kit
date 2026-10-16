# Official sources

Everything under `sources/` was captured on **2026-10-16** from the official sites below, through a browser in India (the cloud build environment cannot reach these sites). Each file was checked against the live page by SHA-256 at capture time.

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
