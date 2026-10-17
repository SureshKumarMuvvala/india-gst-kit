# Spec — `@india-gst-kit/einvoice` (v0.1)

Status: approved 2026-10-16; **Track E draft 2026-10-17** (`DispDtls`/`ShipDtls`, §3.1, V29–V30 — not yet approved). Every legal/official fact referenced here is **UNVERIFIED — needs CA** until a chartered accountant signs it off in `docs/legal-facts.md`. Source **C** = `sources/einvoice/generate-irn-json-schema.json` (schema) and `sources/einvoice/generate-irn-validations.txt` (validations), captured 2026-10-16 from https://einv-apisandbox.nic.in/version1.03/generate-irn.html. Sample = `sources/einvoice/sample-signed-einvoice.json` (https://einvoice1.gst.gov.in/Documents/SampleJson.json). Where source C contradicts the model spec, **source C wins** (§10).

## 1. Purpose and scope
- **In scope:**
  - `toIrnRequest(doc)` maps a parsed `GstDocument` (`@india-gst-kit/model`) to the IRN request payload, Version `"1.1"`.
  - `validateIrnRequest(req)` validates a payload, ours or anyone else's, against the schema and the offline-checkable validations, including the ±1 rupee tolerance.
  - `serializeIrnRequest` / `parseIrnRequestJson` handle JSON text in and out with exact decimals.
  - `decodeSignedInvoice(jwt)` / `decodeSignedQrCode(jwt)` **decode only**.
- **Out of scope:**
  - HTTP/GSP calls, auth and encryption (package `gsp`).
  - Computing the IRN hash (no algorithm in `sources/`).
  - Signature verification (TODO, §8.4).
  - E-way bill details (package `ewaybill`).
  - Export details, payment, reference and additional-document blocks (the model has no data for them, §11). Dispatch-from and ship-to **are** mapped (§3.1).
  - Checks that need the portal's databases (§5.5).
- ESM only, named exports, Zod 4 (peer `^4.0.0`), `decimal.js`, and `@india-gst-kit/model` as a dependency (`workspace:^`). Types are `z.infer`. Objects use `z.strictObject`.

## 2. Numbers and JSON
The schema types amounts, quantities, rates and PIN codes as JSON **numbers**. Per CLAUDE.md they are **strings** in memory.
- `IrnDecimal` = string `/^-?\d+(\.\d+)?$/` (no exponent, no leading `+`). `IrnInt` = string `/^\d+$/`.
- `serializeIrnRequest(req): string` writes those strings as **raw JSON number literals**, never through `Number`, in the schema's key order, as compact JSON. Values such as the ValDtls maximum `99999999999999.99` need 16 significant digits, more than a double can hold.
- `parseIrnRequestJson(text)` uses `JSON.parse` with the reviver `context.source` (Node ≥ 22; verified on 22.22) to turn every number into its source text, then runs `IrnRequestSchema.safeParse`. A JSON string where the schema expects a number is a type error, and so is the reverse.
- Note (decision 2026-10-16, `docs/specs/recon.md` D-P1): the lossless-JSON helper (`src/lossless.ts`: `JsonNumber`, `parseJsonLossless`, `convertNumbers`, `parseLenient`, plus the parts of `zod-walk.ts` they need) moves to `@india-gst-kit/model`. `einvoice` will import it from there, with no change in behaviour. The move is done in the recon build PR, with a changeset.
- `toIrnRequest` emits money with exactly 2 dp (`"747.50"`), rates and quantities as in the model, and `Pin` as 6 digits.

## 3. Mapping `GstDocument` → IRN request (`toIrnRequest`)
`toIrnRequest(doc: GstDocument, options?: { version?: string }): MapResult`, where `MapResult = { ok: true; value: IrnRequest } | { ok: false; issues: IrnIssue[] }`. The input must already have passed `parseGstDocument`. The mapper never throws on data problems, and it runs `validateIrnRequest` on its own output, so `ok: true` means the payload passed validation.

**Preconditions.** Each of these is a mapping error with code `NOT_EINVOICEABLE`:
| Condition | Source |
|---|---|
| `kind = BILL_OF_SUPPLY` | schema `DocDtls.Typ` ∈ INV/CRN/DBN |
| recipient has no GSTIN and the category is not `EXPORT_*` (B2C) | validations: "B2C … should not request for IRN" |
| `supplier.registrationType = SEZ_UNIT` | "In case the supplier is SEZ unit, then he cannot generate e-Invoice" |
| `supplier.address.pincode` missing | schema `SellerDtls.Pin` required |
| `supplier.registrationType = COMPOSITION` | composition suppliers issue no tax invoice (model §5.6 rule 3); a composition CRN/DBN has no basis in source C, so it is rejected and flagged for CA |
| recipient has a GSTIN and the category is `EXPORT_*` | decision D-Q2 (§12) |

