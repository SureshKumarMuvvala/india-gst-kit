# Spec — `@india-gst-kit/ewaybill` (v0.1)

Status: **draft 2026-10-16, for review**. The open questions in §14 need answers before the build. Every legal or official fact here is **UNVERIFIED — needs CA** until a chartered accountant signs it off in `docs/legal-facts.md`.

Sources (captured 2026-10-16; see `sources/README.md`, section "E-way bill sources"):
- **H**: EWB API v1.03 "Generate E-way Bill". Files `sources/ewaybill/generate-ewaybill-*`.
- **I**: e-invoice API v1.03 "EWB Generation by IRN". Files `sources/ewaybill/ewb-by-irn-*`.
- **J**: the portal's "Mapping of E-way bill schema with API (IRN) schema". File `sources/ewaybill/einvoice-to-ewaybill-mapping.csv`.
- **K1–K4**: EWB master codes, state list, sub-type/document-type mapping and tax-rate page. Files `sources/ewaybill/master-codes/`.
- **L**: EWB release notes. File `sources/ewaybill/release-notes.txt`.
- **C**: the e-invoice schema and validations (`sources/einvoice/`), for the `EwbDtls` block.

Where a source contradicts this spec, **the source wins**; the conflict is reported in §13. Where two sources contradict each other, the stricter rule applies and the conflict is reported.

## 1. Purpose and scope
- **In scope:**
  - `toEwbRequest(doc, movement, options?)` maps a parsed `GstDocument` plus movement details to the **Generate E-way Bill** request (H).
  - `toEwbByIrnRequest(irn, movement)` builds the **EWB-by-IRN** request (I).
  - `toIrnEwbDtls(movement)` builds the `EwbDtls` block of an IRN request (C), so an e-way bill can be generated together with the IRN.
  - `ewbRoute(doc, options)` says which of the three routes applies (§4).
  - `validateEwbRequest`, `validateEwbByIrnRequest` and `validateEwbDtls` validate payloads, ours or anyone else's, against the schemas and the offline-checkable rules.
  - `serializeEwbRequest` / `parseEwbRequestJson` (and the by-IRN equivalents) handle JSON text in and out with exact decimals.
  - `parseEwbResponseData` / `parseEwbByIrnResponseData` parse the **decrypted** response `data`.
- **Out of scope:**
  - Deciding **whether** an e-way bill is required (consignment-value threshold, exempt goods, distance). Rule 138 of the CGST Rules is not in `sources/`, and the model does not decide legal applicability.
  - Inward e-way bills (`supplyType = I`), and documents the model does not have: delivery challan, bill of entry, "others".
  - HTTP, authentication, SEK encryption and the `action`/`data` envelope (package `gsp`).
  - Part-B update, cancel, reject, extend, consolidated and multi-vehicle EWBs: the other v1.03 APIs. Their masters are captured for later.
  - Computing the validity period (`validUpto`); the rule is not in `sources/`.
  - Error-code descriptions (`api-error-codes-list.html`, not captured).
  - Everything that needs the portal's databases (§9).
- ESM only, named exports, Zod 4 (peer `^4.0.0`), `decimal.js`, and `@india-gst-kit/model` as a dependency (`workspace:^`). The `@india-gst-kit/einvoice` dependency is open question Q1. Types are `z.infer`. Objects use `z.strictObject`.

## 2. Numbers and JSON
The same approach as `docs/specs/einvoice.md` §2. In memory, numbers are **strings**; in JSON text they are written as raw number literals and read back losslessly.
- `EwbDecimal` = string `/^-?\d+(\.\d+)?$/` (no exponent, no leading `+`). `EwbInt` = string `/^\d+$/`.
- **JSON type per field** follows the source schema, not intuition:

  | Route | Field | JSON type |
  |---|---|---|
  | H | `transDistance` | **string** |
  | H | `transMode`, `subSupplyType` | string |
  | H | `fromPincode`, `toPincode`, the four state codes, `transactionType` | integer |
  | H | `hsnCode` | **number** |
  | I, C | `Distance`, `Pin` | number |
  | I, C | `Stcd` | string |

  A string where the schema expects a number is a type error, and so is the reverse. This applies to the official sample's `"otherValue": "-100"` (§12).
- Money is emitted with exactly 2 dp (`multipleOf 0.01`), rates with up to 3 dp (`multipleOf 0.001`). Quantities are emitted as in the model (see V-G12).
- Serialisation is compact JSON in the schema's key order.

