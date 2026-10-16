# Spec — `@india-gst-kit/model` (v0.1)

Status: approved 2026-10-16. Every legal/official fact referenced here is **UNVERIFIED — needs CA** until a chartered accountant signs it off in `docs/legal-facts.md`. Sources: `sources/README.md` (e-invoice portal, captured 2026-10-16) and `sources/acts/README.md` (CGST/UTGST Acts). No official sample GSTINs or check-digit document exist publicly; fixtures use synthetic GSTINs.

## 1. Purpose and scope
`@india-gst-kit/model` defines **one GST document** as Zod schemas plus pure helpers. It is the shared contract for every other package (`gstr1`, `einvoice`, `recon`, `ewaybill`, `gsp`).

- In scope: document shape, parties, lines, totals, structural and arithmetic validation, state table, UQC and rate lists, GSTIN validation, intra/inter-state decision, UTGST decision.
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

Document-level refinements (each a distinct, tested issue with a `path`):
1. Tax split matches `decideTaxSplit(supplier.stateCode, placeOfSupply, supplyCategory)` (§7).
2. `BILL_OF_SUPPLY` ⇒ every line has zero `cgst/sgst/igst/cess`.
3. **Composition supplier** ⇒ `kind ∈ {BILL_OF_SUPPLY, CREDIT_NOTE, DEBIT_NOTE}` and all tax amounts (`cgst/sgst/igst/cess`) on every line are zero.
4. Totals equal line sums exactly; `grandTotal` rule from §5.5.
5. `supplier.gstin !== recipient.gstin`.
6. Lines numbered 1..n.

Exports: all schemas, inferred types (`GstDocument`, `Line`, `Party`, …), and `parseGstDocument(input, options?)` returning Zod's `safeParse` result.

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
): TaxSplit;                 // INTRA iff same state AND DOMESTIC
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

## 7. Tax split rule
- **INTER** ⇒ `cgst = sgst = "0.00"`, `igst = round2(taxable × rate / 100)`.
- **INTRA** ⇒ `igst = "0.00"`; total tax `T = round2(taxable × rate / 100)`; then by convention:
  - `"remainder-to-sgst"` (default): `cgst = round2(T / 2)`, `sgst = T − cgst`.
  - `"equal-halves"`: `cgst = sgst = round2(taxable × rate / 200)` (sum may differ from `T` by 0.01).
- **Validation accepts both conventions:** an INTRA line is valid iff `|cgst − sgst| ≤ 0.01` **and** `cgst + sgst` equals the total tax under either convention — `T`, or `2 × round2(taxable × rate / 200)` (these differ by at most 0.01). For INTER lines `igst` must equal `T` exactly.
- Legal basis (IGST Act ss.7/8; supplies to SEZ and exports are inter-state) → `docs/legal-facts.md`, UNVERIFIED.

## 8. Edge cases
1. **Unregistered recipient (B2C):** no `gstin`, `registrationType = "UNREGISTERED"`, `placeOfSupply` still required (caller decides). Valid.
2. **Export/SEZ placeholders:** any non-DOMESTIC `supplyCategory` forces INTER regardless of states. `*_WITHOUT_PAYMENT` (LUT/bond) ⇒ all tax amounts zero while `gstRate` is kept. Overseas recipient: `registrationType = "OVERSEAS"`, no GSTIN, `stateCode`/`placeOfSupply` = `96` (source A lists 96 and 99 as Other Countries; source C uses 96 for POS outside India). Port code, shipping bill, currency, export duty: **not modelled in v0.1** (TODO).
3. **Rounding:** per line, half-up to 2 dp (decimal.js `ROUND_HALF_UP`); totals are sums of already-rounded line values (no re-rounding); whole-rupee rounding goes in `roundOff`, |roundOff| < 1. Design choice, logged UNVERIFIED.
4. **Cess:** separate from GST; same for INTRA/INTER; `cess = round2(taxable × cessRate / 100) + cessNonAdvol`. No cess-rate list (varies by HSN) — arithmetic only.
5. **Reverse charge:** flag only; tax amounts still present and validated.
6. **Nil/exempt lines on a tax invoice:** `gstRate = "0"` allowed.
7. **Credit/debit notes:** positive amounts; `originalDocument` required; not cross-checked against the original (no data access).
8. **Zero-value lines / 100 % discount:** allowed.
9. **Dates:** `2028-02-29` valid, `2026-02-29` invalid.
10. **Large values:** up to 15 integer digits; strings + decimal.js, no overflow.

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
**supply** — same state DOMESTIC → INTRA; different → INTER; same state + SEZ/EXPORT/DEEMED_EXPORT → INTER; `usesUtgst` true for 04, 25, 26, 31, 35, 97; false for states, Delhi, Puducherry, J&K; `"unknown"` for Ladakh 38 (see §6.5).
**money / computeLineTax** — half-up at `.005` boundaries (`0.005 → 0.01`, `0.0049 → 0.00`); exact sums over many lines; **odd-paisa cases under both conventions**, e.g. taxable `100.10` @ 5 % (`5.005` → T = `5.01`): remainder-to-sgst → cgst `2.51` (`round2(2.505)`), sgst `2.50`; equal-halves → `2.50` / `2.50` (`100.10 × 2.5 % = 2.5025`, sum `5.00`); INTER → igst `5.01`. Both INTRA results pass validation.
**line schema** — taxable = gross − discount; discount > gross rejected; goods line without qty rejected; service line with non-99 SAC rejected; unit without qty rejected; cess arithmetic; INTRA line passes under each convention; `|cgst − sgst| = 0.02` rejected; cgst + sgst off by 0.02 rejected.
**document schema** — valid: intra tax invoice, inter tax invoice, B2C unregistered, bill of supply, credit note, debit note, composition bill of supply, composition credit note, UT place of supply, document with a zero-rate line. Invalid (each asserts the issue `path`): note without originalDocument; invoice with originalDocument; original date after note date; IGST on intra; CGST on inter; totals off by 0.01; roundOff ≥ 1; supplier without GSTIN; GSTIN/state mismatch; composition supplier issuing TAX_INVOICE; composition supplier charging tax on a credit note; same GSTIN both sides; non-contiguous lineNo; empty lines; export-without-payment with non-zero tax.
**fixtures** — every document in `packages/fixtures` parses; fixtures contain only the synthetic GSTINs registered in `packages/fixtures/src/gstins.ts` (a test scans for any other 15-char GSTIN-shaped string).
**api surface** — no default exports (lint rule + test asserting `!("default" in module)`).

## 11. Stop conditions (halt and report instead of guessing)
- A source needed for a **legal list the model enforces** is unavailable or ambiguous → stop and name the file to attach. (Rates and UTGST are not blockers; see §12.)
- An *official* sample GSTIN fails the check-digit algorithm → stop. (None exist; the portal's illustrative samples are known to fail and are not authoritative — see §6.4.)
- Source C contradicts this spec (precision, number format, GSTIN patterns) → follow the source, report under "Deviations from spec".
- A requirement would need AGPL/GPL reference code or real company data → stop.
- `pnpm check` can't be made green without weakening strictness or lint rules → stop and report.

## 12. Deferred (TODO after v0.1)
`UIN_HOLDER` registration type; export details (port, shipping bill, currency); other document kinds; invoice-level discount — needs CA; `GST_RATES_OFFERED` / `GST_RATES_LEGACY` / `rateInForceOn` and any rate-list validation — needs rate notifications + CA; accepting temporary IDs (`…TMP`) as recipients; e-invoice/GSTR-1 mappings (other packages).