**Field mapping:**
| IRN field | From model | Notes |
|---|---|---|
| `Version` | `"1.1"` | validations: "Presently it should be passed as '1.1'" |
| `TranDtls.TaxSch` | `"GST"` | |
| `TranDtls.SupTyp` | `supplyCategory`: DOMESTIC→`B2B`, SEZ_WITH_PAYMENT→`SEZWP`, SEZ_WITHOUT_PAYMENT→`SEZWOP`, EXPORT_WITH_PAYMENT→`EXPWP`, EXPORT_WITHOUT_PAYMENT→`EXPWOP`, DEEMED_EXPORT→`DEXP` | |
| `TranDtls.RegRev` | `reverseCharge ? "Y" : "N"` | always emitted |
| `TranDtls.IgstOnIntra` | `"N"` | the model has no IGST-on-intra concept (§11) |
| `TranDtls.EcmGstin` | omitted | not in the model (§11) |
| `DocDtls.Typ` | TAX_INVOICE→`INV`, CREDIT_NOTE→`CRN`, DEBIT_NOTE→`DBN` | |
| `DocDtls.No` | `number` | same pattern as the model |
| `DocDtls.Dt` | `date` `YYYY-MM-DD` → `DD/MM/YYYY` | |
| `SellerDtls.Gstin/LglNm/TrdNm` | `supplier.gstin/legalName/tradeName` | `TrdNm` omitted if absent |
| `SellerDtls.Addr1/Addr2/Loc/Pin/Stcd` | `supplier.address.line1/line2/city/pincode/stateCode` | `Stcd` 2-digit (`"03"`, as in the sample; the pattern allows it) |
| `SellerDtls.Ph/Em` | omitted | not in the model |
| `BuyerDtls.Gstin` | `recipient.gstin`; `"URP"` for `EXPORT_*` | validations: direct export ⇒ URP |
| `BuyerDtls.Pos` | `placeOfSupply`; `"96"` for `EXPORT_*` | |
| `BuyerDtls.Stcd` | `recipient.stateCode`; `"96"` for `EXPORT_*` | |
| `BuyerDtls.Pin` | `recipient.address.pincode`; `999999` for `EXPORT_*`; omitted if absent | "PIN code should be 999999" for exports |
| `BuyerDtls.LglNm/TrdNm/Addr1/Addr2/Loc` | the recipient's fields | |
| `ItemList[i].SlNo` | `String(lineNo)` | |
| `PrdDesc` | `description` | |
| `IsServc` | `isService ? "Y" : "N"` | |
| `HsnCd` | `hsnSac` | |
| `Qty` / `Unit` / `UnitPrice` | `quantity` / `unit` / `unitPrice` | if there is no quantity: `Qty`/`Unit` omitted, `UnitPrice = TotAmt` (decision D-Q1) |
| `TotAmt` | `grossAmount` | |
| `Discount` | `discount` | line discount |
| `PreTaxVal` | omitted | |
| `AssAmt` | `taxableValue` | |
| `GstRt` | `gstRate` | total rate (CGST+SGST rates for intra), per the validations |
| `IgstAmt/CgstAmt/SgstAmt` | `igst/cgst/sgst` | `SgstAmt` holds SGST **or UTGST** (model §6.5) |
| `CesRt` | `cessRate ?? "0"` | |
| `CesAmt` | `cess − cessNonAdvol` | the model's `cess` = ad valorem + non-advol (model §8.4) |
| `CesNonAdvlAmt` | `cessNonAdvol` | |
| `StateCesRt/StateCesAmt/StateCesNonAdvlAmt` | `"0"` / `"0.00"` / `"0.00"` | not in the model |
| `OthChrg` (item) | `"0.00"` | the model has other charges only at document level |
| `TotItemVal` | `lineTotal` | |
| `ValDtls.AssVal/CgstVal/SgstVal/IgstVal` | `totals.taxableValue/cgst/sgst/igst` | |
| `ValDtls.CesVal` | `totals.cess` | = Σ(CesAmt + CesNonAdvlAmt), per the validations |
| `ValDtls.StCesVal` | `"0.00"` | |
| `ValDtls.Discount` | `"0.00"` | this is the **invoice-level** discount, which the model does not have (it is apportioned into lines). **Never** map `totals.lineDiscount` here: the line discount would be subtracted twice |
| `ValDtls.OthChrg` | `totals.otherCharges` | |
| `ValDtls.RndOffAmt` | `totals.roundOff` | |
| `ValDtls.TotInvVal` | `totals.grandTotal` | |
| `RefDtls.InvRm` | `notes` | omitted if absent; never truncated (validation fails if longer than 100) |
| `RefDtls.PrecDocDtls[0]` | `{ InvNo: originalDocument.number, InvDt: DD/MM/YYYY }` for CRN/DBN | |
| `DispDtls` | from `dispatchFrom` (§3.1); omitted if absent | model §5.7 |
| `ShipDtls` | from `shipTo` (§3.1); omitted if absent | model §5.7 |
| `PayDtls, ExpDtls, EwbDtls, AddlDocDtls, Irn` | omitted | `Irn` must not be sent (validations) |

