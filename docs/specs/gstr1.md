# Spec — `@india-gst-kit/gstr1` (v0.1)

Status: **draft for review** (2026-10-16). Decisions in §13 were taken by the owner on 2026-10-16. Every legal/official fact and every decision here is **UNVERIFIED — needs CA** until a chartered accountant signs it off in `docs/legal-facts.md`.

Sources (all under `sources/gstr1/`; URLs, dates and SHA-256 in its README):
- **S5** = `gstr1-save-v5.0-schema.json`: GSTN API "GSTR1 – Save GSTR1 data" **v5.0** (FINAL, published 23-02-2026). **Authoritative** for every key, type, pattern and range in this spec. Cited as "S5 `#def`" or "S5 path".
- **S4** = `gstr1-save-v4.1-schema.json`: the same API, v4.1 (published 04-02-2025). Not authoritative. Used for the v4.1 → v5.0 comparison (§4.2) and as the validation schema of the offline-upload output, which follows the offline tool's v4.1 shapes (§4.4).
- **T** = the official GST Offline Tool 3.2.4. `offline-tool/code-excerpts.md` is cited as "T §n"; the tool's data files and CSV templates are under `offline-tool/`. Source of the classification rules and value conventions that S5 does not encode.
- **H** = the "Help Instruction" sheet of Excel template V2.2 (`excel-template-v2.2-help-excerpt.txt`), cited by Excel row, e.g. "H r48".
- **F** = GSTN's troubleshooting guide and the tool's FAQ (`portal-faq-excerpts.txt`).

No sample payload was offered on the portal for either schema version.

## 0. Targets (DEC-7)

**One internal GSTR-1 structure, two outputs.** `buildGstr1()` classifies and aggregates once into an internal `Gstr1Return`. Two pure converters render it:

