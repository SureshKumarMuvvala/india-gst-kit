# Spec — `@india-gst-kit/model` (v0.1)

Status: approved 2026-10-16; **Track E draft 2026-10-17** (ship-to / dispatch-from, §5.7, §6.7, §6.8, §13 — not yet approved). Every legal/official fact referenced here is **UNVERIFIED — needs CA** until a chartered accountant signs it off in `docs/legal-facts.md`. Sources: `sources/README.md` (e-invoice portal, captured 2026-10-16) and `sources/acts/README.md` (CGST/UTGST Acts). No official sample GSTINs or check-digit document exist publicly; fixtures use synthetic GSTINs.

## 1. Purpose and scope
`@india-gst-kit/model` defines **one GST document** as Zod schemas plus pure helpers. It is the shared contract for every other package (`gstr1`, `einvoice`, `recon`, `ewaybill`, `gsp`).

- In scope: document shape, parties, optional ship-to and dispatch-from parties (§5.7), lines, totals, structural and arithmetic validation, state table, UQC and rate lists, GSTIN validation, intra/inter-state decision, UTGST decision.
- Out of scope: database, HTTP, tenancy, persistence IDs, rendering, mapping to return/e-invoice JSON (belongs to consumer packages), deciding taxability (we validate arithmetic, we don't decide what rate applies).
- ESM only, named exports only. Runtime dependency: `decimal.js`. `zod` is a peer dependency. Types are `z.infer<>` of schemas — no hand-written duplicate interfaces. Zod 4 API only.

## 2. Toolchain (for the build session)
- pnpm workspaces; `packageManager: "pnpm@11.25.0"` (via corepack).
- `.nvmrc` = `22.22.2`; root `engines.node` = `">=22.18 <25"`; published packages `engines.node` = `">=22"`.
- `zod`: `peerDependencies: { "zod": "^4.0.0" }`, `devDependencies: { "zod": "4.5.4" }` (exact; matches the consuming app).
- `decimal.js` for all money arithmetic.
- TypeScript strict (`NodeNext`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vitest, ESLint flat config (typescript-eslint strict-type-checked, no default exports), Prettier, Changesets; published as `@india-gst-kit/<name>`; `turbo.json` present for monorepo drop-in.
- Gate: `pnpm check` = typecheck + lint + test.
- Layout: `packages/model` (published), `packages/fixtures` (private, synthetic documents), placeholders `packages/{gstr1,einvoice,recon,ewaybill,gsp}` with README "planned" only.
- LICENSE: MIT, © 2026 Suresh Kumar Muvvala.

## 3. Primitive types (`src/primitives.ts`)
| Name | Type | Rule | Why |
|---|---|---|---|
| `Money` | string | `/^\d{1,15}\.\d{2}$/` — non-negative, exactly 2 dp | Never a JS number (float error); 2 dp = paise. Credit/debit-note amounts are positive; direction comes from `kind`. |
| `SignedMoney` | string | `/^-?\d{1,15}\.\d{2}$/` | Only for `roundOff`. |
| `Quantity` | string | `/^\d{1,10}(\.\d{1,3})?$/`, > 0 | Source C: `Qty` ≤ 9999999999.999. |
| `UnitPrice` | string | `/^\d{1,12}(\.\d{1,3})?$/` | Source C: `UnitPrice` ≤ 999999999999.999. |
| `GstRate` | string | `/^(0\|[1-9]\d{0,2})(\.\d{1,3})?$/` (0–999.999, ≤3 dp) | Source C: `GstRt` 0–999.999. The model holds no rate list and does not decide taxability. |
| `IsoDate` | string | `/^\d{4}-\d{2}-\d{2}$/` **and** a real calendar date | No `Date` objects (timezone drift). |
| `StateCode` | string | 2 digits (zero-padded), member of `STATE_CODES` | The master publishes codes without a leading zero (`1`); the model normalises to 2 digits (`01`) to match GSTINs. |
| `Gstin` | string | 15 chars, uppercase, `/^[0-9]{2}[0-9A-Z]{13}$/` (the only official pattern, source C) + first two digits a GSTIN-capable state code + valid check digit | See §6.4. |
| `HsnSac` | string | 4, 6 or 8 digits, not all zeros | Source C `HsnCd` pattern. |
| `UqcCode` | string | member of `UQC_CODES` | Official unit codes only. |

## 4. Enums
- `DocumentKind`: `"TAX_INVOICE" | "BILL_OF_SUPPLY" | "CREDIT_NOTE" | "DEBIT_NOTE"`. One `z.enum` so later kinds (receipt/refund/payment voucher, delivery challan) are additive. Mapping to e-invoice codes lives in `einvoice`.
- `RegistrationType`: `"REGULAR" | "COMPOSITION" | "UNREGISTERED" | "SEZ_UNIT" | "SEZ_DEVELOPER" | "OVERSEAS"`. Model vocabulary; mapping to portal codes is the consumer's job. **TODO (post-v0.1):** `UIN_HOLDER` (UN bodies/embassies).
- `SupplyCategory`: `"DOMESTIC" | "SEZ_WITH_PAYMENT" | "SEZ_WITHOUT_PAYMENT" | "EXPORT_WITH_PAYMENT" | "EXPORT_WITHOUT_PAYMENT" | "DEEMED_EXPORT"` — placeholder, see §8.2.
- `TaxSplit`: `"INTRA" | "INTER"`.
- `SplitConvention`: `"remainder-to-sgst" | "equal-halves"`.

## 5. Schemas (`src/schema/*.ts`)

### 5.1 `AddressSchema`
| Field | Type | Req | Rule | Why |
|---|---|---|---|---|
| `line1` | string | req | 1–100, trimmed | |
| `line2` | string | opt | ≤100 | |
| `city` | string | req | 1–50 | |
| `pincode` | string | opt | `/^\d{6}$/` | Absent for overseas parties |
| `stateCode` | StateCode | req | `96` (Other Countries) for overseas parties | |
| `country` | string | opt, default `"IN"` | ISO 3166-1 alpha-2 | Exports |
Length limits are design defaults (source C has its own limits; enforcing them belongs to the `einvoice` package).

### 5.2 `PartySchema` (supplier and recipient)
| Field | Type | Req | Rule | Why |
|---|---|---|---|---|
| `legalName` | string | req | 1–200, trimmed | |
| `tradeName` | string | opt | ≤200 | |
| `gstin` | Gstin | opt | valid if present | Unregistered/overseas parties have none |
| `registrationType` | RegistrationType | req | | |
| `stateCode` | StateCode | req | if `gstin` present, equals its first 2 chars | |
| `address` | AddressSchema | req | `address.stateCode === stateCode` | |

Refinements: `gstin` absent ⇔ `registrationType ∈ {UNREGISTERED, OVERSEAS}`.
`SupplierSchema` = Party with `gstin` required and `registrationType ∈ {REGULAR, COMPOSITION, SEZ_UNIT, SEZ_DEVELOPER}`.

### 5.3 `LineSchema`
| Field | Type | Req | Rule | Why |
|---|---|---|---|---|
| `lineNo` | int | req | ≥1; 1..n contiguous within doc | |
| `description` | string | req | 1–300 | |
| `hsnSac` | HsnSac | req | | |
| `isService` | boolean | req | true ⇒ `hsnSac` starts `99` | SAC vs HSN |
| `quantity` | Quantity | opt | required when `isService = false` | |
| `unit` | UqcCode | opt | required iff `quantity` present | |
| `unitPrice` | UnitPrice | opt | required iff `quantity` present | |
| `grossAmount` | Money | req | = round2(qty × unitPrice) when qty present | |
| `discount` | Money | req, default `"0.00"` | ≤ grossAmount | Line-level discount |
| `taxableValue` | Money | req | = grossAmount − discount | Tax base |
| `gstRate` | GstRate | req | | |
| `cgst`, `sgst`, `igst` | Money | req | §7 | `sgst` holds **SGST or UTGST** (§6.5) |
| `cessRate` | string | opt | decimal % | Ad valorem cess |
| `cessNonAdvol` | Money | opt, default `"0.00"` | | Specific cess, as an amount |
| `cess` | Money | req, default `"0.00"` | §8.4 | |
| `lineTotal` | Money | req | taxable + cgst + sgst + igst + cess | |

### 5.4 `OriginalDocRefSchema` (notes only)
`{ number: string (same rule as document number), date: IsoDate }`.

### 5.5 `TotalsSchema`
| Field | Type | Rule |
|---|---|---|
| `taxableValue`, `cgst`, `sgst`, `igst`, `cess`, `lineDiscount` | Money | each = Σ of the line field |
| `otherCharges` | Money, default `"0.00"` | |
| `roundOff` | SignedMoney, default `"0.00"` | \|roundOff\| < 1.00 |
| `grandTotal` | Money | = Σ lineTotal + otherCharges + roundOff; must be ≥ 0 |

Invoice-level discounts are not modelled: the caller must apportion them into each line's `discount` before building the document.

### 5.6 `GstDocumentSchema`
| Field | Type | Req | Rule | Why |
|---|---|---|---|---|
| `schemaVersion` | literal `"1"` | req | | Forward-compatible evolution |
| `kind` | DocumentKind | req | | |
| `number` | string | req | 1–16 chars, `/^[A-Za-z0-9\/-]+$/`, not starting with `0`, `/` or `-` | GST serial-number rule — source C `Doc.No` pattern `^[a-zA-Z1-9][a-zA-Z0-9/-]{0,15}$`; UNVERIFIED — needs CA |
| `date` | IsoDate | req | | |
| `supplier` | SupplierSchema | req | | |
| `recipient` | PartySchema | req | | |
| `placeOfSupply` | StateCode | req | not `25` (withdrawn as place of supply, source C validations) | Decides CGST+SGST/UTGST vs IGST |
| `supplyCategory` | SupplyCategory | req, default `"DOMESTIC"` | | |
| `reverseCharge` | boolean | req, default `false` | | |
| `originalDocument` | OriginalDocRef | cond. | required iff `kind ∈ {CREDIT_NOTE, DEBIT_NOTE}`, forbidden otherwise; `originalDocument.date ≤ date` | |
| `lines` | Line[] | req | ≥1 | |
| `totals` | TotalsSchema | req | consistent with lines | |
| `notes` | string | opt | ≤500 | |
| `shipTo` | ShipToSchema | opt | §5.7 | "Bill To – Ship To": goods go to an address other than the recipient's. **Never changes `placeOfSupply`** |
| `dispatchFrom` | DispatchFromSchema | opt | §5.7 | "Bill From – Dispatch From": goods leave from an address other than the supplier's. Never changes the tax split |

Document-level refinements (each a distinct, tested issue with a `path`):
1. Tax split matches `decideTaxSplit(supplier.stateCode, placeOfSupply, supplyCategory)` (§7).
2. `BILL_OF_SUPPLY` ⇒ every line has zero `cgst/sgst/igst/cess`.
3. **Composition supplier** ⇒ `kind ∈ {BILL_OF_SUPPLY, CREDIT_NOTE, DEBIT_NOTE}` and all tax amounts (`cgst/sgst/igst/cess`) on every line are zero.
4. Totals equal line sums exactly; `grandTotal` rule from §5.5.
5. `supplier.gstin !== recipient.gstin`.
6. Lines numbered 1..n.
7. `shipTo` / `dispatchFrom` take no part in rules 1–6. In particular rule 1 uses `supplier.stateCode` and `placeOfSupply` only: no refinement compares `shipTo.address.stateCode` with `placeOfSupply` or `recipient.stateCode`, or `dispatchFrom.address.stateCode` with `supplier.stateCode` (§5.7, decision D-S5).

Exports: all schemas, inferred types (`GstDocument`, `Line`, `Party`, …), and `parseGstDocument(input, options?)` returning Zod's `safeParse` result.

### 5.7 `ShipToSchema`, `DispatchFromSchema`, `ShipAddressSchema` (Track E)
Sources: source C validations lines 29–31 ("If 'Shipping party' is provided, then the transaction is considered as 'Bill To-Ship To'"; dispatching party ⇒ "Bill From – Dispatch From"; both ⇒ "Combination of Both"), the schema blocks `DispDtls` / `ShipDtls` (`sources/einvoice/generate-irn-json-schema.json`), EWB source H validations lines 49–50 (`sources/ewaybill/generate-ewaybill-validations.txt`: name, GSTIN and state code come from the bill party; address, place, PIN and actual state code from the ship/dispatch party), and the EWB-by-IRN `DispDtls` / `ExpShipDtls` blocks (`sources/ewaybill/ewb-by-irn-schema.json`).

**`ShipAddressSchema`** = `AddressSchema` (§5.1) plus refinements (each a distinct issue with a `path`):
| Rule | Why |
|---|---|
| `pincode` required | `Pin` is required in C `DispDtls`/`ShipDtls`, in I `DispDtls`/`ExpShipDtls`, and H `fromPincode`/`toPincode` are required |
| `stateCode` passes `isGstinStateCode` (not `96`/`99`) and `country = "IN"` | All target blocks need a 6-digit PIN (100000–999999), so the place is in India. For exports, "the 'Ship-To' address should be of the place/port in India from where the goods are being exported" (C line 32, line 105; I validations line 14). Decision D-S3 |

`city` keeps the model limit of 50: C allows `Loc` up to 100 in these blocks, but H's `fromPlace`/`toPlace` allow only 50, so 50 fits every target. A PIN outside the state's range is **not** an error (§6.7, D-S8). `stateCode` `25` is accepted (it is an address state, not a place of supply); the EWB Generate route cannot map it (ewaybill §13 D7).

**`ShipToSchema`** (`z.strictObject`):
| Field | Type | Req | Rule | Why |
|---|---|---|---|---|
| `legalName` | string | req | 1–200, trimmed | C `ShipDtls.LglNm` is required (D-S1) |
| `tradeName` | string | opt | ≤200 | C `ShipDtls.TrdNm` |
| `gstin` | Gstin | opt | valid if present: pattern, GSTIN state code and check digit (§6.4); a `…TMP` value gets the temporary-ID message | C `ShipDtls.Gstin` is optional. Absent = the ship-to party is unregistered or the address is a port. The model never stores `URP` (D-S4). Its first two digits are **not** compared with `address.stateCode` (D-S9) |
| `address` | ShipAddressSchema | req | | |

**`DispatchFromSchema`** (`z.strictObject`):
| Field | Type | Req | Rule | Why |
|---|---|---|---|---|
| `legalName` | string | req | 1–200, trimmed | C/I `DispDtls.Nm` ("Name of the company from which the goods are dispatched") is required (D-S1) |
| `address` | ShipAddressSchema | req | | |

`DispatchFromSchema` has **no** `gstin` or `tradeName`: `DispDtls` has no such field, and H's `dispatchFromGSTIN`/`dispatchFromTradeName` exist only as commented-out content (sources finding E7). An extra key is rejected (`strictObject`), so it can never be dropped silently (D-S2).

**Interaction with the bill parties and place of supply.**
- `placeOfSupply` stays an **explicit input**. The model never derives it from `shipTo` (or from `dispatchFrom`), and never checks it against them. Whether the place of supply of a bill-to–ship-to supply is the bill-to party's state is a legal question (IGST Act, not in `sources/`); the caller decides, as for every other document (D-S5, needs CA).
- The tax split (§7) is decided by `supplier.stateCode` vs `placeOfSupply` as before. A `dispatchFrom` in another state does not make the supply inter-state, and a `shipTo` in another state does not either.
- `recipient` stays the bill-to party and `supplier` the bill-from party: their GSTIN, names, state and address are unchanged. `shipTo` may be identical to `recipient`; this is not checked (the 22/05/2026 "3 different parties" rule was withdrawn, release notes L; D-S6).
- `shipTo` and `dispatchFrom` are allowed on every `DocumentKind` and on services-only documents (D-S7). Consumers decide whether they use them (e.g. no e-way bill for notes).

**`shipmentPattern(doc)`** (`src/shipment.ts`):
```ts
export const ShipmentPatternSchema = z.enum(["REGULAR", "BILL_TO_SHIP_TO", "BILL_FROM_DISPATCH_FROM", "COMBINATION"]);
export function shipmentPattern(doc: Pick<GstDocument, "shipTo" | "dispatchFrom">): ShipmentPattern;
```
Neither → `REGULAR`; `shipTo` only → `BILL_TO_SHIP_TO`; `dispatchFrom` only → `BILL_FROM_DISPATCH_FROM`; both → `COMBINATION` (C lines 29–31; EWB K1 `transaction-types.csv`). Consumers map it to their own codes (ewaybill `transactionType` 1–4). D-S10.

## 6. Helpers — signatures

### 6.1 States (`states.ts`, from source A)
Codes are stored as 2-digit strings. The master has no `28`; `25` (Daman and Diu) is listed but withdrawn as place of supply; `96` and `99` are both "OTHER COUNTRIES" (POS for exports is `96`); `97` is "Other Territory". `stateCodeFromName("OTHER COUNTRIES")` returns `96`.
```ts
export const STATE_CODES: readonly { code: StateCode; name: string }[];
export function stateName(code: string): string | undefined;
export function stateCodeFromName(name: string): StateCode | undefined; // case/whitespace-insensitive
export function isStateCode(code: string): code is StateCode;
export function normaliseStateCode(code: string): StateCode | undefined; // "1" → "01"; unknown → undefined
export function isPlaceOfSupplyCode(code: string): boolean;              // false for withdrawn "25"
export function isGstinStateCode(code: string): boolean;                  // false for 96 / 99 (outside India)
```

### 6.2 UQC (`uqc.ts`, from source B)
```ts
export const UQC_CODES: readonly { code: string; description: string }[];
export function isUqcCode(code: string): boolean;
```

### 6.3 Rates — deferred
No rate list in v0.1 (see §12). `GstRate` is validated by format only. Informational fact for `docs/legal-facts.md`: the e-invoice validations state "Tax rate 0.5% is withdrawn" (date not stated).

### 6.4 GSTIN (`gstin.ts`)
```ts
export function isGstinStructurallyValid(gstin: string): boolean; // official pattern + GSTIN-capable state code
export function gstinCheckDigit(first14: string): string;         // computes 15th char
export function isValidGstin(gstin: string): boolean;             // structure + check digit
export function parseGstin(gstin: string):
  { stateCode: StateCode; panOrId: string; entityCode: string; checkDigit: string } | undefined;
```
- Structure: source C publishes only the loose pattern `^[0-9]{2}[0-9A-Z]{13}$` (supplier/e-commerce); buyer/ship-to also allow `URP` (unregistered person, exports) — a recipient-level concept handled by `registrationType`, not a GSTIN. No PAN-structured, TDS or TCS pattern is published, so none is enforced; TDS/TCS/non-resident-shaped GSTINs pass if they match the loose pattern and check digit. The first two digits must be a state code from §6.1 other than 96/99.
- Temporary IDs: a value shaped 2-digit state + 10 digits + `TMP` (observed on a real document) fails with its own message "looks like a temporary ID, not a GSTIN" (`isTemporaryId`), not a check-digit error. It is still rejected.
- Check digit: no official algorithm document exists (source D not found); the publicly documented **mod-36** algorithm (charset `0-9A-Z`, alternating weights 1/2 across the first 14 chars, sum of quotient+remainder of each product by 36, check = (36 − sum mod 36) mod 36), marked UNVERIFIED. No official sample GSTINs exist (source E); the portal's illustrative samples (`37BZNPM9430M1KL`, `03BZNPM9430M1KL`) fail mod-36 and are **not** used as valid. Tests use synthetic GSTINs with computed check digits. `scripts/verify-gstin.mjs` lets the owner check real GSTINs privately from a gitignored local file.

### 6.5 Supply decision and UTGST (`supply.ts`)
```ts
export function decideTaxSplit(
  supplierState: StateCode, placeOfSupply: StateCode,
  category?: SupplyCategory, // default "DOMESTIC"
): TaxSplit;                 // INTRA iff same state AND category is DOMESTIC or DEEMED_EXPORT
export function usesUtgst(stateCode: StateCode): boolean | "unknown"; // UTGST Act s.2(8) territories, UNVERIFIED
```
`usesUtgst` is true for the territories in UTGST Act 2017 s.2(8) / CGST Act s.2(114) as enacted (`sources/acts/`): Andaman and Nicobar (35), Lakshadweep (31), Dadra and Nagar Haveli (26), Daman and Diu (25), Chandigarh (04), other territory (97). Later amendments (e.g. Ladakh, the 2020 Dadra/Daman merger) were not retrieved; the Council site's search and Act pages (2026-10-16) offer no such amendment, so Ladakh (38) returns `"unknown"` rather than a guess — logged for CA. The `sgst` field holds SGST or UTGST; `usesUtgst(placeOfSupply)` tells consumers which label applies. The model stores one field so arithmetic and validation are identical for both.

### 6.6 Money (`money.ts`)
```ts
export function money(x: Decimal.Value): Money;      // round half-up to 2 dp; throws on negative/NaN
export function sumMoney(xs: readonly Money[]): Money;
export function computeLineTax(
  taxable: Money, rate: string, split: TaxSplit,
  options?: { convention?: SplitConvention },        // default "remainder-to-sgst"
): { cgst: Money; sgst: Money; igst: Money };
```
All helpers are pure; inputs normalised with `trim().toUpperCase()` where relevant (GSTIN, state name).

### 6.7 PIN vs state (`pin-ranges.ts`, `pin.ts`)
`PIN_RANGES` (already in the model; source `sources/einvoice/master-codes/state-pincode-ranges.csv`, with its `Source`/`Retrieved`/`Status` header and legal-facts row) lists the first-3-digit PIN ranges per state. A state can have several rows, and ranges of different states overlap (Telangana 500–509 lies inside Andhra Pradesh 500–535).
```ts
export function pinStateCheck(pincode: string, stateCode: StateCode): "match" | "mismatch" | "unknown";
export const PinWarningSchema = z.strictObject({
  path: z.array(z.union([z.string(), z.number()])), code: z.literal("PIN_STATE_MISMATCH"), message: z.string(),
});
export function documentPinWarnings(doc: GstDocument): PinWarning[];   // PinWarning = z.infer<typeof PinWarningSchema>
```
- `pinStateCheck`: `"unknown"` when the state has no row (e.g. 96, 97, 99); `"match"` when the first three digits fall in **any** of the state's ranges; otherwise `"mismatch"`.
- `documentPinWarnings` checks every address that has a `pincode`: `supplier.address`, `recipient.address`, `shipTo.address`, `dispatchFrom.address`. Paths are document paths (`["shipTo", "address", "pincode"]`). `999999` with state `97` is never flagged (C line 26).
- **Warnings only.** `parseGstDocument` does not call it and never rejects on a PIN: the portal first matches the complete PIN against its own master, which we do not have, and uses the 3-digit pattern only as a fallback (C line 28). einvoice V12 and ewaybill V-G8/V-B5 already treat it as a warning (D-S8).

### 6.8 Lossless JSON (`lossless.ts`)
Already in the model (recon decision D-P1); documented here because every package must use it (§13 cleanup). Number leaves are JSON numbers on the wire and decimal strings in memory, tracked by schema identity.
```ts
export function markNumber<T extends z.ZodType>(schema: T): T;      // registers a number leaf (one shared WeakSet)
export function isNumberLeaf(schema: z.ZodType): boolean;
export function unwrapSchema(schema: z.ZodType): z.ZodType;         // strips optional/nullable
export function objectShape(schema: z.ZodType): Readonly<Record<string, z.ZodType>> | undefined;
export function arrayElement(schema: z.ZodType): z.ZodType | undefined;
export class JsonNumber { readonly source: string }
export function parseJsonLossless(text: string): unknown;            // JSON.parse + reviver context.source (Node ≥ 22)
export function convertNumbers(value, schema, path, issues, prefix?): unknown;
export function parseLenient(schema, input): LenientResult;
export function pathStartsWith(...), zodPath(...), getAt(...);
```
- **Rule:** no package defines its own `JSON.parse` reviver, `JsonNumber` or number-leaf registry. A second `markNumber` registry would make `isNumberLeaf` disagree between packages.

## 7. Tax split rule
- **INTER** ⇒ `cgst = sgst = "0.00"`, `igst = round2(taxable × rate / 100)`.
- **INTRA** ⇒ `igst = "0.00"`; total tax `T = round2(taxable × rate / 100)`; then by convention:
  - `"remainder-to-sgst"` (default): `cgst = round2(T / 2)`, `sgst = T − cgst`.
  - `"equal-halves"`: `cgst = sgst = round2(taxable × rate / 200)` (sum may differ from `T` by 0.01).
- **Validation accepts both conventions:** an INTRA line is valid iff `|cgst − sgst| ≤ 0.01` **and** `cgst + sgst` equals the total tax under either convention — `T`, or `2 × round2(taxable × rate / 200)` (these differ by at most 0.01). For INTER lines `igst` must equal `T` exactly.
- Legal basis (IGST Act ss.7/8; supplies to SEZ and exports are inter-state) → `docs/legal-facts.md`, UNVERIFIED.

## 8. Edge cases
1. **Unregistered recipient (B2C):** no `gstin`, `registrationType = "UNREGISTERED"`, `placeOfSupply` still required (caller decides). Valid.
2. **Export/SEZ/deemed-export placeholders:** `SEZ_*` and `EXPORT_*` force INTER regardless of states ("In case of Exports and SEZ, the supply is always Interstate", source C validations); `DEEMED_EXPORT` is not listed there and follows the states like DOMESTIC (UNVERIFIED — needs CA). `*_WITHOUT_PAYMENT` (LUT/bond) ⇒ all tax amounts zero while `gstRate` is kept. Overseas recipient: `registrationType = "OVERSEAS"`, no GSTIN, `stateCode`/`placeOfSupply` = `96` (source A lists 96 and 99 as Other Countries; source C uses 96 for POS outside India). Port code, shipping bill, currency, export duty: **not modelled in v0.1** (TODO).
3. **Rounding:** per line, half-up to 2 dp (decimal.js `ROUND_HALF_UP`); totals are sums of already-rounded line values (no re-rounding); whole-rupee rounding goes in `roundOff`, |roundOff| < 1. Design choice, logged UNVERIFIED.
4. **Cess:** separate from GST; same for INTRA/INTER; `cess = round2(taxable × cessRate / 100) + cessNonAdvol`. No cess-rate list (varies by HSN) — arithmetic only.
5. **Reverse charge:** flag only; tax amounts still present and validated.
6. **Nil/exempt lines on a tax invoice:** `gstRate = "0"` allowed.
7. **Credit/debit notes:** positive amounts; `originalDocument` required; not cross-checked against the original (no data access).
8. **Zero-value lines / 100 % discount:** allowed.
9. **Dates:** `2028-02-29` valid, `2026-02-29` invalid.
10. **Large values:** up to 15 integer digits; strings + decimal.js, no overflow.
11. **Bill to – ship to / bill from – dispatch from (§5.7):** optional parties; `placeOfSupply` stays explicit and the tax split ignores them. Export of goods: `shipTo` = the port in India (C line 32), recipient stays `OVERSEAS` with state and place of supply `96`.

## 9. Legal-facts process
Each official list/rule lives in its own source file with a header comment:
```ts
// Source: <exact URL> (<document title, version>)
// Retrieved: YYYY-MM-DD
// Status: UNVERIFIED — needs CA
```
…and one row in `docs/legal-facts.md`: fact, file, source URL, retrieval date, `UNVERIFIED — needs CA`.
Facts tracked: state codes; UQC codes; GST rates offered and legacy with effective dates; GSTIN formats (regular, TDS, TCS, non-resident, others); GSTIN check-digit algorithm; HSN/SAC length rules; document-number rule; intra/inter rule incl. SEZ/export = inter; UTGST territories; composition suppliers issue bill of supply and charge no tax; credit/debit note must reference original; rounding convention; CGST/SGST split conventions; sample GSTINs used in fixtures.

## 10. Test list (Vitest; written before implementation)
**primitives** — Money accepts `0.00`, `12.50`; rejects `12.5`, `12`, `-1.00`, `1e3`, JS numbers. IsoDate accepts `2028-02-29`; rejects `2026-02-29`, `2026-13-01`, `26-01-01`. Quantity precision bounds. HsnSac lengths.
**states** — every code round-trips via name; unknown → `undefined`; name lookup case-insensitive; no duplicate codes/names; count matches source.
**uqc** — no duplicates; `isUqcCode` true/false.
**rates** — `GstRate` accepts `0`, `5`, `2.5`, `0.25`, `999.999`; rejects `-1`, `1000`, `5.0000`, `05`, `abc`.
**gstin** — synthetic GSTINs with computed check digits are valid; each wrong check digit invalid; wrong length, lowercase, unknown state prefix, `96`/`99` prefix rejected; the portal's two illustrative sample GSTINs are invalid; `parseGstin` extracts state and PAN/ID.
**supply** — same state DOMESTIC → INTRA; different → INTER; same state + SEZ_*/EXPORT_* → INTER; DEEMED_EXPORT follows the states like DOMESTIC (same state → INTRA, different → INTER); `usesUtgst` true for 04, 25, 26, 31, 35, 97; false for states, Delhi, Puducherry, J&K; `"unknown"` for Ladakh 38 (see §6.5).
**money / computeLineTax** — half-up at `.005` boundaries (`0.005 → 0.01`, `0.0049 → 0.00`); exact sums over many lines; **odd-paisa cases under both conventions**, e.g. taxable `100.10` @ 5 % (`5.005` → T = `5.01`): remainder-to-sgst → cgst `2.51` (`round2(2.505)`), sgst `2.50`; equal-halves → `2.50` / `2.50` (`100.10 × 2.5 % = 2.5025`, sum `5.00`); INTER → igst `5.01`. Both INTRA results pass validation.
**line schema** — taxable = gross − discount; discount > gross rejected; goods line without qty rejected; service line with non-99 SAC rejected; unit without qty rejected; cess arithmetic; INTRA line passes under each convention; `|cgst − sgst| = 0.02` rejected; cgst + sgst off by 0.02 rejected.
**document schema** — valid: intra tax invoice, inter tax invoice, B2C unregistered, bill of supply, credit note, debit note, composition bill of supply, composition credit note, UT place of supply, document with a zero-rate line. Invalid (each asserts the issue `path`): note without originalDocument; invoice with originalDocument; original date after note date; IGST on intra; CGST on inter; totals off by 0.01; roundOff ≥ 1; supplier without GSTIN; GSTIN/state mismatch; composition supplier issuing TAX_INVOICE; composition supplier charging tax on a credit note; same GSTIN both sides; non-contiguous lineNo; empty lines; export-without-payment with non-zero tax.
**ship-to / dispatch-from (Track E)**
- `ShipToSchema` accepts: legal name + address with PIN; with `tradeName`; with a synthetic `gstin` from `packages/fixtures/src/gstins.ts`.
- `ShipToSchema` rejects, each asserting the `path`: missing `legalName`; missing `address.pincode`; `address.stateCode` `96` and `99`; `address.country` `"US"`; a GSTIN with a wrong check digit (`gstin`); a `…TMP` value (temporary-ID message); `"URP"` as `gstin`; an unknown key (`phone`).
- `DispatchFromSchema` accepts legal name + address; rejects a missing `pincode`, `stateCode` `96`, and `gstin` / `tradeName` as unknown keys.
- `ShipAddressSchema`: city of 50 characters accepted, 51 rejected; `stateCode` `25` accepted.
- Documents valid: bill-to–ship-to tax invoice; bill-from–dispatch-from tax invoice; combination; credit note with `shipTo`; bill of supply with `dispatchFrom`; export of goods with `shipTo` = port in state `27`, recipient `OVERSEAS`, POS `96` (INTER).
- **Place of supply is untouched:** supplier `29`, POS `29`, `shipTo` in `33` → INTRA (CGST/SGST valid, IGST rejected at the usual path). Supplier `29`, POS `33`, `shipTo` in `29` → INTER. Supplier `29`, `dispatchFrom` in `33`, POS `29` → INTRA. In each case the parsed `placeOfSupply` equals the input.
- `shipTo` identical to `recipient` (same GSTIN and address) is valid.
- `shipmentPattern`: REGULAR, BILL_TO_SHIP_TO, BILL_FROM_DISPATCH_FROM, COMBINATION.
- `pinStateCheck`: `560001`/`29` match; `560001`/`33` mismatch; `500001` matches both `36` and `37` (overlap); `999999`/`97` unknown; `110001`/`07` match.
- `documentPinWarnings`: a `shipTo` PIN outside its state's range gives one `PIN_STATE_MISMATCH` at `["shipTo","address","pincode"]`, while `parseGstDocument` still succeeds; a clean document gives none; `dispatchFrom`, supplier and recipient are checked too; an address without a PIN is skipped.
- **lossless**: `parseJsonLossless("99999999999999.99")` keeps the source text; `markNumber` / `isNumberLeaf` share one registry across packages (a leaf marked in a gstr1 wire schema is a number leaf for the model's `isNumberLeaf`).
- **api surface**: `ShipToSchema`, `DispatchFromSchema`, `ShipAddressSchema`, `ShipmentPatternSchema`, `shipmentPattern`, `pinStateCheck`, `documentPinWarnings`, `PinWarningSchema` are named exports; types `ShipTo`, `DispatchFrom`, `ShipAddress`, `ShipmentPattern`, `PinWarning` are `z.infer`.

**fixtures** — every document in `packages/fixtures` parses; new synthetic fixtures: bill-to–ship-to (third-party ship-to GSTIN from `gstins.ts`), bill-to–ship-to to an unregistered site, bill-from–dispatch-from, combination, export with port ship-to; fixtures contain only the synthetic GSTINs registered in `packages/fixtures/src/gstins.ts` (a test scans for any other 15-char GSTIN-shaped string).
**api surface** — no default exports (lint rule + test asserting `!("default" in module)`).

## 11. Stop conditions (halt and report instead of guessing)
- A source needed for a **legal list the model enforces** is unavailable or ambiguous → stop and name the file to attach. (Rates and UTGST are not blockers; see §12.)
- An *official* sample GSTIN fails the check-digit algorithm → stop. (None exist; the portal's illustrative samples are known to fail and are not authoritative — see §6.4.)
- Source C contradicts this spec (precision, number format, GSTIN patterns) → follow the source, report under "Deviations from spec".
- A requirement would need AGPL/GPL reference code or real company data → stop.
- `pnpm check` can't be made green without weakening strictness or lint rules → stop and report.

## 12. Deferred (TODO after v0.1)
`UIN_HOLDER` registration type; export details (port, shipping bill, currency); other document kinds; invoice-level discount — needs CA; `GST_RATES_OFFERED` / `GST_RATES_LEGACY` / `rateInForceOn` and any rate-list validation — needs rate notifications + CA; accepting temporary IDs (`…TMP`) as recipients; e-invoice/GSTR-1 mappings (other packages); dispatch-from GSTIN / trade name (no field in the sources, D-S2); ship-to GSTIN vs ship-to state check (D-S9, needs CA); deriving or checking place of supply from `shipTo` (D-S5, needs IGST Act + CA).

## 13. Track E — ship-to / dispatch-from (draft 2026-10-17)
Scope: `shipTo` / `dispatchFrom` on the document (§5.7), mapped by `einvoice` to `DispDtls`/`ShipDtls` (einvoice spec §3, V29–V30) and used by `ewaybill` for the from/to address, PIN and `transactionType` (ewaybill spec §3, §5). Plus one cleanup: no package keeps its own lossless-JSON reviver (§6.8; gstr1 spec §16).

### 13.1 Lossless-JSON duplication check (2026-10-17)
| File | Own reviver / `JsonNumber` / number-leaf registry? | Action |
|---|---|---|
| `packages/einvoice/src/json.ts` | No: imports `parseJsonLossless`, `isNumberLeaf`, `objectShape`, `arrayElement` from the model | none |
| `packages/einvoice/src/jwt.ts` | No: imports `markNumber`, `parseJsonLossless`, `parseLenient`, `pathStartsWith` from the model | none |
| `packages/recon/src/parse.ts` | No: imports `parseJsonLossless`, `convertNumbers` from the model | none |
| `packages/ewaybill/src/json.ts`, `response.ts` | No: import from the model | none |
| `packages/gstr1/src/numbers.ts` | **Yes**: local `markNumber` (own `WeakSet`), `unwrapSchema`, `isNumberLeaf`, `objectShape`, `arrayElement`, `JsonNumber`, `parseJsonLossless`, `isPlainObject` | replace by the model's exports (gstr1 spec §16, D-S13) |

Not a reviver, but also duplicated: the raw-literal JSON writer (`write` in `einvoice/src/json.ts` and `ewaybill/src/json.ts`, identical; `writeJson` in `gstr1/src/numbers.ts`, insertion order). Not moved in Track E (D-S14).

### 13.2 Changesets (one file each, at build time)
| Package | Bump | Summary |
|---|---|---|
| `@india-gst-kit/model` | minor | `shipTo` / `dispatchFrom` on `GstDocumentSchema`; `ShipToSchema`, `DispatchFromSchema`, `ShipAddressSchema`, `shipmentPattern`, `pinStateCheck`, `documentPinWarnings` |
| `@india-gst-kit/einvoice` | minor | maps `dispatchFrom` → `DispDtls`, `shipTo` → `ShipDtls`; warnings V29 (buyer PIN for EWB without ship-to) and V30 (export EWB needs the port as ship-to) |
| `@india-gst-kit/ewaybill` | minor | from/to address, PIN, actual state codes and `transactionType` come from the document; `EwbMovement.dispatchFrom`/`shipTo` remain only for EWB-by-IRN and use the model schemas; new codes `ADDRESS_IN_MOVEMENT`, `SHIP_TO_GSTIN_NOT_SENT` |
| `@india-gst-kit/gstr1` | patch | internal: lossless-JSON helpers come from the model; no API or output change |

`@india-gst-kit/fixtures` is private (no changeset). `@india-gst-kit/recon` is unchanged. Nothing has been released yet (all packages are at 0.0.0 with pending initial changesets), so the ewaybill `EwbMovement` change breaks no published API.

### 13.3 Decisions (proposed; each UNVERIFIED; **Needs CA** where marked)
| Id | Question | Recommendation |
|---|---|---|
| D-S1 | Are the ship-to / dispatch-from names required? | **Yes.** `ShipDtls.LglNm` and `DispDtls.Nm` are required in C (and `DispDtls.Nm` in I). Optional names would make every IRN mapping of such a document fail later; requiring them costs the caller nothing. |
| D-S2 | GSTIN / trade name for `dispatchFrom`? | **No** in v0.1: no visible source field (`DispDtls` has only `Nm`; H's `dispatchFromGSTIN` is commented out, finding E7). `strictObject` rejects them, so nothing is dropped silently. |
| D-S3 | Where may a ship/dispatch address be? | PIN required, state not 96/99, `country = "IN"` (every target needs a 6-digit PIN; exports ship to the port in India). Merchant-trade or foreign dispatch is not representable. **Needs CA** (confirm no outward case ships/dispatches outside India on these documents). |
| D-S4 | `shipTo` without a GSTIN: emit `ShipDtls.Gstin = "URP"` or omit it? | **Omit.** It is optional in C; `URP` is described only for the export buyer. The model never stores `URP`. Confirm on the sandbox when reachable. |
| D-S5 | Does `shipTo` change or constrain place of supply? | **No.** POS stays an explicit input, the split stays supplier state vs POS, and nothing cross-checks POS against `shipTo` or `recipient`. The bill-to–ship-to POS rule is in the IGST Act, which is not in `sources/`. **Needs CA.** |
| D-S6 | Reject `shipTo` equal to the recipient, or apply "3 different parties"? | **No.** That rule (22/05/2026) was withdrawn / put on hold (L, 30/07/2026). |
| D-S7 | Which document kinds may carry them? | **All** kinds and services-only documents. `einvoice` maps them on INV/CRN/DBN (the schema allows it); `ewaybill` never generates for notes anyway. |
| D-S8 | PIN vs state: error or warning? | **Warning** helper (`documentPinWarnings`), never a parse error; the portal's full PIN master decides first (C line 28). |
| D-S9 | Check `shipTo.gstin` prefix against `shipTo.address.stateCode` (and `ShipDtls.Gstin` vs `ShipDtls.Stcd`)? | **Not in v0.1.** C line 27 names only supplier and recipient. **Needs CA** (a GSTIN is state-wise, so a mismatch is probably wrong, but no source says so). |
| D-S10 | Where does the Regular / BTST / BFDF / Combination classification live? | **Model** (`shipmentPattern`), so einvoice and ewaybill agree; ewaybill maps it to 1–4. |
| D-S11 | ewaybill: document or movement as the source of addresses? | **Document** for the Generate route. `EwbMovement.dispatchFrom`/`shipTo` stay **only** for EWB-by-IRN (I lines 16–17: addresses not sent with the IRN can be sent there). Passing them to `toEwbRequest` is the error `ADDRESS_IN_MOVEMENT`; the mapper never picks one silently. |
| D-S12 | Ship-to GSTIN on the Generate route (ewaybill D-Q7)? | **Still deferred**: `shipToGSTIN`/`shipToTrdName` are not in the published H schema (commented out, E7) and the mandatory Ship-To GSTIN change is on hold (L, 30/07/2026). When `shipTo.gstin` is present the mapper adds the warning `SHIP_TO_GSTIN_NOT_SENT`. On the IRN routes it is sent in `ShipDtls.Gstin`. |
| D-S13 | gstr1: can it use the model's `convertNumbers`? | **Partly.** gstr1 has plain `z.number()` count fields (`num`, `totnum`, `cancel`, `net_issue`, `doc_num`) that must become doubles, while the model's `convertNumbers` turns every JSON number into text or an issue. gstr1 keeps a small local converter built on the model's `JsonNumber`/`isNumberLeaf`/`objectShape`/`arrayElement`, and imports everything else. Extending the model's `convertNumbers` is the alternative (a model API change; not recommended for this track). |
| D-S14 | Also move the raw-literal JSON writer into the model? | **Defer** to a separate cleanup: the user asked for the reviver; the writers differ (schema key order + extra keys vs insertion order). |
| D-S15 | einvoice: are the EWB-related checks (buyer PIN without ship-to; export port ship-to) errors? | **Warnings** (V29, V30): C line 106 says the IRN is still generated, only the e-way bill is not. |