## 3. Input: `EwbMovement` (`src/movement.ts`)
The model has no transport, dispatch-from or ship-to data. They come in as a separate, strictly validated input:
```ts
EwbMovementSchema = z.strictObject({
  transport: EwbTransportSchema,
  dispatchFrom: z.strictObject({ name: z.string(), address: AddressSchema }).optional(), // model AddressSchema
  shipTo: z.strictObject({ address: AddressSchema }).optional(),
});
EwbTransportSchema = z.strictObject({
  distanceKm: z.string().regex(/^(0|[1-9]\d{0,3})$/), // integer km, "0" = let the portal compute it
  mode: z.enum(["ROAD", "RAIL", "AIR", "SHIP"]).optional(), // absent = Part-A only
  vehicleNo: z.string().regex(/^[A-Z0-9]{4,20}$/).optional(), // no normalisation: lower case or spaces are rejected
  vehicleType: z.enum(["REGULAR", "ODC"]).optional(),
  transportDocNo: z.string().optional(),
  transportDocDate: IsoDateSchema.optional(),
  transporterId: z.string().optional(), // GSTIN or TRANSIN, 15 characters
  transporterName: z.string().optional(),
});
```
- Only the input's **shape** is checked here. The transport rules (§8.1) run on the mapped payload, so payloads built elsewhere get the same checks.
- `shipTo` has no name or GSTIN: `shipToGSTIN`/`shipToTrdName` and `ExpShipDtls.Gstin`/`TrdNm` are commented out in H and I, and the "mandatory Ship-To GSTIN" change was put on hold on 30/07/2026 (L). See Q7.
- **Mode codes:** `ROAD → "1"`, `RAIL → "2"`, `AIR → "3"`, `SHIP → "4"`. K1's mode `5` "inTransit" is in no schema enum and is not supported.
- **Vehicle types:** `REGULAR → "R"`, `ODC → "O"`.

## 4. Routes (`ewbRoute`)
`ewbRoute(doc, { supplierEInvoiceEnabled?: boolean }): { route: "GENERATE" | "IRN" | "NONE"; reasons: EwbIssue[] }`.
- **`NONE`** in two cases:
  - `kind ∈ {CREDIT_NOTE, DEBIT_NOTE}`. K1 has no such document type, and I/C say "E-way Bill is not generated for document types of Debit Note and Credit Note".
  - Every line is a service (`isService` or HSN starting `99`): "minimum one HSN code belonging to Goods is mandatory" (H, I, C).
- **`IRN`** when all of these hold:
  - `supplierEInvoiceEnabled === true`;
  - `kind = TAX_INVOICE`;
  - the transaction is B2B (recipient has a GSTIN) or `EXPORT_*`;
  - `date ≥ 2020-10-01`.

  Source H: "Generation of E Way Bill using the E Way Bill API System will be blocked … where the Supplier is enabled for E Invoice … B2B and Export transactions where document date is equal to or greater than 01/10/2020 … Tax Invoice". Both IRN routes are then valid: `EwbDtls` inside the IRN request, or EWB-by-IRN afterwards.
- **`GENERATE`** otherwise. If `supplierEInvoiceEnabled` is `undefined` and the IRN conditions would otherwise hold, `reasons` carries the warning `EINVOICE_STATUS_UNKNOWN`.

Whether a supplier is enabled for e-invoicing is portal data and cannot be derived offline. That is why it is an input.

## 5. Mapping `GstDocument` → Generate EWB request (`toEwbRequest`)
`toEwbRequest(doc, movement, options?: { supplierEInvoiceEnabled?: boolean }): MapResult`, where `MapResult = { ok: true; value: EwbRequest; issues: EwbIssue[] } | { ok: false; issues: EwbIssue[] }`.
- The document must already have passed `parseGstDocument`, and `movement` is parsed with `EwbMovementSchema`.
- The mapper never throws on data problems and never truncates or alters data.
- It runs `validateEwbRequest` on its own output, so `ok: true` means the payload passed validation. Warnings are returned in `issues`.

**Preconditions.** Each failure is a mapping error:
| Condition | Code | Source |
|---|---|---|
| `ewbRoute` is `NONE` | `NOT_EWB_DOCUMENT` | §4 |
| `ewbRoute` is `IRN` | `USE_IRN_ROUTE` | H validations |
| no `fromPincode`: neither `dispatchFrom` nor `supplier.address.pincode` has one | `MISSING_PIN` | H `required` |
| no `toPincode`: neither `shipTo` nor `recipient.address.pincode` has one | `MISSING_PIN` | H `required`; I/C "Pincode of Recipient GSTIN is mandatory if Ship-To details are not entered" |
| `EXPORT_*` without `shipTo` | `EXPORT_NEEDS_PORT_SHIP_TO` | I/C: for exports "the address of port should have been passed as shipping address" (decision D-Q3) |
| the tax split implied by the EWB state codes (V-G9) differs from `decideTaxSplit(supplier.stateCode, placeOfSupply, supplyCategory)`. Zero-tax documents are compared too, because the rates still follow the split | `STATE_SPLIT_MISMATCH` | H vs model §5 (open question Q4) |
| a line's HSN has a leading zero | `HSN_LEADING_ZERO` | H `hsnCode` is a JSON number (open question Q2) |