| Output | Function | Shape | Validated against | Used for |
|---|---|---|---|---|
| (a) **API save payload** | `toApiSavePayload(ret)` | **S5 v5.0** (§4). Authoritative. | Zod transcription of S5; S5 itself in tests | GSP/API "Save GSTR1 data" (sending is the `gsp` package's job) |
| (b) **Offline-upload JSON** | `toOfflineUploadJson(ret)` | what the official **offline tool 3.2.4** writes: v4.1 shapes plus the tool's header (§4.4) | Zod transcription of S4 + tool conventions; S4 itself in tests | the portal's "Prepare offline → Upload" |

- **Same classification and amounts.** Both outputs use the same classification (§3), the same aggregation (§5) and the same amounts. They differ **only** in the items listed in §4.2 (v4.1 vs v5.0) and the tool's header fields (§4.4); nothing else is allowed to differ.
- **Status of (b).** No source says the portal's offline upload accepts the tool's shape, or a v5.0 shape. The tool is GSTN's own producer of that file, so (b) mirrors it. Confirming acceptance needs a live upload, which writes into a real draft return (Q-2).

## 1. Purpose and scope

`buildGstr1()` turns the supplier's validated `GstDocument`s (`@india-gst-kit/model`) for one monthly return period into an internal `Gstr1Return`. `toApiSavePayload()` / `toOfflineUploadJson()` render it (§0).

- **In scope (v0.1).** Classification of documents into sections, aggregation, the two outputs (each validated against a Zod transcription of its schema), and serialisation, for:
  - the header
  - `b2b` (Tables 4A, 4B, 6B, 6C)
  - `b2cl` (5)
  - `b2cs` (7)
  - `cdnr` (9B registered)
  - `cdnur` (9B unregistered)
  - `exp` (6A)
  - `hsn` (12)
  - `doc_issue` (13)

  Table numbers are from `offline-tool/data/uploadtablename.json`.
- **Periods:** return periods from **`052025`** only. Both S5 and S4 accept only the bifurcated `hsn` object (`hsn_b2b` / `hsn_b2c`). The earlier `{ "data": [...] }` form (T §2) is in neither schema, so earlier periods cannot be expressed: `PERIOD_NOT_SUPPORTED`.
- **Out of scope / deferred (§12):**
  - amendments
  - advances (`at`, `atadj`/`txpd`; restructured in v5.0, §4.2)
  - `nil` (Table 8)
  - e-commerce (Tables 14/15, `ecom`, `supeco`)
  - quarterly/IFF filers
  - the delete flow (`flag: "D"`)
  - file splitting
  - HTTP and encryption (`gsp`)
  - deciding taxability or rates
- ESM only, named exports, Zod 4 (peer `^4.0.0`), `decimal.js`, `@india-gst-kit/model` (`workspace:^`). Types are `z.infer`. Objects are `z.strictObject`; S5 has `additionalProperties: false` at every level we emit.

## 2. API

```ts
export function buildGstr1(input: Gstr1Input): Gstr1Result;             // classification + aggregation, once
export function toApiSavePayload(ret: Gstr1Return, options?: { header?: { version?: string; hash?: string } }): RenderResult<ApiSavePayload>;
export function toOfflineUploadJson(ret: Gstr1Return): RenderResult<OfflineUploadJson>;
export function serializeGstr1(json: ApiSavePayload | OfflineUploadJson): string; // compact JSON, numbers as raw literals
export function parseApiSavePayloadJson(text: string): z.ZodSafeParseResult<ApiSavePayload>;
export function parseOfflineUploadJson(text: string): z.ZodSafeParseResult<OfflineUploadJson>;
export function classifyDocument(doc: GstDocument, ctx: ClassifyContext): Classification; // pure
export function b2clThreshold(fp: ReturnPeriod): Money;                 // "250000.00" before 082024, else "100000.00"
export const Gstr1ReturnSchema;      // internal structure: neutral names, decimal strings, doc types as an enum
export const ApiSavePayloadSchema;   // Zod transcription of S5 (in-scope parts)
export const OfflineUploadJsonSchema; // Zod transcription of S4 (in-scope parts) + tool header (§4.4)

type RenderResult<T> = { ok: true; value: T } | { ok: false; issues: readonly Gstr1Issue[] };

type Gstr1Input = {
  gstin: Gstin;                       // the filer = supplier.gstin of every document
  period: ReturnPeriod;               // "MMYYYY", S5 fp pattern ^((0[1-9]|1[012])((19|20)\d\d))$, and ≥ 052025
  documents: readonly GstDocument[];  // already passed parseGstDocument
  options?: {
    originalInvoices?: readonly { document: GstDocument; period: ReturnPeriod }[]; // where each original was reported (§3.3)
    aatoAbove5Cr?: boolean;           // HSN minimum 6 digits instead of 4 (§5.2); default false
    docIssue?: readonly DocIssueSeries[]; // overrides derivation of doc_issue (§5.3)
  };
};
type Gstr1Result =
  | { ok: true; value: Gstr1Return; classification: readonly { kind: DocumentKind; number: string; section: Section }[] }
  | { ok: false; issues: readonly Gstr1Issue[] };
type Gstr1Issue = { code: Gstr1IssueCode; message: string; documentNumber?: string; path?: (string | number)[] };
```

- **Never throws.** `buildGstr1` never throws on data problems and collects **all** issues. Each converter validates its output against its own schema before returning `ok: true`.
- **Size check.** Each converter also runs the size check (`FILE_TOO_LARGE`, §8). For (b) this is the portal's upload limit.
- **`Gstr1Return`** is `z.infer<typeof Gstr1ReturnSchema>`:
  - the header (`gstin`, `period`)
  - per-section groups, documents and items with neutral field names and decimal-string amounts
  - HSN rows split into `b2b` / `b2c`
  - doc-issue entries keyed by a `DocIssueType` enum (§5.3)

  It holds no schema-version-specific encoding: no `doc_det` vs `doc_det_new`, no string vs integer `doc_num`, no header literals.

## 3. Classification (document → section)

The rules come from T and H; S5 encodes shapes, not classification. Notation:
- `S` = `supplier.stateCode`, which equals the first two digits of `supplier.gstin` (model). T compares POS with the filer's GSTIN prefix (T §4).
- `P` = `placeOfSupply`, `cat` = `supplyCategory`, `val` = `totals.grandTotal`.

### 3.1 Preconditions (each failure is an issue; the document is not placed)

| Code | Rule that must hold | Source |
|---|---|---|
| `PERIOD_NOT_SUPPORTED` | `period` ≥ `052025` | §1 |
| `SUPPLIER_MISMATCH` | `doc.supplier.gstin === input.gstin` | header `gstin` = "Supplier GSTIN" (S5) |
| `SUPPLIER_GSTIN_FORMAT` | `input.gstin` matches S5 `#gstin` (PAN-structured; stricter than the model's loose pattern) | S5 `#gstin` |
| `DATE_OUT_OF_RANGE` | `2017-07-01 ≤ doc.date ≤` last day of `period`. Earlier-period documents are allowed | T §4 (`validateDate`) |
| `DUPLICATE_DOCUMENT` | no two invoices, or no two notes, with the same `number` | H r378, r401 |
| `UNSUPPORTED_SUPPLIER` | `supplier.registrationType` ∉ {`COMPOSITION`, `SEZ_UNIT`, `SEZ_DEVELOPER`} | Decision DEC-4 |
| `UNSUPPORTED_DOCUMENT` | `kind !== "BILL_OF_SUPPLY"` (bills of supply belong in `nil`, Table 8, deferred) | DEC-4; H r233–237 |
| `RATE_NOT_ACCEPTED` | every line `gstRate` ∈ `0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40` (numeric comparison) | T §4, `data/rate.json` `CommGST`; S5 `rt` max 999.99, multipleOf 0.01 |
| `REVERSE_CHARGE_B2C` | `reverseCharge` only when the document goes to `b2b`/`cdnr`; `b2cl`/`b2cs`/`cdnur` have no `rchrg` | S5 |
| `RECIPIENT_GSTIN_FORMAT` | for `b2b`/`cdnr`: `recipient.gstin` matches S5 `#ctin` (anyOf: regular GSTIN, UIN, NRTP, TDS patterns). The model has already checked the mod-36 digit; T also checks it (T §4) | S5 `#ctin` |
| `POS_NOT_ACCEPTED` | `pos` matches the section's pattern: `b2b`/`cdnr` S5 `#state_cd_foreign` `^(3[0-8]\|[12][0-9]\|0[1-9]\|96\|97)$`; `b2cl`/`b2cs`/`cdnur` S5 `#state_cd` (no `96`). The model's `99` fails both | S5 |
| `AMOUNT_OUT_OF_RANGE` | every emitted amount is within S5's range (§4.1) | S5 |

### 3.2 Tax invoices (`kind = TAX_INVOICE`); first match wins

| # | Condition | Section and fields | Source |
|---|---|---|---|
| I1 | `cat ∈ {EXPORT_WITH_PAYMENT, EXPORT_WITHOUT_PAYMENT}` | `exp`, `exp_typ` = `WPAY` / `WOPAY` (S5 enum); no POS, no recipient | H r143–144; T §3 exp |
| I2 | `recipient.gstin` present | `b2b`; `inv_typ`: `DOMESTIC→R`, `DEEMED_EXPORT→DE`, `SEZ_WITH_PAYMENT→SEWP`, `SEZ_WITHOUT_PAYMENT→SEWOP` (S5 enum also has `CBW`, never emitted); `ctin`, `pos = P`, `rchrg` | H r18; `data/invtypesforb2b.json`; S5 |
| I3 | no GSTIN, `cat = DOMESTIC`, `P ≠ S`, `val > b2clThreshold(period)` | `b2cl`, grouped by `pos` | H r48; T §3 b2cl (strictly greater) |
| I4 | no GSTIN, `cat = DOMESTIC`, otherwise | `b2cs` row; `sply_ty` = `INTRA` if `P = S` else `INTER`; `typ = "OE"` | H r70; T §3 b2cs; S5 enums |
| I5 | no GSTIN and `cat ∈ {SEZ_*, DEEMED_EXPORT}` | issue `CATEGORY_NEEDS_GSTIN` | these are b2b invoice types only |
| I6 | no GSTIN, `cat = DOMESTIC`, `P = 96` | issue `POS_96_NOT_EXPORT` (S5 `b2cl`/`b2cs` POS excludes 96) | S5; Q-5 |

- `b2clThreshold(fp)`: `250000.00` for fp before `082024`, `100000.00` from `082024` (T §3 b2cl; `constants.js`; H r48).
- **The return period decides** (DEC-3), not the invoice date. Every supported period is ≥ `052025`, so for invoices in the period the limit is always `100000.00`. The `250000.00` branch matters only for a note's original reported before `082024` (§3.3).

### 3.3 Credit and debit notes (`kind ∈ {CREDIT_NOTE, DEBIT_NOTE}`)

- `ntty` = `C` / `D` (S5 also allows `R`, refund voucher, never emitted).
- Notes follow the **original invoice's** section ("based on original invoice", H r89, r119). The original is looked up by `originalDocument.number` + `.date`:
  1. first in `documents`, with `period` = the input period;
  2. then in `options.originalInvoices`, with the period it was reported in.

| # | Condition | Section | Source |
|---|---|---|---|
| N1 | `cat` export | `cdnur`, `typ = EXPWP / EXPWOP`; **no `pos`, no `diff_percent`** (S5 `not anyOf required`) | H r119; S5 cdnur |
| N2 | `recipient.gstin` present | `cdnr`, grouped by `ctin`; `inv_typ` as I2; `pos`, `rchrg` | H r89; S5 |
| N3 | no GSTIN, original classifies as `b2cl` under **its** reporting period | `cdnur`, `typ = B2CL`, `pos` required (S5) | H r119; S5 |
| N4 | no GSTIN, original classifies as `b2cs` | **netted into the `b2cs` row**: credit negative, debit positive. S5 `b2cs` `txval` (`#txvalue`) and amounts (`#nonEmptyNil`) have **no minimum**; T's `b2cs.csv` sample has `-500000` | DEC-2 |
| N5 | no GSTIN, original not found | issue `ORIGINAL_NOT_FOUND` | can't decide N3 vs N4 |

- If the original is available and a note's `P` differs from the original's `pos`, the issue is `NOTE_POS_MISMATCH` (H r95, r124).
- **Signs.** In `cdnr`/`cdnur`, all amounts are ≥ 0: S5 `#totalValue`, `#txval` and `#nonEmptyCost` have `minimum: 0`. Direction comes only from `ntty`. In `b2cs` (N4) and `hsn` (§5.2), credit notes subtract.

## 4. Output (a): API save payload — `toApiSavePayload` (S5 v5.0)

**Types.**
- Amounts, rates and quantities are JSON **numbers**. In memory they are decimal strings, as everywhere in this repo. `serializeGstr1` writes them as raw number literals with money at 2 dp (`1000.00`), the same technique as `einvoice` §2. S5 uses `multipleOf: 0.01` throughout.
- Codes, document numbers, `pos`, `ctin` and `hsn_sc` are strings.
- Dates are `DD-MM-YYYY` (S5 `#nonEmptydate`, which also checks the calendar).
- `num` and the `doc_issue` counts are integers.
- Absent optional keys are **omitted**, never `null`; empty arrays are not emitted.

```jsonc
{
  "gstin": "<filer>",                 // S5 #gstin, required
  "fp": "MMYYYY",                     // required
  // "version", "hash": optional strings in S5; omitted unless toApiSavePayload options.header supplies them
  "b2b":  [ { "ctin": "…",           // S5 #ctin
              "inv": [ { "inum": "…", "idt": "DD-MM-YYYY", "val": 0.00, "pos": "NN", "rchrg": "Y|N",
                         "inv_typ": "R|DE|SEWP|SEWOP",
                         "itms": [ { "num": 1801, "itm_det": { "txval": 0.00, "rt": 18, "iamt": 0.00 | "camt": 0.00, "samt": 0.00, "csamt": 0.00 } } ] } ] } ],
  "b2cl": [ { "pos": "NN", "inv": [ { "inum", "idt", "val", "itms": [ { "num", "itm_det": { "txval", "rt", "iamt", "csamt" } } ] } ] } ],
  "b2cs": [ { "sply_ty": "INTRA|INTER", "typ": "OE", "pos": "NN", "rt": 5, "txval": 0.00, "iamt" | "camt"+"samt", "csamt" } ],
  "cdnr": [ { "ctin": "…", "nt": [ { "nt_num", "nt_dt", "ntty": "C|D", "val", "pos", "rchrg", "inv_typ", "itms": [ { "num", "itm_det": {…} } ] } ] } ],
  "cdnur":[ { "nt_num", "nt_dt", "ntty", "val", "typ": "B2CL|EXPWP|EXPWOP", "pos"?, "itms": [ { "num", "itm_det": { "txval", "rt", "iamt", "csamt" } } ] } ],
  "exp":  [ { "exp_typ": "WPAY|WOPAY", "inv": [ { "inum", "idt", "val", "itms": [ { "txval", "rt", "iamt", "csamt" } ] } ] } ],
  "hsn":  { "hsn_b2b": [ HsnRow ], "hsn_b2c": [ HsnRow ] },      // at least one array (S5 anyOf required)
  "doc_issue": { "doc_det_new": [ { "doc_num": "1", "doc_typ": "Invoices for outward supply",
                                    "docs": [ { "num": 1, "from": "…", "to": "…", "totnum": 0, "cancel": 0, "net_issue": 0 } ] } ] }
}
// HsnRow (S5 hsn anyOf[0]) = { "num", "hsn_sc", "uqc", "qty", "rt", "txval", "iamt", "camt", "samt", "csamt" }; no "val"
```

- **Key order** follows S5's property order: `gstin, fp, [hash, version], b2b, b2cl, b2cs, cdnr, cdnur, exp, hsn, doc_issue`.
- **Required keys (S5):**

  | Object | Required keys |
  |---|---|
  | b2b group | `ctin`, `inv` (≥ 1) |
  | b2b invoice | `inum`, `idt`, `val`, `rchrg`, `inv_typ`, `itms` (≥ 1), `pos` |
  | item | `num` (≥ 1), `itm_det` (`rt`, `txval`) |
  | b2cl group | `pos`, `inv` |
  | b2cl invoice | `inum`, `idt`, `val`, `itms` |
  | b2cs row | `rt`, `sply_ty`, `typ`, `txval`, `pos` |
  | cdnr note | `val`, `nt_dt`, `nt_num`, `ntty`, `itms`, `pos`, `rchrg`, `inv_typ` |
  | cdnur note | `val`, `nt_dt`, `nt_num`, `ntty`, `typ`, `itms` (+ `pos` when `B2CL`) |
  | exp group / invoice | `exp_typ`, `inv` / `inum`, `idt`, `val`, `itms` (`rt`, `txval`) |
  | hsn row | `hsn_sc`, `uqc`, `qty`, `num`, `txval`, `rt` |
  | doc_det_new entry / series | `doc_num`, `docs` / `num`, `from`, `to`, `totnum`, `cancel`, `net_issue` |

- **S5 optional keys we never emit:**
  - `flag` (taxpayer action; the delete flow is deferred)
  - `diff_percent` (65 % rate, not in the model)
  - `irn`, `irngendate`, `srctyp`
  - `sez_auth` (`SEZAO` / `SEZNAO`; Q-4)
  - `eco_typ`, `estin` (Table 15)
  - `gt`, `cur_gt`
  - `desc` / `user_desc`: "Description is optional for period May'21 and onwards" (H r240)
- **Invoice-level fields:**
  - `inum` / `nt_num` = `number`; S5 `#inum` pattern, which every model number satisfies.
  - `idt` / `nt_dt` = `date`.
  - `val` = `totals.grandTotal` (H r23).
  - `pos` = `placeOfSupply`.
- **Items** (`b2b`, `b2cl`, `cdnr`, `cdnur`): one per distinct rate in the document (H r388; T keys items by rate).
  - `num = rt × 100 + 1` (T §3 b2b): 18 → `1801`, 0.25 → `26`, 0 → `1`. This satisfies S5's `minimum: 1` (cdnur: `minimum: 0`).
  - `txval = Σ taxableValue`, `iamt = Σ igst`, `camt = Σ cgst`, `samt = Σ sgst` (SGST **or UTGST**, "State/UT Tax Amount" H r248), `csamt = Σ cess` over the lines at that rate.
  - Inter-state items carry `iamt` and no `camt`/`samt`; intra-state the reverse. The model's `decideTaxSplit` decides, and it agrees with T §4.
  - S5 `b2cl` `itm_det` allows **only** `iamt`/`csamt` (`additionalProperties: false`). S5 `cdnur` `itm_det` would also allow `camt`/`samt`, but `cdnur` notes are inter-state by construction (B2CL or export), so we emit only `iamt`/`csamt`.
- **`exp` items** have no `num` and no `itm_det` (S5). For `WOPAY` / `SEWOP` / `EXPWOP`, `iamt` and `csamt` are `0.00`, as the model and T §3 already force.
- **`rt`** is the model's `gstRate` as a number literal with trailing zeros dropped (`"18.000"` → `18`).
- **`b2cs` rows** are keyed by (`sply_ty`, `pos`, `rt`, `typ`) and amounts are summed. Intra rows carry `camt` + `samt` + `csamt`; inter rows carry `iamt` + `csamt`. Order: by `pos`, then `rt`.
- **Order** of groups and documents: input order of first appearance.

### 4.1 Ranges (S5) → `AMOUNT_OUT_OF_RANGE`

| Field | S5 definition | Range |
|---|---|---|
| `val` | `#totalValue` | 0 … 9 999 999 999 999.99 |
| item `txval` | `#txval` | 0 … 99 999 999 999.99 |
| item `iamt`/`camt`/`samt`/`csamt` | `#nonEmptyCost` | 0 … 99 999 999 999.99 |
| `b2cs` `txval` | `#txvalue` | ≤ 99 999 999 999.99, no minimum |
| `b2cs` amounts | `#nonEmptyNil` | ≤ 99 999 999 999.99, no minimum |
| `hsn` amounts | `#hsnamt` | ± 9 999 999 999 999.99 |
| `hsn` `qty` | `#hsnqty` | ± 10^15, multipleOf 0.01 |
| `rt` | — | 0 … 999.99, multipleOf 0.01 |

The model allows 15 integer digits, so these ranges are real constraints.

### 4.2 v4.1 → v5.0 changes (S4 → S5)

Compared key by key. `hsn`, `exp` (apart from `flag`), the header, and `required: ["gstin", "fp"]` are **unchanged**.

| Area | v4.1 | v5.0 |
|---|---|---|
| `doc_issue` | `doc_det[]`, `doc_num` **integer** 1–12 | `doc_det_new[]`, `doc_num` **string** `^(1A\|[1-9]\|1[0-2])$` (adds `"1A"`, Q-3); `doc_det` no longer allowed |
| `etin` (e-commerce GSTIN) | allowed in `b2b`, `b2cl`, `b2cs`, `cdnr` invoices/rows (TCS pattern or empty) | **removed** from those sections |
| `diff_percent` | absent everywhere | added (number, multipleOf 0.01) in `b2b`, `b2cl`, `b2cs`, `cdnr`, `cdnur`. For `cdnur` `EXPWP`/`EXPWOP` it is forbidden |
| `sez_auth` | — | added to `b2b`, `cdnr` (and `at`): `SEZAO` / `SEZNAO` |
| `eco_typ`, `estin` | — | added to `cdnr` (`ECOM_B2B` / `ECOM_URP2B`; `estin` = `#ctin`) |
| `ntty` | `C`, `D` | `C`, `D`, `R` |
| `flag` | `N`, `M`, `U`, `E` | adds `D` |
| advances `at`/`ata`/`txpd`/`txpda` | arrays | objects split into `at_b2b` / `at_b2c` with `rtin`, `inv_typ` (`R`, `RC`, `DE`, `SEWP`, `SEWOP`), `sply_ty` (out of scope) |
| `ecom`/`ecoma`/`supeco`/`supecoa` | — | further fields (out of scope); definition `ecomOmon` replaced by `ecomTyp` |

### 4.3 Offline tool 3.2.4 output vs S4 and S5 — **the tool matches v4.1**

| Tool 3.2.4 writes (T) | S4 v4.1 | S5 v5.0 |
|---|---|---|
| `doc_issue.doc_det[]` with integer `doc_num` (T §3 doc_issue) | ✓ | ✗ (`doc_det_new`, string) |
| `etin` in b2b/b2cl/b2cs when an e-commerce GSTIN is entered | ✓ | ✗ |
| `diff_percent: 0.65` when the 65 % rate applies | ✗ | ✓ |
| `hsn.hsn_b2b` / `hsn_b2c` from fp 052025; rows `num, hsn_sc, desc, user_desc, uqc, qty, rt, txval, iamt, camt, samt, csamt` | ✓ | ✓ |
| `hsn.data[]` for fp before 052025 | ✗ | ✗ |
| `version: "GST3.2.4"`, `hash: "hash"` | ✓ (optional strings) | ✓ |
| `cfs` on b2b/cdnr groups (only for data downloaded from the portal) | ✗ | ✗ |
| everything else in the in-scope sections | ✓ | ✓ |

The decisive structural item is `doc_issue`: tool 3.2.4 is **v4.1-shaped**. Its `diff_percent` output and its pre-052025 `hsn.data` fit neither schema exactly. This suggests the offline upload is validated by something other than v5.0, or more leniently (Q-2).

### 4.4 Output (b): offline-upload JSON — `toOfflineUploadJson` (tool 3.2.4 shape, S4)

`toOfflineUploadJson` renders the same `Gstr1Return` exactly like §4, **except**:

| # | Item | (b) offline-upload JSON | (a) API payload | Source of (b) |
|---|---|---|---|---|
| O1 | `doc_issue` container | `doc_issue.doc_det[]` | `doc_det_new[]` | T §3 doc_issue; S4 |
| O2 | `doc_num` | **integer** 1–12 (`1`, `4`, `5`) | string `"1"`, `"4"`, `"5"` | T §3 doc_issue (`indexOf + 1`); S4 `#doc_num` integer 1–12 |
| O3 | `doc_typ` | emitted, with the tool's names | emitted (optional in both) | T §3 doc_issue **[infer]** (`fixDoc` returns early, T §3) |
| O4 | header `version` | always `"GST3.2.4"` | omitted unless supplied | T §2 (`common.js:164`) |
| O5 | header `hash` | always `"hash"` (the literal string) | omitted unless supplied | T §2 (`common.js:165`) |
| O6 | key order | the tool's template order: `gstin, fp, version, hash, b2b, b2cl, b2cs, exp, cdnr, cdnur, doc_issue, hsn` | S5 order | T §2 (`common.js:174-200`) |
| O7 | `etin` | **allowed** by the schema (S4, tool); not emitted in v0.1 because the model has no e-commerce operator | not allowed (S5) | T §3 b2b; S4; §12 |

Everything else is identical, by construction and by test. That covers classification, sections, groups, items, `num`, amounts, signs, dates, HSN rows, the omission of empty sections and `null`s, and number formatting (D2 applies to both).

- **Not copied from the tool:**
  - `gt` / `cur_gt` (FY 2017-18 only)
  - `diff_percent` (not modelled; not in S4)
  - `cfs` (portal-downloaded data only)
  - `hsn.data` (periods before 052025 are unsupported, §1)
  - the tool's internal keys that it strips before writing (T §1)
- **Validation of (b):** `OfflineUploadJsonSchema` = the Zod transcription of S4's in-scope parts with O4/O5 as literals.
- **File name:** the tool names its file `returns_<ddMMyyyy>_R1_<gstin>_offline.json` (T §1; F FAQ 42). A helper `offlineUploadFileName(gstin, date)` is deferred; not needed for upload.
- **Size:** `FILE_TOO_LARGE` above `4.7 × 1024 × 1024` bytes. The tool splits at that size and the portal limit is 5 MB (F, FAQ 43).

## 5. Summary sections

### 5.1 Common
`hsn` and `doc_issue` are built from all documents placed in §3.

### 5.2 `hsn` (Table 12)
- **Split (DEC-1):** documents placed in `b2b` or `cdnr` feed `hsn_b2b`; documents in `b2cl`, `b2cs`, `cdnur` or `exp` feed `hsn_b2c`. No source states this rule; T leaves it to the user (T §3 hsn).
- **Rows.**
  - Key: (`hsn_sc` = line `hsnSac`, `rt`, `uqc`).
  - `uqc` = the line `unit`. For services (`isService`, HSN `99…`) it is `"NA"` with `qty = 0` (T §3 hsn; H r241–242). S5 `uqc` is `^[a-zA-Z]*$`, length 1–30.
  - `qty` = Σ quantity; S5 `#hsnqty` multipleOf 0.01.
  - `txval`, `iamt`, `camt`, `samt`, `csamt` = Σ, all five always emitted.
  - `num` = 1..n after sorting by (`hsn_sc`, `rt`, `uqc`).
  - Credit-note lines subtract and debit-note lines add (S5 `#hsnamt` and `#hsnqty` allow negatives; Q-6).
  - `hsn` is omitted when there are no rows, because S5 requires at least one of the two arrays. An empty array is not emitted either.
- **Checks.**
  - `HSN_LENGTH`: if `aatoAbove5Cr`, `hsnSac` needs ≥ 6 digits, otherwise ≥ 4 (T §3 hsn; H r239). S5 allows 2–8 and the model 4/6/8.
  - `QTY_PRECISION`: an aggregated `qty` that is not a multiple of 0.01 (the model allows 3 dp) is an issue (S5 `multipleOf 0.01`; H r242).
  - Not checked: membership of T's HSN master (deferred).

### 5.3 `doc_issue` (Table 13)
- Internally each entry is keyed by `DocIssueType`: `TAX_INVOICE` → 1 "Invoices for outward supply", `DEBIT_NOTE` → 4 "Debit Note", `CREDIT_NOTE` → 5 "Credit Note". Numbers and names come from T's 12-item list (T §3 doc_issue).
- Rendered as a **string** `doc_num` (`"1"`, `"4"`, `"5"`) in output (a), per S5, and as an **integer** (`1`, `4`, `5`) in output (b), per T and S4 (§4.4).
- `"1A"` (S5 only) is never emitted (Q-3).
- `doc_typ` (optional in S5) is emitted with T's name.
- **Derivation (default).** One series per `doc_num`, from documents **dated within** the period.
  - `from` / `to` = the first and last numbers by (`date`, input order).
  - `totnum` = count, `cancel = 0`, `net_issue = totnum − cancel`.
  - `num` = 1.
- **Override.** `options.docIssue` replaces the derivation. Checks (`DOC_ISSUE_INVALID`): `from`/`to` match S5 `#inum`; the counts are integers 0…9 999 999 999; `cancel ≤ totnum`; `net_issue = totnum − cancel`. The last two are T's checks.

## 6. Numbers and rounding
- No arithmetic is redone. Every amount is a sum of the model's already-validated line amounts (decimal.js, exact). The model's rounding (half-up per line) and split conventions carry through (DEC-5).
- T recomputes item tax as `txval × rt / 100` with binary `toFixed(2)` (T §4). Our sums may differ by paise from that recomputation; we keep the document's figures (D1).

## 7. Exports
- Functions: `buildGstr1`, `toApiSavePayload`, `toOfflineUploadJson`, `classifyDocument`, `b2clThreshold`, `serializeGstr1`, `parseApiSavePayloadJson`, `parseOfflineUploadJson`.
- Schemas: `Gstr1ReturnSchema`, `ApiSavePayloadSchema`, `OfflineUploadJsonSchema`, and their per-section sub-schemas.
- Types: `Gstr1Return`, `ApiSavePayload`, `OfflineUploadJson`, `Gstr1Input`, `Gstr1Issue`, `Section`, `ReturnPeriod`, `DocIssueType`, `DocIssueSeries`.
- Constants: `GSTR1_RATES` and `DOC_ISSUE_TYPES`. Each lives in its own file with a `// Source / Retrieved / Status` header.

## 8. Issue codes
`PERIOD_NOT_SUPPORTED`, `SUPPLIER_MISMATCH`, `SUPPLIER_GSTIN_FORMAT`, `DATE_OUT_OF_RANGE`, `DUPLICATE_DOCUMENT`, `UNSUPPORTED_SUPPLIER`, `UNSUPPORTED_DOCUMENT`, `RATE_NOT_ACCEPTED`, `REVERSE_CHARGE_B2C`, `RECIPIENT_GSTIN_FORMAT`, `POS_NOT_ACCEPTED`, `AMOUNT_OUT_OF_RANGE`, `CATEGORY_NEEDS_GSTIN`, `POS_96_NOT_EXPORT`, `ORIGINAL_NOT_FOUND`, `NOTE_POS_MISMATCH`, `HSN_LENGTH`, `QTY_PRECISION`, `DOC_ISSUE_INVALID`, `FILE_TOO_LARGE`, `SCHEMA` (own-output failure; a bug).

`FILE_TOO_LARGE` is checked by both converters: the serialised output is over `4.7 × 1024 × 1024` bytes. That is T's split threshold (T §1); the portal's offline-upload limit is 5 MB (F, FAQ 43). The API limit is not stated in S5 (Q-9), so the same limit is applied to (a) as a conservative default. Splitting is deferred.

## 9. Test list (Vitest; written first)

Fixtures: synthetic documents with the GSTINs registered in `packages/fixtures/src/gstins.ts` only.

**schema conformance (dev dependency: a JSON-Schema validator, e.g. Ajv, MIT, run with `strict: false` because of S5's quirks)**
- **(a) vs S5.** Every `toApiSavePayload` output in the suite validates against **S5** (`sources/gstr1/gstr1-save-v5.0-schema.json`, loaded from the repo). The golden (a) output **fails S4** because of `doc_det_new`.
- **(b) vs S4.** Every `toOfflineUploadJson` output in the suite validates against **S4** (`sources/gstr1/gstr1-save-v4.1-schema.json`). The golden (b) output **fails S5** because of `doc_det` and the integer `doc_num`. This documents the version split (§4.3).
- `ApiSavePayloadSchema` (Zod) and S5 agree on a table of hand-written valid and invalid payloads. Examples: an unknown key; `doc_num: 1` as an integer; `etin` in b2b; `pos: "96"` in b2cs; `cdnur` EXPWP with `pos`; an hsn row with `val: 5`; `qty: 1.005`.
- `OfflineUploadJsonSchema` (Zod) and S4 agree on the mirror table. Examples: `doc_num: "1"` as a string is invalid; `doc_det_new` is invalid; `etin` with a TCS-pattern GSTIN is valid; an empty `etin` is valid; `diff_percent` is invalid.

**period / threshold**
- `b2clThreshold("072024") = 250000.00`; `("082024") = 100000.00`; `("122023") = 250000.00`. The year is compared before the month: `"092023"` < `"082024"`.
- fp `"042025"` → `PERIOD_NOT_SUPPORTED`; `"052025"` accepted; `"132025"` → schema error.

**classification — invoices**
- Registered recipient: DOMESTIC → b2b `R`; DEEMED_EXPORT → `DE`; SEZ_WITH_PAYMENT → `SEWP`; SEZ_WITHOUT_PAYMENT → `SEWOP` with `iamt`/`csamt` `0.00`.
- Unregistered inter-state, fp 102026: `val` `100000.01` → b2cl; `100000.00` → b2cs INTER (strictly greater).
- Unregistered intra-state, `val` `5000000.00` → b2cs INTRA.
- Export with/without payment → exp `WPAY`/`WOPAY`; no `pos`.
- Errors:
  - SEZ category to an unregistered recipient → `CATEGORY_NEEDS_GSTIN`
  - POS 96 DOMESTIC unregistered → `POS_96_NOT_EXPORT`
  - POS 99 → `POS_NOT_ACCEPTED`
  - bill of supply → `UNSUPPORTED_DOCUMENT`
  - composition, SEZ unit or SEZ developer supplier → `UNSUPPORTED_SUPPLIER`
  - reverse charge to an unregistered recipient → `REVERSE_CHARGE_B2C`
- Rates: `"0.5"` → `RATE_NOT_ACCEPTED`; `"18.000"` is emitted as `18`; `"40"` is accepted.

**classification — notes**
- Credit note to a registered recipient → cdnr `ntty "C"`, positive amounts. Debit note → `"D"`.
- Note on an export → cdnur `EXPWP`/`EXPWOP` with no `pos`.
- Unregistered recipient:
  - original b2cl in `documents` → cdnur `B2CL` with `pos`
  - original ₹1.5 lakh inter-state reported in fp 072024 (via `originalInvoices`) → it was b2cs then (limit 2.5 lakh), so the note nets into b2cs
  - the same original reported in fp 082024 → cdnur `B2CL`
  - original b2cs → b2cs row reduced (credit) / increased (debit), and a negative `txval` is emitted when the net is negative
  - original missing → `ORIGINAL_NOT_FOUND`
- Note POS ≠ original POS → `NOTE_POS_MISMATCH`.

**preconditions**
- Other supplier → `SUPPLIER_MISMATCH`. Filer GSTIN that passes the model but not S5 `#gstin` (synthetic) → `SUPPLIER_GSTIN_FORMAT`.
- Recipient GSTIN that fails S5 `#ctin` → `RECIPIENT_GSTIN_FORMAT`. Synthetic UIN-shaped and TDS-shaped `ctin` values pass.
- Dates `2017-06-30` and after the period end → `DATE_OUT_OF_RANGE`. An earlier-period date inside the range is accepted.
- Duplicate invoice numbers → `DUPLICATE_DOCUMENT`. An invoice and a note sharing a number are allowed.
- `val` `10000000000000.00` → `AMOUNT_OUT_OF_RANGE`.
- Issues are collected, not first-fail.

**items / aggregation**
- 3 lines at 18 % plus 1 at 5 % → items `1801` and `501` with summed values. Rate 0.25 → `26`; rate 0 → `1`.
- Intra items have `camt`/`samt` and no `iamt`; inter items have `iamt` only. A UT POS puts UTGST in `samt`.
- `val` = `grandTotal`, including `roundOff`/`otherCharges`.
- b2cs rows merge by (`sply_ty`, `pos`, `rt`, `typ`).
- Odd-paisa sums are exact (model spec §10 case).

**hsn**
- b2b/cdnr lines go to `hsn_b2b`; b2cl/b2cs/cdnur/exp lines go to `hsn_b2c`.
- Same (hsn, rt, uqc) → one row; a different rate → two rows. Service → `uqc "NA"`, `qty 0`.
- Credit notes subtract.
- `num` is 1..n sorted. No `val` and no `desc` are emitted.
- `aatoAbove5Cr` with a 4-digit HSN → `HSN_LENGTH`. Qty `1.005` → `QTY_PRECISION`.
- A period with no lines → no `hsn` key.

**doc_issue**
- (a) `doc_det_new` with **string** `doc_num` `"1"`, `"4"`, `"5"`.
- (b) `doc_det` with **integer** `doc_num` `1`, `4`, `5`.
- Both carry the same derived series values.
- Documents dated before the period are not counted.
- The override replaces the derivation. `cancel > totnum` → `DOC_ISSUE_INVALID`.

**output (a) — `toApiSavePayload`**
- Key order as §4. No `null` anywhere.
- No `version`/`hash` by default; present when `options.header` is given.
- No `etin`.
- Raw number literals: `1000.00`, and `9999999999999.99` round-trips byte-exact through `parseApiSavePayloadJson`.
- Empty `documents` → `{ gstin, fp }` only.
- `FILE_TOO_LARGE` at the boundary.
- **Golden test (a):** a mixed synthetic period equals a committed expected JSON **and** validates against S5. It covers b2b intra/inter, SEZ, b2cl, b2cs, export, cdnr, cdnur B2CL, and a b2cs credit note.

**output (b) — `toOfflineUploadJson`**
- Header is always `version: "GST3.2.4"`, `hash: "hash"`.
- Key order is the tool's (§4.4 O6).
- Empty `documents` → `{ gstin, fp, version, hash }` only.
- `doc_issue.doc_det` with integer `doc_num` and `doc_typ`.
- Round-trip through `parseOfflineUploadJson`.
- `FILE_TOO_LARGE` at the 4.7 MiB boundary (generated synthetic input).
- **Golden test (b):** the same synthetic period as golden (a) equals a committed expected offline JSON **and** validates against S4.

**(a) vs (b) — "differences come only from §4.2/§4.4"**
- Normalisation test: for the golden period and for every builder test case, take outputs (a) and (b) and:
  1. drop `version`/`hash`;
  2. rename `doc_det` ↔ `doc_det_new` and convert `doc_num` integer ↔ string;
  3. ignore key order.

  The two results are **deep-equal**. Any other difference fails the test.
- Both outputs come from **one** `buildGstr1` call. The test asserts the converters are pure, with no re-classification: the same `Gstr1Return` object goes into both.
- Cross-checks: (a) fails S4 (because of `doc_det_new`), and (b) fails S5 (because of `doc_det`). The schema-conformance block above covers these.

**api surface** — no default exports.

## 10. Stop conditions (build session)
- S5 contradicts this spec somewhere not listed in §11 → follow S5 and report.
- A real GSTIN or company name would be needed in fixtures or sources → stop. The official CSV samples were redacted for this reason.
- `pnpm check` can't be made green without weakening strictness or lint rules → stop and report.

## 11. Deviations

### 11.1 Offline tool 3.2.4 vs S5 — S5 wins for output (a)

Output (b) deliberately keeps V1 and V4 as the tool writes them, and allows V2 (§4.4). V3, V5 and V6 apply to both outputs.

| # | Tool 3.2.4 | Output (a) (S5) |
|---|---|---|
| V1 | `doc_issue.doc_det`, integer `doc_num` | `doc_det_new`, string `doc_num` |
| V2 | `etin` in b2b/b2cl/b2cs | never (not in S5) |
| V3 | `hsn.data` before fp 052025 | periods before 052025 unsupported |
| V4 | always `version: "GST3.2.4"`, `hash: "hash"` | omitted unless supplied (optional in S5) |
| V5 | `diff_percent` on `exp` possible (T §0, non-import branch) | never (not in S5 `exp`; also not modelled) |
| V6 | `cfs` on groups (portal data) | never (in neither schema) |

### 11.2 Ours vs tool conventions (intentional)

| # | What | T | We | Why |
|---|---|---|---|---|
| D1 | Item tax amounts | recomputed `txval × rt`, `toFixed(2)` | sums of the document's own line amounts | DEC-5 |
| D2 | Number formatting | `parseFloat` → `1000` | 2 dp money (`1000.00`) | exact decimals; same JSON value |
| D3 | Rounding | binary `toFixed(2)` | none redone; model half-up | repo rule |
| D4 | `CBW`, `diff_percent`, `sez_auth`, `irn`… | supported / partly | never emitted | the model has no data (§12) |
| D5 | `doc_issue` series | user-entered | derived by default, override available | convenience |

**Model spec:** none of the model's rules are contradicted. The builder **tightens** some of them for GSTR-1:
- the rate list
- the PAN-structured supplier/recipient GSTIN patterns
- 2-dp HSN quantities
- S5 amount ranges
- POS `99` rejected

## 12. Deferred
- Amendment sections; advances (`at_b2b`/`at_b2c` in v5.0); `nil` and bills of supply; e-commerce (`etin` removed in v5.0; `eco_typ`/`estin`, `ecom`, `supeco`).
- `diff_percent` (65 %); `CBW`; `sez_auth`; IRN fields (`irn`, `irngendate`, `srctyp`).
- Export details `sbpcode`, `sbnum`, `sbdt`: optional in S5 and not in the model.
- Delete flow (`flag: "D"`); quarterly/IFF; periods before 052025; file splitting; HSN master check; `offlineUploadFileName()`.

## 13. Decisions (owner, 2026-10-16) — each **UNVERIFIED — needs CA**

| ID | Decision |
|---|---|
| DEC-1 | **HSN split:** documents with a GSTIN recipient (`b2b`, `cdnr`) → `hsn_b2b`; everything else (`b2cl`, `b2cs`, `cdnur`, `exp`) → `hsn_b2c`. |
| DEC-2 | **B2CS credit-note netting:** notes to unregistered persons whose original was B2C-small are netted into the `b2cs` row, negative when credit. This follows the tool's sample and S5's unbounded `b2cs` amounts. |
| DEC-3 | **B2CL threshold by return period** (as the tool does), not by invoice date. For notes, the original invoice's reporting period. **Top CA question (CA-1).** |
| DEC-4 | **Rejected in v0.1:** bills of supply (`UNSUPPORTED_DOCUMENT`); composition, SEZ-unit and SEZ-developer suppliers (`UNSUPPORTED_SUPPLIER`). |
| DEC-5 | **Tax amounts:** the document's own line amounts, summed per rate; never recomputed from `txval × rt`. |
| DEC-6 | ~~Target: the API save payload only.~~ **Superseded by DEC-7.** |
| DEC-7 | **Two outputs from one internal GSTR-1 structure** (§0):<br>(a) `toApiSavePayload()`: S5 v5.0 shape, for the GSP/API path; authoritative schema.<br>(b) `toOfflineUploadJson()`: the shape the official offline tool 3.2.4 writes (v4.1 shapes: `doc_det` with numeric `doc_num`, `etin` allowed), plus the tool's header fields `version: "GST3.2.4"` and `hash: "hash"` as the tool writes them (T §2).<br>Same classification rules for both; the differences come only from §4.2, as listed in §4.4. Tests for both (§9). |

## 14. Open questions

**For the CA — in priority order:**
1. **CA-1 (top):** DEC-3. Does the B2CL limit (₹2.5 lakh up to July 2024, ₹1 lakh from August 2024) depend on the return period in which an invoice is reported, or on the invoice date? Example: a July 2024 invoice of ₹1.5 lakh reported late in the October 2024 return. And for a credit note, which period applies to its original?
2. **CA-2:** Confirm DEC-1, DEC-2, DEC-4 and DEC-5.
3. **CA-3:** Should HSN rows net credit notes (S5 allows negatives), or report them elsewhere? (Q-6)

**For the owner / GSTN documentation:**
- **Q-2.** Does the portal's offline JSON upload accept output (b), the tool-3.2.4 / v4.1 shape? Does it also, or instead, accept a v5.0-shaped file (`doc_det_new`)? No source says.
  - Only a live upload can answer it.
  - ⚠️ **A live portal upload writes into the real draft GSTR-1 of a real GSTIN and period.** The portal has no sandbox for this path; uploaded invoices overwrite draft data (H r401–402) and must then be deleted by hand.
  - It must **only** be done **with the CA, on a real period**, with data that belongs in that return. Never with synthetic fixtures, and never by an automated test.
  - Until then, (b) mirrors the tool (DEC-7), and its acceptance is UNVERIFIED.
- **Q-3.** What is `doc_num` `"1A"` in S5 v5.0? It is not in the tool's 12-item list.
- **Q-4.** When is `sez_auth` (`SEZAO` / `SEZNAO`) expected on SEZ invoices? S5 does not make it required.
- **Q-5.** Supplies to overseas recipients that are not exports (POS 96, DOMESTIC): which section, if any?
- **Q-6.** See CA-3.
- **Q-7.** `doc_issue`: should the model track cancelled documents, and should several series per kind be inferred?
- **Q-8.** e-invoiced documents are auto-populated into GSTR-1, and S5 carries `irn`/`srctyp`. Should the builder exclude them, include them, or tag them?
- **Q-9.** Is there an API payload size limit (S5 is silent)?

## 15. `docs/legal-facts.md` rows to add (at build time)

| Fact | File |
|---|---|
| GSTR-1 API save payload shape = S5 v5.0 (in-scope sections) | `packages/gstr1/src/api-payload.ts` |
| Offline-upload JSON shape = offline tool 3.2.4 output (S4 v4.1 shapes, header `version "GST3.2.4"`, `hash "hash"`); acceptance by the portal unverified (Q-2) | `packages/gstr1/src/offline-upload.ts` |
| GSTR-1 rate list `0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40` | `packages/gstr1/src/rates.ts` |
| B2CL limit > ₹2,50,000 up to fp 07-2024, > ₹1,00,000 from fp 08-2024, inter-state only; return period decides (DEC-3) | `packages/gstr1/src/classify.ts` |
| B2CS: unregistered intra-state of any value, or inter-state ≤ limit; B2CS notes netted (DEC-2) | `classify.ts` |
| Invoice types R/DE/SEWP/SEWOP; SEZ/export = IGST | `classify.ts` |
| CDNUR types B2CL/EXPWP/EXPWOP; notes follow the original invoice | `classify.ts` |
| Doc-issue types (T's 12; S5 string codes incl. `1A`) | `packages/gstr1/src/doc-issue.ts` |
| HSN: 6 digits if AATO > ₹5 Cr else 4; B2B/B2C split (DEC-1); services `uqc NA`; qty 2 dp | `packages/gstr1/src/hsn.ts` |
| Supplier/recipient GSTIN patterns (S5 `#gstin`, `#ctin`) | `packages/gstr1/src/recipient.ts` |
| Document dates 01-07-2017 … end of return period | `build.ts` |
| Rejections: bills of supply, composition and SEZ suppliers (DEC-4) | `build.ts` |
| Upload size 5 MB (tool splits at 4.7 MiB) | `serialize.ts` |

Each row: source `sources/gstr1/…`, retrieved 2026-10-16, UNVERIFIED — needs CA.