`BuyerDtls` always describes the **bill-to** party and `BuyerDtls.Pos` is always `placeOfSupply`: a `shipTo` never changes them (model §5.7, D-S5). The tax split (V11) is unaffected.

### 3.1 `DispDtls` / `ShipDtls` (Track E)
Source C schema (`sources/einvoice/generate-irn-json-schema.json`); C validations lines 29–32. All text fields also carry the schema pattern `^([^\"])*$` (no `"`), plus the `\` exclusion of §5.1.

**`DispDtls`** — emitted iff `dispatchFrom` is present. Required by the schema: `Nm, Addr1, Loc, Pin, Stcd`.
| Field | Schema | From model |
|---|---|---|
| `Nm` | string 3–100, **required** | `dispatchFrom.legalName` |
| `Addr1` | string 1–100, **required** | `dispatchFrom.address.line1` |
| `Addr2` | string 3–100, optional | `dispatchFrom.address.line2`; omitted if absent |
| `Loc` | string 3–100, **required** | `dispatchFrom.address.city` |
| `Pin` | number 100000–999999, **required** | `dispatchFrom.address.pincode` (JSON number) |
| `Stcd` | string 1–2, `^(?!0+$)([0-9]{1,2})$`, **required** | `dispatchFrom.address.stateCode`, 2-digit (D5) |

**`ShipDtls`** — emitted iff `shipTo` is present. Required by the schema: `LglNm, Addr1, Loc, Pin, Stcd`.
| Field | Schema | From model |
|---|---|---|
| `Gstin` | string 3–15, `^(([0-9]{2}[0-9A-Z]{13})\|URP)$`, optional | `shipTo.gstin`; **omitted** if absent, never `URP` (model D-S4) |
| `LglNm` | string 3–100, **required** | `shipTo.legalName` |
| `TrdNm` | string 3–100, optional | `shipTo.tradeName`; omitted if absent |
| `Addr1` | string 1–100, **required** | `shipTo.address.line1` |
| `Addr2` | string 3–100, optional | `shipTo.address.line2`; omitted if absent |
| `Loc` | string 3–100, **required** | `shipTo.address.city` |
| `Pin` | number 100000–999999, **required** | `shipTo.address.pincode` (JSON number) |
| `Stcd` | string 1–2, `^(?!0+$)([0-9]{1,2})$`, **required** | `shipTo.address.stateCode`, 2-digit |

- No new precondition: the model guarantees a PIN and an Indian state for both (model §5.7). The schema's other limits (names 3–100, `Loc`/`Addr2` ≥ 3, `Pin` ≥ 100000) are reported by validation; the mapper never truncates (D4).
- Exports: `shipTo` is the port in India (C line 32); `BuyerDtls` stays `URP`/96/96/999999 (V8). `ShipDtls.Gstin` is normally absent.
- `IrnRequestSchema` already transcribes both blocks (`DispDtlsSchema`, `ShipDtlsSchema`) and the conformance test covers them; V5 (`ShipDtls.Gstin`), V7 (`DispDtls.Stcd`, `ShipDtls.Stcd`) and V12 (`DispDtls.Pin`, `ShipDtls.Pin`) already apply to them.

## 4. `IrnRequestSchema` (structural, `src/schema.ts`)
A Zod transcription of **every** constraint in the source schema: lengths, patterns, enums, min/max and required fields, using the string number types from §2.
- **Source quirks.** They are normalised, and each one is listed in a comment that cites the source:
  - keys are trimmed;
  - `" number"` and `"String"` are read as number and string;
  - array-wrapped item schemas (`ItemList`, `AttribDtls`, `PrecDocDtls`, `ContrDtls`, `AddlDocDtls`) are read as arrays of that item;
  - `RefDtls.required: ["InvNo","InvDt"]` applies to each `PrecDocDtls` item;
  - `DocPerdDtls.required` (`" InvStDt "`, `" InvEndDt "`) applies to `InvStDt`/`InvEndDt`.
- **Patterns.**
  - The inline `(?i)` patterns (`SupTyp`, `Typ`) are accepted case-insensitively, as published, and normalised to uppercase.
  - For `[Y|N]` patterns the enum applies: it is stricter, and both must hold.
  - The unanchored `SellerDtls.Gstin` pattern is equivalent to an anchored one at length 15.
- **Numbers.** Numeric min/max are compared with `decimal.js`. Decimal places are capped as the maxima imply: 2 dp for money, 3 for Qty, UnitPrice and rates.
- **Version.** Structurally, `Version` is any string of 1–6 characters. "Must be 1.1" is validation rule V1, so decoded responses (`"1.01"`) still parse.
- **Unknown keys** are rejected (`strictObject`) for request payloads. Decoded responses work differently (§8).
- **Conformance test.** It loads the source JSON, applies the same quirk normalisation, and asserts for every leaf that the Zod schema enforces the same `minLength/maxLength/pattern/enum/minimum/maximum` and the same required set. It probes with boundary values generated from the source, so drift in either direction fails.

## 5. Validation (`validateIrnRequest`)
```ts
validateIrnRequest(req: unknown, options?: {
  asOf?: IsoDate;                        // upper bound for DocDtls.Dt, if given
  earliestDocDate?: IsoDate;             // default "2025-04-01" (V4)
  gstinCheckDigit?: "enforce" | "off";   // default "enforce" (V5)
}): IrnValidationResult                  // { ok: boolean; value?: IrnRequest; issues: IrnIssue[] }

