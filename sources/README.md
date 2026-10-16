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