**Field mapping.** Party fields follow J, where J defines the same field for the IRN route.
| EWB field | From | Notes |
|---|---|---|
| `supplyType` | `"O"` | outward only (J: "always 'O'") |
| `subSupplyType` | `EXPORT_*` → `"3"`; otherwise `"1"` | J |
| `subSupplyDesc` | omitted | only for sub-type 8 "Others" |
| `docType` | `TAX_INVOICE → "INV"`, `BILL_OF_SUPPLY → "BIL"` | K1 |
| `docNo` | `number` | |
| `docDate` | `date` → `DD/MM/YYYY` | |
| `fromGstin` | `supplier.gstin` | |
| `fromTrdName` | `supplier.tradeName ?? supplier.legalName` | H names it "Trade Name" in the schema and "LegalName of consignor" in the data structure (§13 D5) |
| `fromAddr1/fromAddr2/fromPlace/fromPincode` | `dispatchFrom.address` if given, else `supplier.address`: `line1/line2/city/pincode` | H "Bill From – Dispatch From"; J |
| `fromStateCode` | `supplier.stateCode` as an integer (`"03"` → `3`) | |
| `actFromStateCode` | `dispatchFrom.address.stateCode`, else `supplier.stateCode` | J |
| `toGstin` | `recipient.gstin`, else `"URP"` | H "pass URP" |
| `toTrdName` | `recipient.tradeName ?? recipient.legalName` | as `fromTrdName` |
| `toAddr1/toAddr2/toPlace/toPincode` | `shipTo.address` if given, else `recipient.address` | H "Bill To – Ship To"; J |
| `toStateCode` | `99` for `SEZ_*` and `EXPORT_*`; otherwise `recipient.stateCode` | H: SEZ recipient ⇒ "Other Country"; 96 is stored as 99. Exports: J (`BuyerDtls.Stcd` = 96) |
| `actToStateCode` | `shipTo.address.stateCode`, else `recipient.stateCode` | J |
| `transactionType` | 1 = neither `dispatchFrom` nor `shipTo`; 2 = `shipTo` only; 3 = `dispatchFrom` only; 4 = both | J; K1 |
| `totalValue` | `totals.taxableValue` | |
| `cgstValue/sgstValue/igstValue` | `totals.cgst/sgst/igst` | `sgstValue` carries SGST **or UTGST**, as in the model |
| `cessValue` | `totals.cess` | J: "sum of cess and cessNonAdvol at item level" (the model's `cess` already includes non-advol) |
| `cessNonAdvolValue` | `"0.00"` | J maps `0` (decision D-Q2) |
| `otherValue` | `totals.otherCharges + totals.roundOff` (signed, 2 dp) | J: `OthChrg + StCesVal − Discount + RndOffAmt`; the model has no state cess and no invoice-level discount |
| `totInvValue` | `totals.grandTotal` | |
| `transMode` | from `transport.mode`; omitted if absent | §3 |
| `transDistance` | `transport.distanceKm` (JSON **string**) | H schema |
| `transporterId/transporterName` | `transport.transporterId/transporterName`; omitted if absent | |
| `transDocNo/transDocDate` | `transport.transportDocNo` / `transportDocDate` → `DD/MM/YYYY`; omitted if absent | |
| `vehicleNo/vehicleType` | from `transport`; omitted if absent | |
| `itemList[i].productName` | omitted | J: "no value will be stored in product name" |
| `productDesc` | `description` | H max 100; never truncated (Q3) |
| `hsnCode` | `hsnSac` as a JSON number | Q2 |
| `quantity/qtyUnit` | `quantity` / `unit`; both omitted for a line without quantity | |
| `taxableAmount` | `taxableValue` | |
| `cgstRate/sgstRate/igstRate` | INTRA: `gstRate/2`, `gstRate/2`, `0`. INTER: `0`, `0`, `gstRate`. `BILL_OF_SUPPLY`: all `0` | J. The split comes from V-G9; D-Q1 covers bills of supply |
| `cessRate` | `cessRate ?? "0"` | |
| `cessNonadvol` | `"0"` | it is a **rate** (K4 lists it in Rs., Decimal(6,3)), and the model only has an amount. J maps `0` (D-Q2) |

- **All lines are mapped**, including service lines, because H only forbids an all-service list.
- The output never contains `dispatchFromGSTIN`, `dispatchFromTradeName`, `shipToGSTIN` or `shipToTrdName` (§3).

## 6. EWB by IRN and `EwbDtls`
- `toEwbByIrnRequest(irn: string, movement): MapResult<EwbByIrnRequest>`:
  - `Irn` = `irn`.
  - `Distance` = `distanceKm` (JSON number).
  - `TransMode`, `TransId`, `TransName`, `TransDocNo`, `TransDocDt` (DD/MM/YYYY), `VehNo`, `VehType` from `transport`; each omitted if absent.
  - `DispDtls = { Nm: name, Addr1, Addr2, Loc, Pin, Stcd }` from `dispatchFrom`.
  - `ExpShipDtls = { Addr1, Addr2, Loc, Pin, Stcd }` from `shipTo`.
  - `Stcd` is emitted 2-digit, as in einvoice (D5 there).
  - Neither the IRN nor the document is needed beyond that. Export port and dispatch addresses may be supplied here when the IRN lacked them (I validations).
- `toIrnEwbDtls(movement)` returns `{ TransId, TransName, TransMode, Distance, TransDocNo, TransDocDt, VehNo, VehType }`. The type is `IrnRequest["EwbDtls"]` from `@india-gst-kit/einvoice`, if Q1 allows the dependency. Dispatch and ship-to belong in the IRN's own `DispDtls`/`ShipDtls`, which `einvoice` does not yet map (its §11). The caller attaches the block, and `validateIrnRequest` runs on the result.

## 7. Schemas (`src/schema.ts`)
`EwbRequestSchema` (H) and `EwbByIrnRequestSchema` (I) are Zod transcriptions of **every** constraint in the source files: lengths, patterns, enums, min/max and required fields, using the string number types from §2. Unknown keys are rejected.

**Source quirks.** Each is normalised and listed in a comment citing the source:
- **H, GSTIN patterns.** H's patterns are unanchored and use `[0-9|A-Z]` (a literal `|` in the class). They are read as `^[0-9]{2}[0-9A-Z]{13}$`, which is stricter. `fromGstin`/`toGstin` additionally accept exactly `"URP"`, overriding `minLength 15` (§13 D2).
- **H, `docDate`.** The unanchored date pattern is anchored. Its year part `20[1-2][0-9]` stays (§13 D3).
- **H, `itemList`.** `items: [ {…} ]` (array form) is read as "every item".
- **H, empty strings.** Optional string fields equal to `""` are treated as **absent** when validating (decision D-Q4): `transporterName`, `transporterId`, `transDocNo`, `transDocDate`, `vehicleNo`, `vehicleType` and `subSupplyDesc`. H's own sample sends `""`, and I/C say such fields "should be null or attributes should not have been passed". The mapper never emits `""`.
- **I, top level.** I lists its properties at the top level, without `type`/`properties`, and puts `$schema` and `required` beside them. They are read as an object schema whose properties are all keys except `$schema` and `required`.
- **I, character classes.** `[A-Z|a-z|0-9]` and `[O|R]` are read without `|`; for `VehType` the enum applies.

**Conformance test.** As in einvoice §4, it loads both source files, applies the quirk normalisation, and asserts leaf by leaf that the Zod schemas enforce the same constraints. It probes boundary values generated from the source.

## 8. Validation
```ts
validateEwbRequest(req: unknown, options?: {
  asOf?: IsoDate;                       // "current date", for V-G5; checks needing it are skipped if absent
  supplierEInvoiceEnabled?: boolean;    // V-G17
  gstinCheckDigit?: "enforce" | "off";  // default "enforce", as einvoice D8
  rspHsnRelaxation?: boolean;           // V-G10, default false
}): EwbValidationResult                 // { ok; value?; issues: EwbIssue[] }
validateEwbByIrnRequest(req: unknown, options?: { docDate?: IsoDate }): EwbValidationResult
validateEwbDtls(block: unknown, options?: { docDate?: IsoDate }): EwbValidationResult
type EwbIssue = { path: (string | number)[]; code: EwbIssueCode; rule: string; message: string; severity: "error" | "warning" };
```
- `ok` = no issue with severity `error`.
- `rule` is a stable id: `S-…` for schema rules, `V-T…` for transport rules, `V-G…` for Generate rules, `V-B…` for by-IRN rules.
- Every rule lives in `src/rules.ts` with a `// Source:` header and has a row in `docs/legal-facts.md`.

### 8.1 Transport rules (all three routes)
Each rule names the route variants where the sources differ.
| Id | Rule | Source |
|---|---|---|
| V-T1 | Mode absent ⇒ `transporterId` present, and vehicle number, vehicle type, transport doc number and date absent ("Part-A only") | H: "Passing transporterId is mandatory for generating Part A Slip and transDocNo, transMode and vehicleNo should be blank"; I/C |
| V-T2 | ROAD ⇒ vehicle number **and** vehicle type present; transport doc optional | I/C ("Vehicle number and vehicle type should be passed"); H |
| V-T3 | RAIL or AIR ⇒ transport doc number **and** date present; vehicle number and type absent | I/C; H says only "transport document number is must", so the stricter I/C rule applies to all routes |
| V-T4 | SHIP: **varies by route** (§13 D1). H: transport doc number required; vehicle number required if vehicle type is `O`. I: doc number and date required, vehicle absent. C (`EwbDtls`): vehicle number or doc number + date or both; vehicle type must be `O` | H, I, C |
| V-T5 | RAIL ⇒ transport doc number starts with `P`, `F` or `L` (Parcel / FOIS / Leased wagon). **Error** on H, **warning** on I and C, which do not state it | H, L (02/12/2025) |
| V-T6 | Vehicle number matches one of K1's shapes (§8.4). **Warning**: the shapes are illustrative, and the real check is the Vahan database | K1, H |
| V-T7 | Transport doc date ≥ document date (when known: H `docDate`; the `docDate` option for I/C) | H |
| V-T8 | Distance is an integer 0–4000. When both PINs are known and equal: 1–100 | H ("cannot be greater than 4000"; equal PINs "maximum 100"), I/C ("1 to 100") |
| V-T9 | `transporterId` matches `^[0-9]{2}[0-9A-Z]{13}$`. The check digit is **not** checked: a TRANSIN algorithm is not in the sources | H, I, C |

### 8.2 Generate rules (V-G)
| Id | Rule | Source |
|---|---|---|
| V-G1 | `supplyType ∈ {O, I}`, `subSupplyType ∈` K1 1–12, `docType ∈` K1 | H, K1 |
| V-G2 | `subSupplyType = 8` ⇔ `subSupplyDesc` present (≤ 20 characters) | H |
| V-G3 | (`supplyType`, `subSupplyType`, `docType`) is a row of K3. Where K3's party column says "Self" for both parties, `toGstin = fromGstin`; where it says "Other GSTIN/URP", they differ | K3, H "Document type is validated against the supply and sub supply type" |
| V-G4 | `docNo` matches `^[A-Za-z0-9/-]{1,16}$` | H ("Alphanumeric with / and - are allowed", max 16) |
| V-G5 | `docDate` is a real calendar date. With `asOf`: `docDate ≤ asOf`, and `asOf − docDate ≤ 180 days` | H ("less than or equal to current date"; "within 180 days of Document Date", L: effective 01/01/2025) |
| V-G6 | `fromGstin`/`toGstin` are `URP` or pass `isGstinStructurallyValid`; the check digit is checked if `gstinCheckDigit = "enforce"` | H |
| V-G7 | All four state codes are in K2 (or 96, read as 99). For a non-URP GSTIN, the bill-from/bill-to state code equals the GSTIN prefix, or 99 (SEZ, H) | H, K2 |
| V-G8 | PIN code vs state: `fromPincode`/`actFromStateCode` and `toPincode`/`actToStateCode` use the first-3-digit ranges of `sources/einvoice/master-codes/state-pincode-ranges.csv`. **Warning**: the portal's PIN master is not available. Both PINs must be 6 digits (H data structure Number(6)) | H |
| V-G9 | Tax split: INTRA iff `fromStateCode = toStateCode`. INTRA ⇒ `igstValue = 0` and every `igstRate = 0`. INTER ⇒ CGST/SGST values and rates are 0 | H ("In case of one of the party is SEZ unit, then IGST" is covered by 99) |
| V-G10 | `totalValue + cgstValue + sgstValue + igstValue + cessValue + cessNonAdvolValue + otherValue ≤ totInvValue + 2.00`. Skipped if `rspHsnRelaxation` (Notification 20/2025; its HSN list is not in `sources/`) | H, L (23/01/2026) |
| V-G11 | 1 ≤ items ≤ 250. `hsnCode` is an integer of at most 8 digits. At least one HSN does not start with `99` | H |
| V-G12 | `qtyUnit` ∈ K1 units (identical to the model's `UQC_CODES`). `quantity` beyond Decimal(8,2) (more than 2 dp or ≥ 10⁶) is a **warning** (Q5) | H, K1 |
| V-G13 | Money fields ≤ 2 dp; rates ≤ 3 dp (`multipleOf`) | H schema |
| V-G14 | "GSTR1 fields" present: the seven value fields; per item `cgstRate`, `sgstRate`, `igstRate`, `cessRate`, `cessNonadvol`, `taxableAmount` | H |
| V-G15 | The address character sets from H's data structure. Addresses may contain only letters, digits, spaces and `# - /`; places only letters and spaces. **Warning** (Q6) | H data structure |
| V-G16 | `transactionType ∈ 1..4` | H, K1 |
| V-G17 | `supplierEInvoiceEnabled = true`, `docType = INV`, `docDate ≥ 01/10/2020`, and either `toGstin ≠ URP` with `subSupplyType = 1`, or `subSupplyType = 3` ⇒ error `USE_IRN_ROUTE`. If the option is `undefined`, a warning | H |

### 8.3 By-IRN rules (V-B)
| Id | Rule | Source |
|---|---|---|
| V-B1 | `Irn` is 64 characters (schema); not 64 lowercase hex ⇒ warning (the format in einvoice §8.2) | I |
| V-B2 | `Distance` present (the only `required`) | I |
| V-B3 | `DispDtls` requires `Nm, Addr1, Loc, Pin, Stcd`; `ExpShipDtls` requires `Addr1, Loc, Pin, Stcd` | I |
| V-B4 | `Stcd` is in the **e-invoice** state master (the model's `STATE_CODES`, source A). This route is the e-invoice system's; K2 belongs to the EWB system | I |
| V-B5 | `Pin` vs `Stcd` first-3-digit range: warning, as V-G8 | I |

### 8.4 Vehicle-number shapes (V-T6)
This is UNVERIFIED reading of K1's examples: `A` = letter, `1` = digit, `X` = letter or digit. Whole string upper case with no spaces.
- `^[A-Z]{2}\d{2}\d{4}$` (`AB121234`)
- `^[A-Z]{2}\d{2}[A-Z]\d{4}$`
- `^[A-Z]{2}\d{2}[A-Z]{2}\d{4}$`
- `^[A-Z]{3}\d{4}$`
- `^[A-Z]{2}\d{3}[A-Z]\d{4}$`
- `^[A-Z]{2}\d{2}[A-Z]{3}\d{4}$`
- `^DF[A-Z0-9]{6}$`
- `^(TM|BP|NP)[A-Z0-9]{5,13}$` ("at least 7 characters"; H max 15)

The first two letters "are State Code", but the list of valid prefixes is **not** in the sources (sources finding E9), so prefixes are not checked. Lengths are also checked: H 7–15, I/C 4–20 (§13 D6).

## 9. Not checkable offline (documented, not implemented)
- The ±10 % PIN-to-PIN distance check, and distance auto-calculation.
- Vahan vehicle existence; HSN master; PIN master.
- GSTIN status: active, cancelled within the document period, or blocked for non-filing.
- TDS/TCS GSTINs as supplier; TRANSIN as supplier or buyer; taxpayer type (whether a GSTIN is SEZ). The portal's tax-rate list (§13 D8).
- Duplicate EWB per document number; the requester-GSTIN-vs-role rules (supplier ⇒ `fromGstin`, and so on).

## 10. Responses (`src/response.ts`)
Decrypted `data` only; decryption belongs to `gsp`. Parsing uses lossless numbers and is lenient. Unknown keys are `UNEXPECTED_KEY` **warnings**, and the raw JSON is returned, as in einvoice D-Q5.
- **Generate (H):** `{ ewayBillNo: EwbInt, ewayBillDate: string, validUpto: string, alert?: string }`. The dates are kept as strings: H's samples disagree (`"25/09/2018  10:30:00 AM"`, `"12.00:00 PM"`, and the base64 example's `"16 / 09 / 2017 10: 30: 00 AM"`). A date that does not match `^\d{2}/\d{2}/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+[AP]M$` is a warning.
- **By IRN (I):** `{ EwbNo: EwbInt, EwbDt: "YYYY-MM-DD HH:mm:ss", EwbValidTill: same format or null, Remarks?: string }`. `EwbValidTill: null` is accepted, because a Part-A-only EWB has no validity (UNVERIFIED).

## 11. Exports
- **Functions:** `ewbRoute`, `toEwbRequest`, `toEwbByIrnRequest`, `toIrnEwbDtls`, `validateEwbRequest`, `validateEwbByIrnRequest`, `validateEwbDtls`, `serializeEwbRequest`, `parseEwbRequestJson`, `serializeEwbByIrnRequest`, `parseEwbByIrnRequestJson`, `parseEwbResponseData`, `parseEwbByIrnResponseData`.
- **Constants:** `EWB_STATE_CODES` (K2), `EWB_MAX_ITEMS = 250`, `EWB_MAX_DISTANCE_KM = "4000"`, `EINVOICE_EWB_BLOCK_FROM = "2020-10-01"`, `EWB_MAX_DOC_AGE_DAYS = 180`.
- **Schemas and types:** `EwbMovementSchema`/`EwbMovement`, `EwbTransportSchema`, `EwbRequestSchema`/`EwbRequest`, `EwbByIrnRequestSchema`/`EwbByIrnRequest`, `EwbIssue`.

No function throws on bad data. They throw only on programmer errors.

## 12. Test list (Vitest; written first)
**route**
- B2B tax invoice, e-invoice enabled, dated 2020-10-01 → `IRN`; dated 2020-09-30 → `GENERATE`.
- Export with e-invoice enabled → `IRN`.
- B2C, or a bill of supply, with e-invoice enabled → `GENERATE`.
- Unknown e-invoice status → `GENERATE` plus an `EINVOICE_STATUS_UNKNOWN` warning.
- CRN/DBN → `NONE`; all-services → `NONE`.

**mapping (`toEwbRequest`)**
- Intra B2B: CGST/SGST rates are `gstRate/2`, `toStateCode` = recipient state, `transactionType 1`, dates reformatted, state codes are integers (`3`, not `"03"`).
- Inter B2B: IGST only.
- UT recipient: `sgstValue` carries UTGST.
- B2C: `toGstin "URP"`. A recipient without a PIN and no `shipTo` → `MISSING_PIN`.
- SEZ with and without payment: `toStateCode 99`, `actToStateCode` = actual state, IGST.
- Export: `subSupplyType "3"`, `toStateCode 99`, the port address as `to*`; no `shipTo` → `EXPORT_NEEDS_PORT_SHIP_TO`.
- `shipTo` only → type 2; `dispatchFrom` only → 3; both → 4, with addresses taken from them and names and GSTINs from the bill parties.
- Bill of supply → `BIL`, all rates 0.
- Cess: `cessValue = totals.cess`, `cessNonAdvolValue "0.00"`, item `cessNonadvol "0"`.
- `otherValue` = otherCharges + roundOff, including a negative result.
- A service line without quantity: no `quantity`/`qtyUnit`.
- A description over 100 characters → validation error, not truncated.
- HSN `0101` → `HSN_LEADING_ZERO`.
- Recipient state ≠ place of supply → `STATE_SPLIT_MISMATCH`.
- 251 lines → V-G11 error.
- Part-A only (transporter ID, no mode) → no vehicle or doc fields.
- Never emits `""`, `shipToGSTIN` or `dispatchFromGSTIN`.
- Every goods fixture in `packages/fixtures` maps with `ok: true`, given a valid movement.

**mapping (by IRN / EwbDtls)**
- Fields are mapped and omitted correctly; `Distance` is a number; `Stcd` is 2-digit.
- `DispDtls` gets the name; `ExpShipDtls` has no `Gstin`.
- `toIrnEwbDtls` output passes `validateIrnRequest` when attached to a mapped einvoice fixture (if Q1 allows the dependency).

**serialise/parse**
- `transDistance` is written as a JSON string and `Distance` as a number.
- `"otherValue": "-100"` (a string) is rejected.
- Money `"99999999999999.99"` round-trips byte-exact.
- `1e3`, `+1` and `01` are rejected.
- Key order is stable, and parse → serialise is idempotent.

**schema conformance**
- Both Zod schemas match every leaf constraint of their source files (§7).
- The quirk list is asserted explicitly.
- An unknown key is rejected.
- `URP` is accepted in `fromGstin`/`toGstin`, but not in `transporterId`.

**validation**
- One passing and one failing case for every V-T, V-G, V-B and S rule, each asserting `rule` and `path`.
- V-T4: the same Ship payload gives a different result per route, as specified.
- V-T5: an error on H and a warning on I.
- V-G5 boundaries: 180 days accepted, 181 rejected; `docDate = asOf` accepted, `asOf + 1` rejected; no `asOf` ⇒ skipped.
- V-G10: sum = totInv + 2.00 accepted, + 2.01 rejected, and skipped with `rspHsnRelaxation`.
- V-T8: 4000 accepted, 4001 rejected; equal PINs with distance 0 or 101 rejected.
- V-G8, V-G12, V-G15 and V-T6 produce warnings only.

**official samples** (read from `sources/`, never copied into fixtures)
- H sample: `parseEwbRequestJson` reports `otherValue` as a string (type error).
- With that one field coerced in the test:
  - `29ABCDE8755F1Z2` fails the V-G6 check digit, and passes with `gstinCheckDigit: "off"`;
  - V-G3 fails (`fromGstin = toGstin` for sub-type 1);
  - V-G7 fails (`toStateCode 27` with a `29` GSTIN);
  - V-G10 passes (57100.23 ≤ 68360.00);
  - `vehicleNo "PVC1234"` matches a V-T6 shape;
  - the `""` fields count as absent (D-Q4).
- I sample: `Irn ""` fails V-B1 / the schema, and `TransId "12XXXXXX"` fails length 15 and V-T9. No other errors are expected; confirm this at build time.
- Response samples: H's decrypted sample parses, with `ewayBillNo "123456789012"` and a warning on `validUpto "12.00:00 PM"`. I's sample parses with `EwbNo "111008683051"`.

**api surface**
- No default exports. Types are `z.infer`.

**data rules**
- Synthetic data only, using only the GSTINs in `packages/fixtures/src/gstins.ts`. Transporter IDs in fixtures are synthetic GSTINs from that file.

## 13. Deviations and source contradictions (follow the sources, report)
- **D1. The Ship-mode rules differ in H, I and C** (sources finding E2). Each route's validator applies its own source's rule (V-T4). Q8 asks whether to unify them.
- **D2. URP vs the GSTIN schema.** H's schema says `fromGstin`/`toGstin` are exactly 15 characters with a GSTIN pattern, but its validations say to pass `URP`. Following the schema would make every B2C e-way bill impossible, so `URP` is accepted. Only the exact string `URP` is accepted.
- **D3. The `docDate` year pattern** `20[1-2][0-9]` rejects 2030 and later, as in einvoice D2. Kept.
- **D4. Distance types and range.**
  - The type is a string in H, a number in I/C, and `Number(5)` in H's data structure.
  - H's description says "<4000 km", but its validation says "cannot be greater than 4000" and its data structure says "Max Value = 4000". 4000 is accepted.
- **D5. `fromTrdName`/`toTrdName`.** H's schema calls these "Trade Name" and its data structure "LegalName". J maps them from `TrdNm`. We emit `tradeName ?? legalName`.
- **D6. Vehicle number length.** H: 7–15, no pattern. I/C: 4–20, `[A-Z|a-z|0-9]`. Each route applies its own schema. Our input (§3) accepts upper case only.
- **D7. State masters differ.** K2 (EWB) has no 25 and no 96, and 26 is the merged UT. Source A (e-invoice) has both. The Generate route validates against K2 (`EWB_STATE_CODES`, a new legal list); the by-IRN route uses source A.
  - The mapper emits 99, never 96, for SEZ and exports.
  - A document whose recipient or dispatch state is 25 cannot be mapped to the Generate route: K2 lacks 25 (V-G7).
- **D8. K4's tax-rate list is undated**, includes IGST 0.5 % (withdrawn per source C) and is not enforced (CLAUDE.md: no rate list without notifications and a CA). The portal will still reject rates outside its list; that is reported as "not checkable offline".
- **D9. `toPincode`** has no min/max in H's schema, unlike `fromPincode`. The data structure says Number(6), so V-G8 requires 6 digits for both.
- **D10. `quantity`** is Decimal(8,2) in H's data structure, while the schema has no limit and the model allows 3 dp. This is a warning only (Q5).
- **D11. The official samples are inconsistent** (sources finding E5). The tests assert their exact failures rather than treating them as valid.

## 14. Open questions (owner/CA decision needed before the build)
- **Q1. Dependency on `einvoice`.** The lossless JSON reader (`einvoice/src/lossless.ts`) and the PIN ranges (`pin-ranges.ts`) are needed here too, as is the `IrnRequest["EwbDtls"]` type. Options:
  - (a) `ewaybill` depends on `@india-gst-kit/einvoice`, which adds named exports `parseJsonLossless` and `PIN_RANGES`;
  - (b) move both into `@india-gst-kit/model`;
  - (c) duplicate them.

  *Proposed: (a).*
- **Q2. HSN with a leading zero** (chapters 01–09; e.g. `0101`). H types `hsnCode` as a JSON number, so the leading zero cannot be sent. Does the portal read `101` as `0101`? *Proposed: mapping error `HSN_LEADING_ZERO` until confirmed* (no silent change). The IRN routes are unaffected, because `HsnCd` is a string there.
- **Q3. `productDesc` > 100 characters** (the model allows 300). J says the portal itself keeps "first 100 characters" on the IRN route. *Proposed: a validation error on the Generate route, never truncated (as einvoice D4).* The alternative is to truncate with a warning.
- **Q4. `toStateCode`: recipient state or place of supply?** H's data structure describes `toStateCode` as "State of Supply", and J maps it from `BuyerDtls.Stcd`. H's tax-split rule compares `fromStateCode` with `toStateCode`, but the model splits on `placeOfSupply`. *Proposed: emit `recipient.stateCode` (J), and refuse to map (`STATE_SPLIT_MISMATCH`) when the two splits disagree.* Needs CA.
- **Q5. Quantity precision:** should > 2 dp be an error, given Decimal(8,2)? *Proposed: a warning.*
- **Q6. Address character sets** (V-G15): "Valid Special Chars #,-,/". Is a comma or full stop rejected by the portal? *Proposed: a warning.*
- **Q7. Ship-to GSTIN.** It is on hold (L, 30/07/2026). When it is re-enabled, `shipTo` gains `gstin`/`tradeName`, and the withdrawn L rule (22/05/2026) that bill-to/ship-to needs "3 different parties" may return. *Proposed: not in v0.1.*
- **Q8. Ship mode.** Keep per-route rules (D1), or apply one stricter combined rule? *Proposed: per route.*
- **Q9. Zero-rated exports and SEZ supplies without payment.** Per J, `igstRate = gstRate` while `igstValue = 0`. Is that what the portal expects on the Generate route, or should the rate be 0? *Proposed: follow J* (decision D-Q1). Bills of supply send rate 0.
- **Q10. Supplier is an SEZ unit** (outward). H defines 99 only for an SEZ **recipient** (outward) or an SEZ **supplier** on inward. *Proposed: `fromStateCode` = actual state.* Needs CA.

## 15. Decisions (draft; each UNVERIFIED — needs CA)
- **D-Q1** Rates: INTRA `gstRate/2` each; INTER `igstRate = gstRate`, including zero-rated supplies with zero values (J). Bill of supply: all rates 0.
- **D-Q2** Cess: `cessValue = totals.cess`, `cessNonAdvolValue = 0`, item `cessNonadvol = 0` (J). The model has no per-unit non-advol rate.
- **D-Q3** Exports need `shipTo` = the port address in India, for both the Generate and IRN routes (I/C validations; H "actual distance being travelled in the country").
- **D-Q4** `""` in optional H string fields is treated as absent when validating; the mapper never emits `""`.

## 16. Deferred
- Inward EWBs; delivery challans, bills of entry and "others"; sub-types other than 1 and 3.
- Ship-to/dispatch-from GSTINs (Q7).
- Part-B update, cancel, reject, extend, consolidated and multi-vehicle EWBs.
- Validity calculation; error-code descriptions.
- The RSP HSN list (Notification 20/2025-CT, **file to attach**: the notification PDF from cbic-gst.gov.in).
- The vehicle-registration state prefix list (**file to attach**: an official list of RTO state codes, if one exists).
- The portal tax-rate list (needs rate notifications and a CA).
- `DispDtls`/`ShipDtls` mapping in `einvoice`.

## 17. Stop conditions
As in CLAUDE.md. Specific to this package:
- `EWB_STATE_CODES`, the K3 mapping and the K1 code lists are legal lists the package **enforces**. Each lives in its own file with a `Source`/`Retrieved`/`Status` header and a `docs/legal-facts.md` row. If a source file is missing at build time, stop.
- If H and I/C disagree in a way §13 does not cover, apply the stricter rule and report it.
- Never use `29ABCDE8755F1Z2`, or the GSTINs hidden in the HTML comments, as valid data.

## 18. `docs/legal-facts.md` rows to add (at build time)
Each row: source URL (H, I, J, K1–K4, L), retrieved 2026-10-16, status UNVERIFIED — needs CA. Files are under `packages/ewaybill/src/`.
- EWB state list (K2) and 96 → 99 (`states.ts`).
- Supply types, sub-types, document types, modes, vehicle types and transaction types (K1, `codes.ts`).
- Sub-type × document-type × party mapping (K3, `doc-type-mapping.ts`).
- Route blocking for e-invoice-enabled suppliers from 2020-10-01 (`route.ts`).
- 180-day document age (effective 2025-01-01).
- ≤ 250 items; distance 0–4000; same-PIN distance 1–100.
- ₹2.00 grace on the total invoice value, and the RSP relaxation from 2026-02-01 (`rules.ts`).
- Rail document prefixes P/F/L (from 2025-12-02).
- The vehicle-number shapes (K1, as interpreted in §8.4).
- The transport-mode rules, including the three Ship variants.
- The IRN → EWB field mapping (J, `map.ts`).
- The decisions D-Q1 to D-Q4, one row each, marked "Design decision".