type IrnIssue = {
  path: (string | number)[]; code: IrnIssueCode; rule: string;
  message: string; severity: "error" | "warning";
};
```
`ok` = no issue with severity `error`. `rule` is a stable id: `S-…` for the schema, `V…` below. Every rule lives in `src/rules.ts` with a `// Source:` header and has one row in `docs/legal-facts.md`.

### 5.1 Structural (S)
- `IrnRequestSchema` (§4).
- Free-text fields also reject `\`. The validations text excludes both `"` and `\`; the schema patterns exclude only `"`.
- The serialised payload must be ≤ 2 MB of UTF-8 (S-SIZE).

### 5.2 Document and party rules
| Id | Rule (from the validations text) |
|---|---|
| V1 | `Version === "1.1"` |
| V2 | `Irn` must be absent |
| V3 | `DocDtls.No` does not start with `0`, `/` or `-` (the pattern also enforces this) |
| V4 | `DocDtls.Dt` is a real calendar date, ≥ `earliestDocDate` (default `2025-04-01`, from "IRN requests with Document Date from 01/04/2025 only will be accepted", UNVERIFIED), and ≤ `asOf` if given. The schema's year pattern `20[1-2][0-9]` caps it at 2029 (§10 D2) |
| V5 | `SellerDtls.Gstin`, `BuyerDtls.Gstin` (unless `URP`), `ShipDtls.Gstin` and `EcmGstin` pass the model's `isGstinStructurallyValid`. The check digit is checked with `isValidGstin` when `gstinCheckDigit = "enforce"` (the default; see §10 D8) |
| V6 | The first two GSTIN digits equal `Stcd`, for seller and buyer. Exception: when `SupTyp ∈ EXP*`, the buyer's `Stcd` is 96 |
| V7 | `Stcd` and `Pos` are in the model's `STATE_CODES` (after `normaliseStateCode`); `Pos ≠ 25` (`isPlaceOfSupplyCode`) |
| V8 | `EXPWP/EXPWOP` ⇒ buyer `Gstin = URP`, `Stcd = 96`, `Pos = 96`, and `Pin = 999999` if present (decision D-Q2) |
| V9 | `RegRev = Y` only with `SupTyp ∈ {B2B, SEZWP, SEZWOP}` |
| V10 | `IgstOnIntra = Y` ⇒ seller `Stcd` = `Pos` and `RegRev = Y` |
| V11 | Tax split. INTRA iff seller `Stcd = Pos` and `SupTyp ∈ {B2B, DEXP}` (decision D-Q3) and `IgstOnIntra ≠ Y`; otherwise INTER (exports and SEZ are always inter-state). INTER ⇒ `CgstAmt = SgstAmt = 0` on every item; INTRA ⇒ `IgstAmt = 0` |
| V12 | PIN prefix: the first 3 digits fall in the state's range in `sources/einvoice/master-codes/state-pincode-ranges.csv` (`PIN_RANGES`, model §6.7). **Warning only**: the portal first checks its full PIN master, which we do not have. `999999` is allowed for state 97 and for exports. Applies to `SellerDtls`, `BuyerDtls`, `DispDtls` and `ShipDtls` |
| V29 | `EwbDtls` present and `ShipDtls` absent ⇒ `BuyerDtls.Pin` present. **Warning** (D-S15): C line 100 "Pincode of Recipient GSTIN is mandatory if Ship-To details are not entered" sits under "Validations on e-waybill", and line 106 says the IRN is still generated without the e-way bill |
| V30 | `EwbDtls` present and `SupTyp ∈ {EXPWP, EXPWOP}` ⇒ `ShipDtls` present with `Stcd` not 96/99 (the port in India). **Warning** (D-S15): C lines 32 and 105. Whether the address really is a port cannot be checked offline |

### 5.3 Item rules
| Id | Rule |
|---|---|
| V13 | 1 ≤ number of items ≤ 1000 |
| V14 | `SlNo` is numeric (pattern) and unique |
| V15 | `IsServc = N` ⇒ `Qty` and `Unit` present, and `Unit` ∈ the model's `UQC_CODES` |
| V16 | `IsServc = Y` ⇒ `HsnCd` starts with `99`. This is the model's rule; without the HSN master it is the only offline proxy (UNVERIFIED) |
| V17 | `GstRt ≠ 0.5` ("Tax rate 0.5% is withdrawn"). There is no allowed-rate list: none is in the sources (CLAUDE.md) |

### 5.4 Arithmetic with ±1 rupee tolerance (V20–V28)
`rupeeTolerance(calculated: string): { min: string; max: string }` returns `{ min: floor(calc) − 1, max: ceil(calc) + 1 }`. `withinTolerance(passed, calculated): boolean` is inclusive. Both are exported. This reproduces the three examples in the source:
- 2345.04 → [2344.00, 2347.00]
- 10241.00 → [10240.00, 10242.00]
- 10241.61 → [10240.00, 10243.00]

Calculated values are exact decimals and are never rounded first. A negative calculated value uses the same floor/ceil formula (UNVERIFIED).

Item level. Absent optional amounts count as 0, and `r` = `GstRt`:
- V20 `AssAmt` ≈ `TotAmt − Discount`
- V21 INTRA: `CgstAmt` ≈ `AssAmt × r / 200` and `SgstAmt` ≈ `AssAmt × r / 200`
- V22 INTER: `IgstAmt` ≈ `AssAmt × r / 100`
- V23 `CesAmt` ≈ `AssAmt × CesRt / 100`
- V24 `StateCesAmt` ≈ `AssAmt × StateCesRt / 100`
- V25 `TotItemVal` ≈ `AssAmt + CgstAmt + SgstAmt + IgstAmt + CesAmt + CesNonAdvlAmt + StateCesAmt + StateCesNonAdvlAmt + OthChrg`

Exceptions, all from the validations text:
- `Typ ∈ {CRN, DBN}` ⇒ skip V21–V24.
- `SupTyp ∈ {EXPWOP, SEZWOP}` and `IgstAmt = 0` ⇒ skip V22.
- `RegRev = Y` or `SupTyp = EXPWP` ⇒ V25 passes if it holds **with or without** tax values. "Without" removes the GST and cess amounts (`CgstAmt`, `SgstAmt`, `IgstAmt`, `CesAmt`, `CesNonAdvlAmt`, `StateCesAmt`, `StateCesNonAdvlAmt`) and keeps `OthChrg` (decision D-Q4).
- The withdrawn check `TotAmt ≈ Qty × UnitPrice` is **not** applied.

Document level:
- V26 `AssVal ≈ ΣAssAmt`; `CgstVal ≈ ΣCgstAmt`; `SgstVal ≈ ΣSgstAmt`; `IgstVal ≈ ΣIgstAmt`; `CesVal ≈ Σ(CesAmt + CesNonAdvlAmt)`; `StCesVal ≈ Σ(StateCesAmt + StateCesNonAdvlAmt)`
- V27 `−99.99 ≤ RndOffAmt ≤ 99.99` (schema)
- V28 `TotInvVal ≈ ΣTotItemVal − ValDtls.Discount + ValDtls.OthChrg + RndOffAmt`

### 5.5 Not checkable offline (documented, not implemented)
- Supplier/recipient active status and registration dates.
- Taxpayer type (REG/SED/SEZ/ISD/TCS/Casual), including "deemed exports only for Regular/Casual" and "no reverse charge for ISD".
- The HSN master.
- Duplicate IRN or document number per financial year; cancelled IRNs.
- The full PIN master.
- Vahan and all e-way bill rules.
- The e-commerce operator's TCS registration.

## 6. Exports
`toIrnRequest`, `validateIrnRequest`, `serializeIrnRequest`, `parseIrnRequestJson`, `rupeeTolerance`, `withinTolerance`, `decodeJwt`, `decodeSignedInvoice`, `decodeSignedQrCode`, `IRN_SCHEMA_VERSION = "1.1"`, `DEFAULT_EARLIEST_DOC_DATE = "2025-04-01"`, plus schemas and types: `IrnRequestSchema`/`IrnRequest`, `IrnIssue`, `JwtHeaderSchema`, `SignedInvoiceDataSchema`/`SignedInvoiceData`, `SignedQrDataSchema`/`SignedQrData`.

## 7. Errors
No function throws on bad data; they all return result objects. They throw only on programmer errors, such as a non-string passed to `decodeJwt`.

## 8. JWT decoding (`src/jwt.ts`)
All decoders return `DecodeResult<T> = { ok: boolean; value?: T; raw: unknown; issues: IrnIssue[]; signatureVerified: false }`. `ok` = no issue with severity `error`. `raw` (the decoded JSON as-is) is **always** returned when decoding got that far.

### 8.1 `decodeJwt(token: string)`
Returns `value: { header; claims; signature: string; signingInput: string }`. It splits the token into exactly 3 base64url segments, decodes header and claims as UTF-8 JSON (with lossless numbers, §2), and validates them:
- `JwtHeaderSchema`: `{ alg: "RS256", kid: string, typ: "JWT", x5t: string }`.
- Claims: `{ data: string, iss: string }`.

Issue codes and severities:
- **Errors:** `MALFORMED_JWT` (not 3 segments), `BAD_BASE64URL`, `BAD_JSON`, `UNSUPPORTED_ALG` (`alg ≠ "RS256"`, including `none`), and a missing or wrongly typed required header field or claim.
- **Warning:** `UNEXPECTED_KEY`, for header or claim keys not listed above. The known keys are still validated and returned. Unknown keys never pass silently, and they never block decoding.

### 8.2 `decodeSignedInvoice(jwt)`
Parses `claims.data` (a JSON string) losslessly into `SignedInvoiceDataSchema`: the structural `IrnRequestSchema` plus `AckNo` (IrnInt), `AckDt` (`YYYY-MM-DD HH:mm:ss`), `Irn` (64 lowercase hex characters) and a per-item `ItemNo` (IrnInt).
- Unknown keys at any level are `UNEXPECTED_KEY` **warnings**; the value keeps the known keys and `raw` keeps everything.
- The request-only rules in §5 are **not** applied, because this is a response. Callers may run `validateIrnRequest` on the request part.

### 8.3 `decodeSignedQrCode(jwt)`
`SignedQrDataSchema` = `{ SellerGstin, BuyerGstin, DocNo, DocTyp: INV|CRN|DBN, DocDt: DD/MM/YYYY, TotInvVal: IrnDecimal, ItemCnt: IrnInt, MainHsnCode, Irn }`, exactly the sample's keys. Any other key (e.g. an IRN date) is an `UNEXPECTED_KEY` **warning** (decision D-Q5).

### 8.4 Signature verification — TODO
- **Why it isn't done:** it needs NIC's public signing certificate or key. None is in `sources/`, and the e-invoice sites are unreachable from the build environment. No key is filled from memory.
- **What callers get:** results carry `signatureVerified: false` and the header's `kid`/`x5t`, so a caller can select a key.
- **Future API sketch:** `verifySignedJwt(token, publicKeyPem)` using `node:crypto` RS256.
- **File to attach:** NIC's e-invoice public key/certificate for signature verification (sandbox and production), with the official URL.

## 9. Test list (Vitest; written first)
**mapping**
- Intra B2B invoice: CGST/SGST, `SupTyp B2B`, `Typ INV`, `Dt` reformatted, `Stcd` 2-digit.
- Inter B2B: IGST only.
- UT place of supply: `SgstAmt` carries UTGST.
- Credit note: `CRN` + `PrecDocDtls`. Debit note: `DBN`.
- Category mapping for SEZWP, SEZWOP, EXPWP, EXPWOP and DEXP.
- Export: `URP`/96/96/999999.
- Reverse charge: `RegRev Y`.
- Cess split: `CesAmt = cess − cessNonAdvol`.
- `ValDtls.Discount = 0.00` even when lines carry discounts (regression for double subtraction).
- `OthChrg`, `RndOffAmt` and `TotInvVal` carried over; notes → `InvRm`.
- Service line without quantity: `UnitPrice = TotAmt`, no `Qty`/`Unit`.
- Rejections: bill of supply, B2C, SEZ-unit supplier, composition supplier, missing seller PIN, export to a GSTIN holder.
- Every e-invoiceable fixture in `packages/fixtures` maps with `ok: true` and serialises to valid JSON.
- The output never contains `Irn`.

**serialise/parse**
- `"99999999999999.99"` round-trips byte-exact.
- `1e3`, `+1`, and strings in number fields are rejected.
- Key order is stable; parse → serialise is idempotent.

**schema conformance**
- The Zod schema matches every leaf constraint in the source file (§4).
- The quirk list is asserted explicitly.
- An unknown request key is rejected.
- The `(?i)` enums accept `b2b`.

**validation**
- For each V-rule (V1–V28) and each S-rule: one passing and one failing case, each asserting `rule` and `path`.
- `\` in `PrdDesc` is rejected; a payload over 2 MB is rejected.
- With the default `earliestDocDate`, 31/03/2025 is rejected and 01/04/2025 accepted. **Overriding** `earliestDocDate: "2020-01-01"` accepts 05/08/2020, and `"2025-05-01"` rejects 30/04/2025.
- Year 2030 is rejected (source pattern, D2).
- V12 produces a warning only.
- V12 on `DispDtls.Pin` / `ShipDtls.Pin` (path `["ShipDtls","Pin"]`), warning only.
- V29: `EwbDtls` + no `ShipDtls` + no `BuyerDtls.Pin` → warning; with `ShipDtls` → none; without `EwbDtls` → none.
- V30: export with `EwbDtls` and no `ShipDtls` → warning; with `ShipDtls.Stcd "96"` → warning; with a port ship-to in `27` → none; export without `EwbDtls` → none.
- V5 on `ShipDtls.Gstin`: wrong check digit → error at `["ShipDtls","Gstin"]`; `"URP"` accepted (payloads built elsewhere).

**mapping — ship-to / dispatch-from (Track E)**
- Bill-to–ship-to: `ShipDtls` = `{ Gstin, LglNm, TrdNm, Addr1, Addr2, Loc, Pin, Stcd }` from `shipTo`, in schema key order; `DispDtls` absent.
- `shipTo` without `gstin` / `tradeName` / `line2` → `Gstin` / `TrdNm` / `Addr2` omitted (never `URP`, never `""`).
- Bill-from–dispatch-from: `DispDtls = { Nm, Addr1, Addr2, Loc, Pin, Stcd }` from `dispatchFrom`; `ShipDtls` absent. Combination: both.
- Regular document: neither block.
- Serialised `Pin` is a JSON number; `Stcd` is a 2-digit string (`"03"`).
- `BuyerDtls` and `Pos` are unchanged by `shipTo`: supplier 29, POS 29, `shipTo` in 33 → `Pos "29"`, CGST/SGST, V11 passes.
- Export with a port `shipTo` in 27: `ShipDtls.Stcd "27"`, no `Gstin`; buyer `URP`/96/96/999999; V30 passes once `EwbDtls` is attached.
- Credit note with `shipTo` → `ShipDtls` emitted.
- Length limits reported, not truncated: `shipTo.legalName` of 101 characters → error at `["ShipDtls","LglNm"]`; `city` of 2 characters → `["ShipDtls","Loc"]`; `dispatchFrom.legalName` of 2 characters → `["DispDtls","Nm"]`; PIN `099999` → `["DispDtls","Pin"]`.
- The new ship-to / dispatch-from fixtures map with `ok: true`.

**tolerance**
- The three source examples, exactly.
- Boundaries are inclusive: min and max accepted, min − 0.01 and max + 0.01 rejected.
- CRN/DBN skip the rate checks.
- EXPWOP with IGST 0 skips V22.
- RCM/EXPWP item total accepted with and without tax, rejected otherwise.

**jwt**
- Decoding the official sample: header `kid 115F4426…`, `iss NIC`. Invoice data: `AckNo "112010000011474"` (a string), `TotInvVal "16650"`, `IgstAmt "747.5"`. QR data has the 9 keys and no issues.
- `validateIrnRequest` on the request part of the sample (with `ItemNo`, `AckNo`, `AckDt` and `Irn` stripped):
  - the arithmetic rules V20–V28 pass;
  - V1 fails (Version 1.01);
  - V4 fails with the default `earliestDocDate` (2020 date);
  - the V5 check digit **fails for both sample GSTINs** (CLAUDE.md: never treated as valid);
  - with `gstinCheckDigit: "off"`, only the V5 issues disappear.
- Unknown keys: an extra header key, an extra claim, and an extra QR or invoice-data key each produce an `UNEXPECTED_KEY` warning, with `ok: true` and the extra key present in `raw`.
- Errors: 2 segments, bad base64url, non-JSON, `alg: none`, `alg: HS256`, a missing `kid`.
- `signatureVerified` is always `false`.

**api surface**
- No default exports.

**data rules**
- Synthetic data only, and only the GSTINs in `packages/fixtures/src/gstins.ts`. Tests read the portal sample from `sources/`; it is never copied into fixtures.

## 10. Deviations / source contradictions (follow source C, report)
- D1. The schema is not valid draft-07 (quirks in §4), so it is transcribed to Zod with a conformance test instead of using Ajv.
- D2. The date pattern `^[0-3][0-9]/[0-1][0-9]/[2][0][1-2][0-9]$` rejects years ≥ 2030, and the validations' "maximum date value for `InvEndDt` is 31/12/2059" contradicts it. We follow the pattern and log the conflict.
- D3. The `PrecDocDtls.InvNo` pattern `{1,15}` needs **at least 2 characters**, while `DocDtls.No` allows 1. A one-character original document number is rejected (the source wins).
- D4. Length limits are tighter than the model's:
  - `LglNm` 3–100 (model 1–200);
  - `Addr2`, `Loc` and `PrdDesc` have a minimum of 3;
  - seller `Loc` has a maximum of 50;
  - `InvRm` 3–100 (model notes ≤ 500).

  The mapper never truncates; validation reports the issue.
- D5. The schema's `Stcd`/`Pos` accept both `"3"` and `"03"`. We emit `"03"`, as the sample does.
- D6. The validations text forbids `"` and `\`, while the schema forbids only `"`. Both are enforced.
- D7. The model's exact arithmetic is stricter than the portal's ±1 rupee, so every mapped document passes V20–V28. The tolerance matters for payloads built elsewhere.
- D9. `ShipDtls.Gstin` allows `URP` (pattern) and is optional. We never emit `URP` (model D-S4).
- D10. `BuyerDtls.Pin` is optional in the schema, but C line 100 makes it mandatory for an e-way bill when there is no ship-to. This was not in the approved spec; it is V29 (warning, D-S15).
- D11. `ShipDtls.Loc` allows 100 characters (seller `Loc` 50), while the model keeps `city` ≤ 50 because H's `toPlace`/`fromPlace` allow only 50 (model §5.7).
- D8. The mod-36 check digit has no official document (model §6.4). The owner checked it privately (`scripts/verify-gstin.mjs`) against **4 real GSTINs: 4/4 passed**. `gstinCheckDigit: "enforce"` therefore stays the default. The algorithm remains UNVERIFIED until a CA signs it off.

## 11. Deferred
IGST on intra-state supply; e-commerce operator (`EcmGstin`); dispatch-from GSTIN (no field in C; model D-S2); `ShipDtls.Gstin` vs `Stcd` check (model D-S9); export details (`ExpDtls`, port/currency/country masters); e-way bill block (package `ewaybill`); payment/reference/contract/additional-document blocks; state cess; invoice-level discount (model §12, needs CA); line-level other charges; signature verification (§8.4); IRN hash computation; `UIN_HOLDER`.

## 12. Decisions (approved 2026-10-16; each UNVERIFIED — needs CA)
- **D-Q1** Service line without a quantity: the schema requires `UnitPrice`. We emit `UnitPrice = TotAmt` and omit `Qty`/`Unit`.
- **D-Q2** Exports (`EXPWP/EXPWOP`): the buyer is always `URP`. An export document whose recipient has a GSTIN is rejected by the mapper (V8 also enforces this).
- **D-Q3** Deemed exports (`DEXP`): intra vs inter is decided by seller state vs place of supply, as for B2B.
- **D-Q4** V25 "without tax values" for RCM/EXPWP removes the GST and cess amounts and keeps `OthChrg`.
- **D-Q5** Unknown keys in decoded JWT headers, claims, signed-invoice data or QR data are `UNEXPECTED_KEY` **warnings**. The raw data is always returned. `alg ≠ RS256` remains an error.

## 13. Stop conditions
As in CLAUDE.md. Specific to this package:
- If the source schema and the validations text disagree in a way §10 does not cover, follow the stricter one and report it.
- Signature verification is never implemented without an official key in `sources/`.

## 14. `docs/legal-facts.md` rows to add (at build time)
Each row: Source C URL, retrieved 2026-10-16, status UNVERIFIED — needs CA. Files are under `packages/einvoice/src/`.
- IRN `Version` "1.1" (`rules.ts`).
- `SupTyp` / `Typ` codes and the model → IRN mapping (`map.ts`).
- B2C, bill-of-supply, SEZ-unit and composition exclusions (`map.ts`).
- Earliest document date 2025-04-01, default of `earliestDocDate` (`rules.ts`).
- ±1 rupee tolerance formula and its exceptions: CRN/DBN, EXPWOP/SEZWOP zero IGST, RCM/EXPWP item total (`tolerance.ts`, `rules.ts`).
- "Tax rate 0.5% is withdrawn": the existing row now becomes **enforced** by `einvoice` (V17).
- Export ⇒ URP / 96 / 96 / 999999 (V8).
- `RegRev` allowed only for B2B/SEZ; `IgstOnIntra` rules (V9, V10).
- Tax split for e-invoice (V11).
- 1–1000 items; payload ≤ 2 MB; `RndOffAmt` ±99.99.
- PIN first-3-digit ranges (`sources/einvoice/master-codes/state-pincode-ranges.csv`, V12, warning).
- Decisions D-Q1, D-Q2, D-Q3, D-Q4 and D-Q5 (§12), one row each, marked "Design decision".
- Check-digit enforcement default, with the owner's private 4/4 result (D8).
- Track E: `dispatchFrom` → `DispDtls`, `shipTo` → `ShipDtls` mapping, with "Shipping party ⇒ Bill To–Ship To / Dispatching party ⇒ Bill From–Dispatch From / both ⇒ Combination" (C lines 29–31) (`map.ts`).
- V29 buyer PIN without ship-to for an e-way bill (C line 100) and V30 export port as ship-to (C lines 32, 105) (`rules.ts`).
- Decisions D-S4 and D-S15 (model spec §13.3), "Design decision".
