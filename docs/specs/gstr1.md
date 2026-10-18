# Spec — `@india-gst-kit/gstr1` (v0.1)

Status: **draft for review** (2026-10-16). **Track A2 (2026-10-18): §17 adds the remaining tables (spec only, not built).** Decisions in §13 were taken by the owner on 2026-10-16. Every legal/official fact and every decision here is **UNVERIFIED — needs CA** until a chartered accountant signs it off in `docs/legal-facts.md`.

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
- **Out of scope / deferred (§12)** in v0.1. Track A2 (§17) proposes the first four for v0.2:
  - amendments (§17.3, §17.4)
  - advances (`at`, `atadj`/`txpd`; restructured in v5.0, §4.2; §17.6)
  - `nil` (Table 8; §17.5)
  - e-commerce (Tables 14/15, `ecom`, `supeco`; 4C/5B marks; §17.7, §17.8)
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
- Amendment sections; advances (`at_b2b`/`at_b2c` in v5.0); `nil` and bills of supply; e-commerce (`etin` removed in v5.0; `eco_typ`/`estin`, `ecom`, `supeco`). **Proposed for v0.2 in §17**, except bills of supply, `eco_typ`/`estin`, and the `at_ecom` family.
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

## 16. Track E (draft 2026-10-17): cleanup and ship-to / dispatch-from

### 16.1 Lossless JSON from the model (cleanup)
`src/numbers.ts` keeps a local copy of the lossless-JSON technique ("Kept here because `@india-gst-kit/model` does not export it yet"). The model now exports it (model spec §6.8), so the copy goes; this closes that spec deviation. Model spec §13.1 lists the check of the other packages: `einvoice` (`json.ts`, `jwt.ts`), `recon` (`parse.ts`) and `ewaybill` already import from the model; only `gstr1` duplicates it.
- **Import from `@india-gst-kit/model`:** `markNumber`, `isNumberLeaf`, `unwrapSchema`, `objectShape`, `arrayElement`, `JsonNumber`, `parseJsonLossless`. Delete the local definitions, including the private `NUMBER_LEAVES` `WeakSet` and `isPlainObject` (or import an equivalent). `wire-schema.ts` must import `markNumber` from the model, so that there is one number-leaf registry (model §6.8).
- **Kept locally:** the converter, renamed `convertGstr1Numbers`. gstr1's wire schemas have plain `z.number()` count fields (`num`, `totnum`, `cancel`, `net_issue`, `doc_num`) that must become doubles, and a string under a number leaf must surface as a Zod type error (`WrongType`). The model's `convertNumbers` does neither (it turns every number into text or a `LosslessTypeIssue`), so it is not reused (model D-S13). `parseWire` keeps its behaviour.
- **Kept locally:** `writeJson` (insertion key order). Moving the writers into the model is deferred (model D-S14).
- No API, output or behaviour change: changeset `@india-gst-kit/gstr1: patch`.

Tests:
- All existing gstr1 serialise/parse tests stay green **unchanged** (byte-exact round trips, `1e3`/`+1`/string-in-number rejections, `doc_num` integer vs string per output).
- `isNumberLeaf` imported from `@india-gst-kit/model` returns `true` for a gstr1 money leaf (e.g. `ApiSavePayloadSchema` b2b item `txval`) — proves the shared registry.
- A source scan asserts that no file under `packages/*/src` other than `packages/model/src/lossless.ts` calls `JSON.parse` with a reviver or declares `class JsonNumber`.

### 16.2 Ship-to / dispatch-from
GSTR-1 has no ship-to or dispatch-from field in S4/S5, and classification uses `placeOfSupply` and the recipient only. `doc.shipTo` / `doc.dispatchFrom` are ignored.
- Test: a document with `shipTo` (in another state than the POS) and `dispatchFrom` produces exactly the same `Gstr1Return`, API payload and offline JSON as the same document without them.

## 17. Track A2 (draft 2026-10-18): the remaining GSTR-1 tables

Status: **draft for review — spec only**. Nothing in this section is built yet. Decisions D-A1–D-A16 (§17.14) are proposals for the owner, and every one of them is **UNVERIFIED — needs CA**. §1–§16 above stay in force unless this section says otherwise.

**Principle (unchanged).** The package **assembles and checks**. It never decides taxability, exemption, nil rating, whether a supply is non-GST, whether an advance is taxable, or whether a supply goes through an e-commerce operator. Every such fact is **caller input**. An amendment always refers to an **original that the caller supplies**; the package never looks up an earlier return.

**Extra sources for this section** (all already in the repo):
- **C** = the official CSV templates in `sources/gstr1/offline-tool/csv/` (redacted samples), cited by file name, e.g. "C `b2ba.csv`". Only their **header rows** are used as a source. The sample values are illustrations.
- **FG-1** = Form GSTR-1 (CGST Rules, Part B, consolidated 18-05-2021): `sources/gstr1/form-gstr1-excerpt-18052021.txt`, with "Ins. n" for an instruction. It **predates** Tables 14 and 15.
- **FG-3B** = Form GSTR-3B (same consolidation): `sources/gstr3b/form-gstr3b-excerpt-18052021.txt`.
- **AC** = the GSTR-3B Auto Calc v7.1 response schema (`sources/gstr3b/`), used only for the effect on `gstr3b` (§17.11).
- **UT** = `offline-tool/data/uploadtablename.json`.

**What the sources do not contain.** The tool's code excerpts (T) cover only the v0.1 sections. The Help sheet excerpt (H) has no rows for `b2ba`, `b2cla`, `b2csa`, `cdnra`, `cdnura`, `expa`, `at`, `ata`, `atadj`, `atadja` or the e-commerce sheets (its row 3 lists those sheets). FG-1 has no Table 14 or 15. Where this section needs one of those, it says so, and the file that settles it is in §17.17.

### 17.1 Scope: table by table

| GSTR-1 table | S5 key(s) | v0.2 status | Basis |
|---|---|---|---|
| 4C (B2B through an e-commerce operator, TCS) | `b2b` (no S5 field marks it) | **Partly built.** The caller marks documents (§17.7). (b) writes `etin`; (a) **cannot** say it (§17.15 X1). The `gstr3b` derivation uses the mark | FG-1 4C, Ins. 5(i)(c); S4 `#etin`; T §3 b2b |
| 5B (B2CL through an e-commerce operator) | `b2cl` (as 4C) | Partly built, as 4C | FG-1 5B |
| 8 (nil rated, exempted, non-GST) | `nil` | **Built from caller amounts** (§17.5) | FG-1 Table 8; S5 `nil`; C `exemp.csv`; H r233–237 |
| 9A (amended B2B, B2CL, EXP invoices) | `b2ba`, `b2cla`, `expa` | **Built** (§17.3) | FG-1 Table 9, Ins. 13; S5; C headers; UT |
| 9C (amended credit/debit notes) | `cdnra`, `cdnura` | **Built** (§17.3) | FG-1 9C, Ins. 13(iii); S5; C headers |
| 10 (amended B2CS) | `b2csa` | **Built from caller rows** (§17.4) | FG-1 Table 10, Ins. 14; S5; C `b2csa.csv` |
| 11A / 11B (advances received / adjusted), 11 II (amendments) | `at`, `txpd`, `ata`, `txpda` | **Built from caller rows**, except the e-commerce sub-arrays (§17.6) | FG-1 Table 11, Ins. 15; S5; S4; C `at*.csv` |
| 14 / 14A (supplies made through an e-commerce operator, reported by the supplier) | `supeco`, `supecoa` | **Caller rows, rendered and checked only** (§17.8) | S5; C `eco.csv`, `ecoa.csv`. **No form text** (FA-1) |
| 15 / 15A (supplies on which the operator pays tax u/s 9(5), reported by the operator) | `ecom`, `ecoma` | **Caller rows, rendered and checked only** (§17.8) | S5; C `eco*b2b.csv` …; H r8. **No form text** (FA-1) |
| 4F, 7A(2)/7B(2), 10A(1)/10B(1), IMS rows | — | **Not built** (§17.11.3) | no S5 field (7A(2), 10A(1)) or no source (4F, IMS) |

Unchanged from v0.1: quarterly/IFF, the delete flow (`flag: "D"`), `diff_percent`, `CBW`, `sez_auth`, IRN fields, shipping-bill fields, file splitting.

### 17.2 Inputs (API additions)

`Gstr1Input` gains optional, caller-supplied tables. All amounts are decimal **strings** (repo rule) and all objects are `z.strictObject`.

```ts
type Gstr1Input = {
  gstin; period; documents; options?;               // as §2
  amendments?: readonly DocumentAmendment[];        // 9A / 9C (§17.3)
  b2csAmendments?: readonly B2csAmendment[];        // 10 (§17.4)
  nil?: readonly NilRow[];                          // 8 (§17.5)
  advances?: AdvancesInput;                         // 11 (§17.6)
  ecoMarks?: readonly { kind: DocumentKind; number: string; etin: string }[]; // 4C / 5B (§17.7)
  supeco?: SupecoInput;                             // 14 / 14A (§17.8)
  ecom?: EcomInput;                                 // 15 / 15A (§17.8)
};

type DocumentAmendment = {
  original: { document: GstDocument; period: ReturnPeriod }; // as reported earlier; passed parseGstDocument
  revised: GstDocument;                                       // the full revised document; passed parseGstDocument
};

type B2csAmendment = {
  originalPeriod: ReturnPeriod;      // S5 omon
  pos: string; rate: string;         // the Table 7 row being revised
  revised:  { taxableValue: string; igst?: string; cgst?: string; sgst?: string; cess: string };
  original: { taxableValue: string; igst?: string; cgst?: string; sgst?: string; cess: string }; // as reported; used only by gstr3b (D-A4)
};

type NilRow = { supply: "INTER_REGISTERED" | "INTRA_REGISTERED" | "INTER_UNREGISTERED" | "INTRA_UNREGISTERED";
                nilRated: string; exempted: string; nonGst: string };

type AdvanceParty =
  | { kind: "B2B"; recipientGstin: string; pos: string; invoiceType: "R" | "DE" | "SEWP" | "SEWOP"; reverseCharge: boolean }
  | { kind: "B2C"; pos: string }
  | { kind: "EXPORT"; exportType: "WPAY" | "WOPAY" };
type AdvanceItem = { rate: string; amount: string; igst?: string; cgst?: string; sgst?: string; cess?: string };
type AdvanceRow = { party: AdvanceParty; items: readonly AdvanceItem[] };
type AdvancesInput = {
  received?: readonly AdvanceRow[];                                   // 11A  → at
  adjusted?: readonly AdvanceRow[];                                   // 11B  → txpd
  receivedAmendments?: readonly { originalPeriod: ReturnPeriod; original: AdvanceParty; revised: AdvanceRow }[]; // 11 II → ata
  adjustedAmendments?: readonly { originalPeriod: ReturnPeriod; original: AdvanceParty; revised: AdvanceRow }[]; // 11 II → txpda
};
```

`SupecoInput` and `EcomInput` mirror the S5 shapes of §17.8 with neutral names and decimal strings.

- **Classification and aggregation stay in `buildGstr1`.** The converters stay pure (DEC-7). `Gstr1Return` gains the new sections in neutral form, plus, for every amendment, the **original's** items in internal form. Those are never emitted; `gstr3b` needs them for the difference (§17.11).
- **`RenderResult` gains warnings** (D-A8): `{ ok: true; value: T; warnings: readonly Gstr1Issue[] }`. Today's callers that read only `value` are unaffected. Nothing is ever dropped silently: a fact one output cannot carry is a warning (when the rest is still correct) or an error.

### 17.3 Amendments of invoices and notes — Tables 9A and 9C

**What a 9A/9C row is.** It is the **full revised document** plus the original's number and date, not a difference. FG-1 Table 9 has "Details of original document" columns and "Revised details of document" columns. C `b2ba.csv` has "Original Invoice Number, Original Invoice date, Revised Invoice Number, Revised Invoice date, Invoice Value, …, Rate, Taxable Value, Cess Amount". S5 `b2ba` requires `inum`, `idt`, `oinum`, `oidt`, `val`, `itms`, and the rest.

**Section.** The original is classified exactly as in §3, **under its own period** (DEC-3 already does this for notes; FG-1 Ins. 13(i): 9A amends Tables 4, 5 and 6). The original note's own original invoice is found as in §3.3, through `documents` or `options.originalInvoices`.

| Original's section | Amendment section | S5 shape (key order as S5) | Source |
|---|---|---|---|
| `b2b` | `b2ba` | `[{ ctin, inv: [{ inum, idt, oinum, oidt, val, pos, rchrg, inv_typ, itms: [{ num, itm_det }] }] }]` | S5 `b2ba`; C `b2ba.csv` |
| `b2cl` | `b2cla` | `[{ pos, inv: [{ inum, idt, oinum, oidt, val, itms: [{ num, itm_det: { rt, txval, iamt, csamt } }] }] }]`. Group `pos` = the **original** POS; the invoice has no `pos` | S5 `b2cla`; C `b2cla.csv` "Original Place Of Supply" |
| `exp` | `expa` | `[{ exp_typ, inv: [{ inum, idt, val, oinum, oidt, itms: [{ txval, rt, iamt, csamt }] }] }]` | S5 `expa`; C `expa.csv` |
| `cdnr` | `cdnra` | `[{ ctin, nt: [{ pos, rchrg, inv_typ, val, ntty, nt_num, nt_dt, ont_num, ont_dt, itms }] }]` | S5 `cdnra`; C `cdnra.csv` |
| `cdnur` | `cdnura` | `[{ typ, pos?, val, ntty, nt_num, nt_dt, ont_num, ont_dt, itms }]`; `pos` required for `B2CL`, forbidden for `EXPWP`/`EXPWOP` (S5 `anyOf`), as `cdnur` | S5 `cdnura`; C `cdnura.csv` |
| `b2cs` | — | issue `AMENDMENT_USE_TABLE_10`: Table 7 is amended as a rate/POS row in Table 10, never per invoice (FG-1 Ins. 14) | FG-1 Tables 7, 10 |
| a b2cs-netted note (N4) | — | the same issue | DEC-2 |

**Field values.** `inum`/`nt_num`, `idt`/`nt_dt`, `val`, `pos`, `rchrg`, `inv_typ`, `ntty`, `typ`, `exp_typ` and the items come from the **revised** document, built exactly as §4 (one item per rate, `num = rt × 100 + 1`, same sums, same IGST/CGST rules). `oinum`/`oidt` and `ont_num`/`ont_dt` are the original's number and date. Ranges are §4.1's. No `flag`, `diff_percent`, `sez_auth`, `eco_typ` or `estin` is emitted.

**Checks** (each failure is an issue; the amendment is not placed):

| Code | Rule | Basis |
|---|---|---|
| `AMENDMENT_PERIOD` | `072017 ≤ original.period < period` (the year is compared first) | FG-1 Table 9 "furnished in returns for earlier tax periods"; §3.1 date floor |
| `AMENDMENT_KIND_MISMATCH` | `revised.kind === original.document.kind` | design (D-A2) |
| `AMENDMENT_SECTION_CHANGE` | the revised document, classified under the **original's** period, lands in the same section as the original (so a B2CL invoice revised below the limit, or an unregistered recipient revised to a registered one, is refused) | D-A2; no source states what happens then (Q-A5) |
| `AMENDMENT_RECIPIENT_CHANGE` | `b2ba`/`cdnra`: same recipient GSTIN. C `b2ba.csv`/`cdnra.csv` have one "GSTIN/UIN of Recipient" column and S5 one `ctin` per group | C; S5 |
| `AMENDMENT_POS_CHANGE` | `b2cla`: revised POS = original POS. S5 `b2cla` has only the group `pos` and C `b2cla.csv` calls it "Original Place Of Supply" | S5; C |
| `AMENDMENT_USE_TABLE_10` | see the table above | FG-1 Ins. 14 |
| `DUPLICATE_AMENDMENT` | no two amendments of the same original (kind, number, date); no revised number twice among the revised invoices, or among the revised notes | H r401 (a later upload overwrites) |
| `AMENDMENT_ORIGINAL_IN_PERIOD` | the original is not also in `documents` | it would then be a current-period document, not an earlier one |
| §3.1 rules | every §3.1 precondition also applies to the **revised** document (supplier, GSTIN formats, rates, POS patterns, ranges, `REVERSE_CHARGE_B2C`, …). `DATE_OUT_OF_RANGE` checks the revised date against the end of `period` | §3.1 |

- No time limit for amending is checked: no source in the repo states one (Q-A6; never filled from memory).
- **Not checked:** that the original matches what the portal holds. The caller supplied it and is responsible for it.
- An amended note keeps its own `ntty` and positive amounts, as in §3.3.

### 17.4 Amendments of B2CS — Table 10

- **Input.** One `B2csAmendment` per revised Table 7 row (`originalPeriod`, `pos`, `rate`). The package cannot rebuild an earlier Table 7 row from invoices, so both the **revised** row and the row **as originally reported** are caller input (D-A4). The original amounts are used only by `gstr3b`.
- **Section `b2csa` (S5).** `[{ typ: "OE", sply_ty, pos, omon, itms: [{ rt, txval, iamt | camt+samt, csamt }] }]`. Rows are grouped by (`omon`, `pos`, `sply_ty`); `itms` has one entry per rate. `sply_ty` = `INTRA` if `pos = S`, else `INTER` (the §3.2 I4 rule). `typ` is always `"OE"` (§17.7: e-commerce marking of B2CS is not supported).
- **Signs.** `txval` and the amounts may be negative: S5 `b2csa` items use `#txvalue`/`#nonEmptyNil`, which have no minimum (as `b2cs`, DEC-2; C `b2cs.csv` has a negative sample). Range: ≤ 99 999 999 999.99.
- **Checks.** `AMENDMENT_PERIOD` on `originalPeriod`; `POS_NOT_ACCEPTED` (S5 `#state_cd`, no `96`); `RATE_NOT_ACCEPTED`; `B2CS_TAX_SPLIT` (an `INTRA` row has `cgst`/`sgst` and no `igst`; an `INTER` row the reverse; FG-1 Table 10 columns); `DUPLICATE_B2CS_AMENDMENT` for the same (`originalPeriod`, `pos`, `rate`).
- **Not checked:** CGST = SGST (as `gstr3b` Q-H10).

### 17.5 Nil rated, exempted and non-GST — Table 8

- **Input.** Up to four `NilRow`s, each with the three columns of FG-1 Table 8. Classifying a supply as nil rated, exempt or non-GST is a **taxability decision**, so it is always caller input. The package never derives Table 8 from documents. H r235: the nil-rated column "should exclude amount already declared in B2B and B2CL table as line items in tax invoice".
- **Rows.** The `supply` codes map to S5 `sply_ty` by name (D-A5): `INTER_REGISTERED → INTRB2B`, `INTRA_REGISTERED → INTRAB2B`, `INTER_UNREGISTERED → INTRB2C`, `INTRA_UNREGISTERED → INTRAB2C`. FG-1 8A–8D and C `exemp.csv` name the four rows ("Inter-State supplies to registered persons", …), but no source states which code is which row (FA-3).
- **Output (S5).** `nil: { inv: [{ sply_ty, nil_amt, expt_amt, ngsup_amt }] }`, rows in FG-1 order 8A, 8B, 8C, 8D, absent rows omitted. All three amounts are always emitted (S5 requires them). `nil` is omitted when no row is given.
- **Range and sign.** S5 `#nonEmptyNil`: ≤ 99 999 999 999.99, **no minimum**, `multipleOf 0.01`. Negative values are accepted, as S5 allows (Q-A9).
- **Checks.** `DUPLICATE_NIL_ROW` (the same `supply` twice); `AMOUNT_OUT_OF_RANGE`.

### 17.6 Advances — Table 11

**Input.** Caller rows (§17.2). Whether an advance is taxable, at which rate, and which invoice it is adjusted against, are all caller facts. FG-1 Ins. 15: Table 11A is advances received in the period for which no invoice was issued in the same period; Table 11B is the adjustment of advances reported earlier against invoices of this period.

**Section (S5 v5.0).** `at` (11A) and `txpd` (11B) are **objects** in S5, split by party:

| Party | S5 array | S5 row (required keys) | Notes |
|---|---|---|---|
| `B2B` | `at.at_b2b` / `txpd.txpd_b2b` | `rtin, pos, sply_ty, inv_typ, rchrg, itms` | `rtin` = `#ctin`; `pos` = `#state_cd_foreign` (96 allowed); `inv_typ` enum `R, RC, DE, SEWP, SEWOP`. We never emit `RC` (Q-A3) |
| `B2C` | `at.at_b2c` / `txpd.txpd_b2c` | `pos, sply_ty, itms` | `pos` = `#state_cd` |
| `EXPORT` | `at.at_exp` / `txpd.txpd_exp` | `exp_typ, sply_ty, itms` | **no `pos`** in S5 |
| e-commerce | `at.at_ecom.{at_ecomurp2b, at_ecomurp2c}`, `txpd.txpd_ecom.*` | — | **not built**: no source says what they are (Q-A4, FA-1/FA-4) |

- **Items.** `itms: [{ ad_amt, iamt | camt+samt, csamt, rt }]`, one per rate, summed per row key. Row keys: `B2B` (`rtin`, `pos`, `inv_typ`, `rchrg`); `B2C` (`pos`); `EXPORT` (`exp_typ`). `ad_amt` = Σ `amount`.
- **`sply_ty`.** For `B2B`/`B2C`: `INTRA` if `pos = S`, else `INTER`, and always `INTER` for `SEWP`/`SEWOP` (T §4 `getSupplyType`). For `EXPORT`: `INTER` (D-A6).
- **Range and sign.** S5 `#nonEmptyCostAT`: ±99 999 999 999.99, so negatives are allowed in all four sections (C `at.csv` has a negative "Gross Advance Received" sample). `rt` 0 … 999.99 and in the §3.1 rate list.
- **Amendments (11 II).** `ata` / `txpda` have the same split, plus `omon` (original period) and the original's party: `opos`, `oinv_typ`, `ortin`, `orchrg` for `B2B`; `opos` for `B2C`; `oexp_typ` for `EXPORT`. The row carries the **revised** figures; FG-1 Table 11 II says "[Furnish revised information]".
- **Checks.**
  - `ADVANCE_TAX_SPLIT`: an `INTRA` row has `cgst`/`sgst` and no `igst`; an `INTER` row the reverse. FG-1 Table 11 splits 11A(1)/11B(1) intra-State and 11A(2)/11B(2) inter-State.
  - `RECIPIENT_GSTIN_FORMAT` on `recipientGstin` (S5 `#ctin`); `POS_NOT_ACCEPTED` per the patterns above; `RATE_NOT_ACCEPTED`; `AMOUNT_OUT_OF_RANGE`.
  - `REVERSE_CHARGE_B2C` does not arise: only `B2B` has `rchrg`.
  - `ADVANCE_PARTY_CHANGE`: an amendment's revised party has the same `kind` as its original (D-A6).
  - `AMENDMENT_PERIOD` on `originalPeriod`.
  - **Not checked:** tax = amount × rate (no rounding rule for advances is in the sources; Q-A10); adjusted ≤ received earlier (the package has no history).

### 17.7 E-commerce marking — Tables 4C and 5B

- **Input.** `ecoMarks` names documents made "through e-commerce operator attracting TCS" (FG-1 4C, 5B). Whether a supply is one is a caller fact.
- **Where a mark is allowed** (`ECO_NOT_APPLICABLE` otherwise): a tax invoice that classifies to `b2b` with `inv_typ R` and no reverse charge, or to `b2cl`. FG-1 Table 4 excludes Table 6 supplies, 4A separates reverse charge from e-commerce, and FG-1 does not say whether a reverse-charge supply can be 4C (Q-A7). B2CS rows are not marked; see the last bullet.
- **Checks.** `ECO_GSTIN_FORMAT`: `etin` matches S4 `#etin`, a PAN-structured GSTIN with `C` in position 14. `ECO_UNKNOWN_DOCUMENT`: the mark names no document in `documents`. `DUPLICATE_DOCUMENT`: the same document is marked twice.
- **Output (b), offline-upload.** `etin` on the `b2b`/`b2cl` invoice, as the tool writes it (T §3 b2b, b2cl; S4).
- **Output (a), API (S5 v5.0).** S5 has **no** `etin` in `b2b` or `b2cl`. It was removed in v5.0 (§4.2). The invoice is rendered without it and the result carries the warning `ECO_NOT_IN_API_SHAPE`, once per marked document (D-A8). See §17.15 X1.
- **Other outputs.** HSN, doc_issue and B2CS are unchanged by marks.
- **B2CS `typ "E"`** is **not** emitted. S4 and S5 both allow `typ "E"` and C `b2cs.csv` has a sample row with "E", but the tool rejects any Excel Type other than `OE` (T §3 b2cs, `/^(OE)$/`). FG-1 7A(2)/7B(2) are "out of" rows of 7A(1)/7B(1), and AC has no key for them. §17.15 X2.

### 17.8 Tables 14 and 15 — caller rows, rendered and checked only

FG-1 (2021) has neither table. Their meaning comes only from S5 field descriptions, C headers and H r8 ("Table 15 - Supplies U/s 9(5) - B2B / URP2B … Table 15 is applicable from Oct 2022 and Table 15A is applicable from Nov 2022"). So the package **never derives** them from documents (D-A9). It validates caller rows against S5, renders them, and transcribes them into (b).

**Table 14 — `supeco` / `supecoa` (S5).**
- `supeco: { clttx: [Row], paytx: [Row] }`, `Row = { etin, suppval, igst, cgst, sgst, cess?, flag? }`.
- `supecoa: { clttxa: [ARow], paytxa: [ARow] }`, `ARow = Row + { oetin, omon }`.
- C `eco.csv` "Nature of Supply" has two values, "Liable to collect tax u/s 52(TCS)" and "Liable to pay tax u/s 9(5)". Our input names the arrays `collectsTcs` → `clttx` and `paysTax95` → `paytx`, matched **by name** (D-A9, FA-1).
- Amounts are `#nonEmptyCostAT` (±). `etin`/`oetin` are `#ctin` in S5, and a loose `^[a-zA-Z0-9._\s]+$` in S4.

**Table 15 — `ecom` / `ecoma` (S5).** These rows are filed by the **operator**: `stin` is "GSTIN/UID of the Supplier taxpayer" (S5) and `rtin` the recipient. The arrays:
- `ecom.b2b`: `[{ stin, rtin, inv: [{ inum, idt, val, pos, sply_ty, inv_typ, flag, itms }] }]`
- `ecom.urp2b`: `[{ rtin, inv: [...] }]` (no supplier GSTIN)
- `ecom.b2c`: `[{ stin, pos, sply_ty, rt, txval, iamt?, camt?, samt?, csamt?, flag }]`
- `ecom.urp2c`: as `b2c` without `stin`
- `ecoma`: `b2ba`, `urp2ba` (with `oinum`, `oidt`), `b2ca` (`[{ pos, posItms: [{ stin, ostin, omon, sply_ty, flag, itms }] }]`) and `urp2ca` (`omon`)
- `inv_typ` in `ecom` is `R, DE, SEWP, SEWOP` (no `CBW`).

**`flag` is required** in every `ecom`/`ecoma` invoice and row in both S5 and S4 (`#ecomFlag` `N`, `E`, `D`). It is optional in S5 `supeco` and **required** in S4 `supeco`. No source defines the values. So `flag` is a **required caller input** on every Table 15 row, optional on a Table 14 row (as in S5), and never defaulted (D-A9, Q-A1). A Table 14 row without `flag` renders in (a) and is `NOT_IN_OFFLINE_SHAPE` in (b) (O13).

**Checks.** S5 patterns: `#ctin` on `stin`/`rtin`/`etin`; POS patterns; the `MMYYYY` `omon`; the rate list; ranges. Also `TAX_SPLIT` per `sply_ty`, and `DUPLICATE_DOCUMENT` among the `ecom` invoice numbers per supplier.

**Not checked.**
- Whether the filer is an operator. The model has no such registration type (Q-A2).
- That Table 14 equals the sum of the `ecoMarks` documents. That is plausible, but no source states it (Q-A8).

**Schema quirk.** S5 and S4 write `ecom.*.inv[].itms` as tuple-form `items: [ {...} ]`, so only the **first** item is checked by the JSON Schema. Our Zod schema checks every item (stricter, §17.15 X9).

### 17.9 Outputs (a) and (b) for the new sections (extends §4, §4.4 and DEC-7)

- **(a) key order** = S5 property order: `gstin, fp, [hash, version], b2b, b2ba, b2cl, b2cla, b2cs, b2csa, cdnr, cdnra, cdnur, cdnura, nil, exp, expa, at, txpd, ata, txpda, ecom, ecoma, supeco, supecoa, hsn, doc_issue`. Inside each object the order is S5's, as transcribed.
- **(b)** uses S4's shapes. S4 vs S5 for the amendment sections, `nil`, `expa`, `ecom`/`ecoma`, `supeco`/`supecoa` differs only in `etin` (S4), `diff_percent`, `sez_auth`, `eco_typ`/`estin` (S5 `cdnra`), `ntty "R"` and `flag "D"` (S5), and the items listed in O12–O13. The `at` family differs structurally (O10). For the **new** sections, (b) follows **S4 only**: the tool's code for them is not in T (FA-3).

New rows for the §4.4 table (differences allowed between (a) and (b); nothing else may differ):

| # | Item | (b) offline-upload | (a) API | Source of (b) |
|---|---|---|---|---|
| O8 | `etin` on `ecoMarks` documents | emitted | not emitted, with warning `ECO_NOT_IN_API_SHAPE` | S4 `#etin`; T §3 b2b/b2cl; S5 |
| O9 | key order of new sections | each amendment key right after its base key (`b2b, b2ba, b2cl, b2cla, …`, as T §2's template shows for `b2ba`); `nil, at, ata, txpd, txpda, supeco, supecoa, ecom, ecoma` before `doc_issue`, in S4 order **[infer]** | S5 order | T §2 (partial); S4 order |
| O10 | advances | **flat** S4 rows `at[] / txpd[] / ata[] / txpda[] = { pos, sply_ty, [omon], itms }`. The `B2B` and `B2C` rows of one (`pos`, `sply_ty`[, `omon`]) are **merged** and their items summed per rate | split objects `at_b2b` / `at_b2c` / `at_exp` | S4 `at`; C `at.csv`, `atadj.csv` (columns: POS, rate, amount, cess only) |
| O11 | advances S4 cannot express | issue `NOT_IN_OFFLINE_SHAPE`, and (b) fails: an `EXPORT` row (S4 `pos` is required and `#state_cd` has no export value); a `B2B` row with POS `96` (S4 `#state_cd`); a negative `txpd`/`txpda` amount (S4 `#nonEmptyCost` ≥ 0); an `ata`/`txpda` row whose revised POS ≠ original POS (S4 has one `pos`, which C `ata.csv` calls "Original Place Of Supply") | expressed | S4; C |
| O12 | `ata`/`txpda` `rt` | S4 `#nonEmptyRate` max **999.9**; every listed rate fits | max 999.99 | S4 |
| O13 | Table 14 `flag` | required (S4); absent → `NOT_IN_OFFLINE_SHAPE` | optional; emitted when given | S4 / S5 `supeco` |
| O14 | Table 14 `etin` pattern | S4 loose pattern | S5 `#ctin` | S4 / S5. Every valid S5 value is a valid S4 value, so this is never a difference in practice |

The DEC-7 normalisation test (§9) is extended. Besides steps 1–3, it:
4. re-merges (a)'s `at_b2b`/`at_b2c` into S4 rows (O10);
5. drops `etin` (O8).

After that the two outputs must be deep-equal for every test case that (b) can express.

### 17.10 HSN and doc_issue are unchanged

- **HSN (Table 12)** is still built only from current-period `documents` (§5.2). Amendments, Table 10, advances, Table 8 and Tables 14/15 do not feed it (D-A10, Q-A11).
- **doc_issue (Table 13)** is still derived from `documents` only (§5.3). Revised documents are not counted as "Revised Invoice" (`doc_num 3`); use the `options.docIssue` override (D-A10).

### 17.11 Effect on `gstr3b` (`outwardFromGstr1`)

`gstr3b` reads the new sections from `Gstr1Return`. Mapping M is unchanged: it is quoted from AC (gstr3b §4.2). Only mapping G grows. Each new row is marked **sourced** (FG-1/FG-3B) or **proposal**. The full text goes into gstr3b §22.

#### 17.11.1 New G rows

| Row | `Gstr1Return` data | AC key(s) | Basis |
|---|---|---|---|
| G1′ | `b2b` R, no RCM, **e-commerce-marked** | `3.1a tbl4c` (all heads); `3.2comp`/`3.2uin tbl4c` per `recipientTypes` | **sourced**: FG-1 4A "other than … (ii) supplies made through e-commerce operator", 4C, Ins. 5(i)(c); AC `tbl4c` in 3.1a and both 3.2 lists |
| G6′ | `b2cl`, marked | `3.1a tbl5b` (iamt, csamt). Not 3.2: AC `osup_unreg_3_2` has **no** `tbl5b` | **sourced**: FG-1 5B; mapping M as quoted |
| G11 | `nil` | `3.1c tbl8` (`txval` = Σ `nil_amt` + `expt_amt` over all rows); `3.1e tbl8` (`txval` = Σ `ngsup_amt`) | **sourced**: FG-1 Table 8 columns; FG-3B 3.1 (c) "Nil rated, exempted" and (e) "Non-GST"; gstr3b Q-H8 (settled) |
| G12 | `b2ba` / `b2cla` / `expa` | `tbl9a` in `3.1a` (from `R`, `DE`, B2CL) or `3.1b` (from `SEWP`, `SEWOP`, `WPAY`, `WOPAY`); `3.2comp`/`3.2uin tbl9a` (from `R`, per `recipientTypes`); `3.2unreg tbl9a` (from B2CL) | 9A = amendments of Tables 4/5/6: **sourced** (FG-1 Ins. 13(i)). Routing by invoice type: **proposal**, as gstr3b D-H6 (c) |
| G13 | `cdnra` / `cdnura` | `tbl9c`, routed as G12 by the note's `inv_typ`/`typ` (`EXPWP`/`EXPWOP` → 3.1b) | 9C: **sourced** (FG-1 9C, Ins. 13(iii)); routing: **proposal** |
| G14 | `b2csa` | `3.1a tbl10a` (`INTRA`: txval, camt, samt, csamt); `3.1a tbl10b` and `3.2unreg tbl10b` (`INTER`: txval, iamt, csamt / pos, txval, iamt) | **sourced**: FG-1 10A intra-State, 10B inter-State; AC field sets |
| G15 | advances `at` / `txpd` | **opt-in only** (`ctx.confirmAdvanceMapping: true`, D-A14): `at` `B2B`/`B2C` → `3.1a tbl11a_1_2_4` (+); `txpd` → `tbl11b_1_2_4` (−); `EXPORT` → `3.1b tbl11a_3` / `tbl11b_3`; `INTER` `B2C` → `3.2unreg tbl11a_4_5` / `tbl11b_4_5`; `INTER` `B2B` with comp/UIN → `tbl11a_1_5` / `tbl11b_1_5` | Signs: **sourced** (FG-3B Ins. 1 "+ value of advances received … – value of advances adjusted"; AC `tbl11b_*` is `#negtxamt` ≤ 0). Keys: **proposal**. The suffixes are undefined (gstr3b Q-H2), and AC also has a second family `tbl11_i_*`/`tbl11_ii` in the same boxes (§17.15 X5) |

#### 17.11.2 Amounts of an amendment (D-A12)

- An amendment contributes **revised − original**, per head and per (box, AC key, `pos`). This uses the original items held in `Gstr1Return` (§17.2).
- Basis:
  - FG-3B Ins. 3: "Amendment in any details to be adjusted and not shown separately".
  - AC `tbl9a`, `tbl9c`, `tbl10a` and `tbl10b` are signed `#txamt`.
- The difference itself is **our reading**; needs CA (Q-A12).
- Notes keep the sign rule of gstr3b D-H6 (b) on both sides of the difference.
- When an amended invoice's POS changes, the old POS row gets −original and the new POS row gets +revised.
- RCM amendments are `RCM_NOT_MAPPED`, as in gstr3b G5 and Q-H4. AC has no `tbl9a` taxable-value-only key like `tbl4b`.

#### 17.11.3 Still not covered (stays caller input)

| AC key(s) | Why |
|---|---|
| `tbl4f` | not in FG-1 (2021); meaning unknown (FA-1) |
| `tbl11c_*`, `tbl11d_*`, `tbl11_ii` (advance amendments) | AC `tbl11c_*` is `#nonzerotxamt` (≥ 0), which does not fit a revised − original difference. Unclear whether AC holds revised or differential figures (§17.15 X6, Q-A13) |
| `tbl11_i_a_1`, `tbl11_i_a_2`, `tbl11_i_b_1`, `tbl11_i_b_2` | the legacy family; never fed together with `tbl11a/b_*` (X5) |
| all `tbl11*` without `confirmAdvanceMapping` | D-A14 |
| `tbl15*`, `tbl14b`, `tbl14b_A`, `tbl9bSezEco*`, `tbl9cSezEco*`, `tbl9burp2b`, `tbl9curp2b` | Tables 14/15 are not derived (D-A9). The same `tbl15*` key appears under 3.1b, 3.1.1(i) and 3.2, and no source says which rows go where (gstr3b Q-H12). 14(b) ↔ `paytx` is unsourced (FA-1, F3) |
| `ims_*` | Invoice Management System actions are the recipient's, not in GSTR-1 |

#### 17.11.4 API and spec changes in `gstr3b` (minor)

- `ctx.confirmAdvanceMapping?: boolean` (default `false`).
- `AC_GSTR1_MAP` gains the rows above.
- `AC_NOT_COVERED` shrinks to §17.11.3. The advance keys are listed only while the flag is off.
- gstr3b §3.3 "boxes the package never fills": **3.1c and 3.1e may now hold `GSTR1` entries** (from caller-supplied Table 8, G11). The nil/exempt/non-GST decision was the caller's, made in the `gstr1` input (D-A13).
- `unmapped` gains `AMENDMENT_RCM_NOT_MAPPED` (or reuses `RCM_NOT_MAPPED` with section `b2ba`/`cdnra`).

### 17.12 Issue codes (additions to §8)

`AMENDMENT_PERIOD`, `AMENDMENT_KIND_MISMATCH`, `AMENDMENT_SECTION_CHANGE`, `AMENDMENT_RECIPIENT_CHANGE`, `AMENDMENT_POS_CHANGE`, `AMENDMENT_USE_TABLE_10`, `AMENDMENT_ORIGINAL_IN_PERIOD`, `DUPLICATE_AMENDMENT`, `DUPLICATE_B2CS_AMENDMENT`, `B2CS_TAX_SPLIT`, `DUPLICATE_NIL_ROW`, `ADVANCE_TAX_SPLIT`, `ADVANCE_PARTY_CHANGE`, `ECO_GSTIN_FORMAT`, `ECO_NOT_APPLICABLE`, `ECO_UNKNOWN_DOCUMENT`, `TAX_SPLIT` (Tables 14/15), `NOT_IN_OFFLINE_SHAPE` (converter (b) only).

The one **warning** is `ECO_NOT_IN_API_SHAPE`, from converter (a), returned in `warnings` (D-A8).

### 17.13 Test list (Vitest; written first)

The fixtures are synthetic, use only the GSTINs in `packages/fixtures/src/gstins.ts`, and add one synthetic TCS-shaped `etin` (position 14 = `C`) with a computed check digit.

**Schema conformance (extends §9)**
- Every (a) output in the new tests validates against **S5**, and every (b) output against **S4** (Ajv, `strict: false`).
- The Zod and Ajv agreement tables gain rows for:
  - `b2ba` without `oinum`
  - `b2cla` with an invoice-level `pos` (invalid)
  - `cdnura` `EXPWP` with `pos` (invalid)
  - `nil` row missing `ngsup_amt`
  - `at` as an array in (a) (invalid) and as an object in (b) (invalid)
  - `txpd` with a negative `ad_amt`: valid S5, invalid S4
  - `at_b2b` `inv_typ "RC"`: valid S5, never emitted
  - `ecom.b2b` invoice without `flag` (invalid)
  - an `ecom.b2b` second item that only Zod rejects (X9)
  - `supeco` row without `flag`: valid S5, invalid S4

**9A / 9C**
- An original b2b invoice in fp `062025` revised in fp `092025` → `b2ba` with revised `inum`/`idt`/`val`/items and the original `oinum`/`oidt`.
- B2CL original → `b2cla` grouped by the original POS. A revised POS → `AMENDMENT_POS_CHANGE`.
- Threshold: an original ₹1.5 lakh inter-state invoice from fp `072024` was B2CS then, so its amendment → `AMENDMENT_USE_TABLE_10`.
- The same invoice reported in fp `082024` → `b2cla`. Revised to ₹90,000 → `AMENDMENT_SECTION_CHANGE`.
- Export original → `expa`, `exp_typ` from the revised invoice. WOPAY items have `iamt`/`csamt` `0.00`.
- Note originals: cdnr → `cdnra` with `ont_num`/`ont_dt`; cdnur EXPWOP → `cdnura` without `pos`; cdnur B2CL → `cdnura` with `pos`.
- A b2cs-netted note → `AMENDMENT_USE_TABLE_10`.
- Each error:
  - original period = current, or `062017` → `AMENDMENT_PERIOD`
  - kind changed → `AMENDMENT_KIND_MISMATCH`
  - recipient changed → `AMENDMENT_RECIPIENT_CHANGE`
  - two amendments of one original → `DUPLICATE_AMENDMENT`
  - original also in `documents` → `AMENDMENT_ORIGINAL_IN_PERIOD`
  - revised date after the period end → `DATE_OUT_OF_RANGE`
  - revised rate `0.5` → `RATE_NOT_ACCEPTED`
- `Gstr1Return` holds the original items. Neither output emits them (a scan for the original's amounts finds nothing).

**Table 10**
- Intra row → `b2csa` `INTRA` with `camt`/`samt`; inter row → `INTER` with `iamt`.
- Two rates for the same (`omon`, `pos`) → one row, two `itms`.
- A negative revised `txval` is emitted.
- Errors: `igst` on an INTRA row → `B2CS_TAX_SPLIT`; POS `96` → `POS_NOT_ACCEPTED`; duplicate key → `DUPLICATE_B2CS_AMENDMENT`.

**Table 8**
- Four rows → `nil.inv` in 8A–8D order with the four codes.
- A missing column is emitted as `0.00`.
- A negative amount is accepted.
- No rows → no `nil` key.
- Duplicate `supply` → `DUPLICATE_NIL_ROW`.

**Table 11**
- `B2B` intra row → `at_b2b` with `rtin`, `sply_ty INTRA`, `camt`/`samt`.
- `SEWP` → `INTER` even when `pos = S`.
- `B2C` inter → `at_b2c`. `EXPORT` → `at_exp` with `sply_ty INTER` and no `pos`.
- Rows with the same key merge; items sum per rate.
- `txpd` mirrors `at`.
- `ata` carries `omon`, `opos`, `oinv_typ`, `ortin`, `orchrg`.
- Errors: `ADVANCE_TAX_SPLIT`, `ADVANCE_PARTY_CHANGE`, `RECIPIENT_GSTIN_FORMAT`.
- (b):
  - `B2B` + `B2C` with the same (`pos`, `sply_ty`) merge into one S4 `at` row with summed items.
  - `EXPORT` → `NOT_IN_OFFLINE_SHAPE`.
  - negative `txpd` → `NOT_IN_OFFLINE_SHAPE`.
  - `ata` revised POS ≠ original → `NOT_IN_OFFLINE_SHAPE`.
  - (a) still renders in all of these cases.

**4C / 5B**
- A marked b2b R invoice: (b) has `etin`; (a) has none and returns warning `ECO_NOT_IN_API_SHAPE`.
- A marked b2cl invoice: the same.
- Marking an exp, b2cs, RCM or SEZ invoice → `ECO_NOT_APPLICABLE`.
- A mark on an unknown number → `ECO_UNKNOWN_DOCUMENT`.
- An `etin` without `C` at position 14 → `ECO_GSTIN_FORMAT`.
- b2cs `typ` is always `OE`.

**Tables 14 / 15**
- `supeco` `collectsTcs`/`paysTax95` → `clttx`/`paytx`; amendments → `clttxa`/`paytxa` with `oetin`/`omon`.
- `ecom` b2b/urp2b/b2c/urp2c and `ecoma` b2ba/urp2ba/b2ca/urp2ca render as S5 with the caller's `flag`.
- A missing `flag` is a schema error for Table 15, and `NOT_IN_OFFLINE_SHAPE` for Table 14 in (b) only.
- No Table 14/15 data is ever produced from `documents`.

**Unchanged behaviour**
- HSN and doc_issue are byte-identical with and without amendments, Table 10, nil, advances and Tables 14/15.
- Every v0.1 test stays green unchanged, apart from `RenderResult` gaining `warnings: []`.

**DEC-7 normalisation** with steps 4–5 (§17.9), over every new case that (b) can express.

**Golden tests (a) and (b)** gain one mixed synthetic period with every new section that (b) can express. Each is committed, and validated against S5 and S4 respectively.

**`gstr3b` (in its own test list, gstr3b §22)**
- One test per new G row.
- A delta test: original ₹1,000 / revised ₹1,200 → `+200.00` in `tbl9a`.
- A POS-change test.
- An RCM-amendment test → unmapped.
- Advances are absent without the flag, present with it, with the right signs.
- `notCovered` equals §17.11.3 in both flag states.

### 17.14 Decisions (proposed; owner to approve) — each **UNVERIFIED — needs CA**

| ID | Decision | Recommend |
|---|---|---|
| D-A1 | **Assemble, never decide.** Tables 8, 10, 11, 14 and 15 and the e-commerce marks are caller input. The package derives only the section of a 9A/9C amendment (from the caller's original) and the `gstr3b` differences. | approve |
| D-A2 | **9A/9C amendments** take a full revised `GstDocument` plus a caller-supplied original with its period. The section follows the original, classified under its own period (DEC-3). A change of kind, section or recipient, a B2CL POS change, or a B2CS original is an error. | approve; **needs CA** (Q-A5) |
| D-A3 | **Amendment window:** `072017 ≤ original period < period`. No statutory time limit is checked (not in sources). | approve; **needs CA** (Q-A6) |
| D-A4 | **Table 10** rows are caller input, revised **and** as originally reported. The original is used only by `gstr3b`. | approve |
| D-A5 | **Table 8** codes are mapped by name (`INTR*` = inter-State, `INTRA*` = intra-State). Negative amounts are accepted (S5). | approve; FA-3 confirms the codes |
| D-A6 | **Advances.** The party decides the array (`B2B` if there is a recipient GSTIN, `EXPORT`, otherwise `B2C`). `sply_ty` is derived; exports are `INTER`. `RC` is never emitted; the e-commerce sub-arrays are not built; an amendment keeps its party kind. | approve; **needs CA** (Q-A3, Q-A4) |
| D-A7 | **(b) advances** are merged into S4's flat rows. Anything S4 cannot express is `NOT_IN_OFFLINE_SHAPE` and (b) fails; nothing is dropped. | approve |
| D-A8 | **E-commerce marks:** only on b2b R non-RCM and b2cl invoices. (b) writes `etin`. (a) cannot, and warns (`ECO_NOT_IN_API_SHAPE`); `RenderResult` gains `warnings`. | approve; X1 is the top question for GSTN docs (Q-A7) |
| D-A9 | **Tables 14/15** are caller rows only: validated, rendered, never derived. `flag` comes only from the caller (required for Table 15, optional for Table 14 as in S5) and is never defaulted. 14 `clttx`/`paytx` are matched to the two natures by name. | approve |
| D-A10 | **HSN and doc_issue** are unaffected by the new tables. | approve; **needs CA** (Q-A11) |
| D-A11 | **DEC-7 extended** by O8–O14. The (b) key order for new sections is inferred until FA-3. | approve |
| D-A12 | **`gstr3b` amendment amounts** = revised − original per head/box/POS. Routing follows D-H6 (c). RCM amendments are unmapped. | approve; **needs CA** (Q-A12) |
| D-A13 | **`gstr3b` 3.1c/3.1e** may hold `GSTR1` entries from Table 8 (sourced split). This amends gstr3b §3.3 / D-H2. | approve |
| D-A14 | **`gstr3b` advances** are mapped only with `confirmAdvanceMapping` (keys inferred from suffixes; signs sourced). Advance amendments and Tables 14/15 are never mapped. | approve; F3 settles |
| D-A15 | **`gstr3b` 4C/5B** come from e-commerce marks: `tbl4c` in 3.1a and 3.2 comp/UIN, and `tbl5b` in 3.1a only (mapping M as quoted). | approve |
| D-A16 | **Versioning:** `@india-gst-kit/gstr1` minor (new input fields, sections, `warnings`); `@india-gst-kit/gstr3b` minor (new ctx flag, new G rows, smaller `notCovered`). | approve |

### 17.15 Source observations and contradictions

| # | Observation | Effect |
|---|---|---|
| X1 | **S5 v5.0 removed `etin`** from `b2b`, `b2cl`, `b2cs` and `cdnr`, which S4 had (§4.2). FG-1 still has Tables 4C/5B "operator wise", AC v7.1 (2026) still has `tbl4c`/`tbl5b`, and T still writes `etin`. The API payload cannot mark a 4C/5B supply, and no source says how the portal fills `tbl4c` from a v5.0 save | D-A8 warning; FA-1, FA-4 |
| X2 | **B2CS `typ "E"`**: allowed by S4 and S5, used in C `b2cs.csv`/`b2csa.csv`, but rejected by the tool's Excel import (`/^(OE)$/`, T §3 b2cs) | never emitted (§17.7) |
| X3 | **Advances restructured.** FG-1 Table 11 is rate- and POS-wise with no recipient. S4 and C `at.csv` are flat, with POS required. S5 splits by recipient (`at_b2b` needs `rtin`; `at_exp` has **no POS**; `inv_typ` adds `RC`; `at_ecom` is new). An S5 export advance cannot be written in S4 | O10, O11; Q-A3, Q-A4 |
| X4 | **Signs of advances.** S5 allows negative amounts in all four advance sections. S4 allows them in `at`/`ata` but not in `txpd`/`txpda` (`#nonEmptyCost` ≥ 0). C `at.csv` has a negative sample | O11 |
| X5 | **Two advance families in AC**, side by side in the same boxes: `tbl11_i_a_1/2`, `tbl11_i_b_1/2`, `tbl11_ii` (which match FG-1 "11 I 11A(1)/(2)…", intra-State with camt/samt, inter-State with iamt), and `tbl11a/b/c/d_{1_2_4,3,5,4_5,1_5}` (undefined suffixes that line up with S5's `b2b`/`exp`/`b2c`/`ecom` split). Feeding both would double-count | D-A14 opt-in, new family only |
| X6 | AC `tbl11c_*` (amended advances received) is ≥ 0 and `tbl11d_*` ≤ 0. This is not a signed revised − original difference, unlike `tbl9a`/`tbl9c`/`tbl10*` | advance amendments not mapped |
| X7 | **`flag` required where it is never explained.** `ecom`/`ecoma` require `flag` (`N`/`E`/`D`) in S4 and S5; S4 `supeco` requires it and S5 does not. The values are undefined in every source | D-A9; Q-A1 |
| X8 | **B2CL amendments cannot change POS.** S5 `b2cla` has only a group `pos`, and C `b2cla.csv` calls it "Original Place Of Supply". S5 `b2ba` and `cdnra` do carry a revised `pos` | `AMENDMENT_POS_CHANGE` |
| X9 | **Schema quirks.** `ecom.*.inv[].itms` is tuple-form (only item 1 is checked). `cdnra`/`cdnura` items have no `additionalProperties: false` (unlike `cdnr`). `expa` `rt` uses `#nonEmptyCost` (max 99 999 999 999.99). S4 `txpda` has `minItems 1`. S4 `ata`/`txpda` `rt` max is 999.9 | Zod is stricter (strictObject everywhere, every item checked); O12 |
| X10 | **H is stale.** Its Special Instruction 6 says amendment worksheets are "not being provided … in this first version", while its row 3 lists `b2ba`, `cdnra`, `at` … sheets, and the CSVs exist | H is not used for amendments |
| X11 | **FG-1 predates Tables 14/15** (and 3.1.1 in FG-3B). H r8 dates Table 15 from Oct 2022 and 15A from Nov 2022, without the form text | Tables 14/15 are caller rows only (D-A9) |
| X12 | `ecom` (Table 15) carries `stin` = the supplier GSTIN, so it is the **operator's** filing of other taxpayers' supplies. The model's `GstDocument`/`SUPPLIER_MISMATCH` cannot express that | caller rows, not documents |

No source contradicts §1–§16. X1 narrows §12's "e-commerce deferred" note: the deferral is now partly lifted for (b) only.

### 17.16 Open questions

**For the CA**
1. **Q-A12.** Is a 9A/9C/10 amendment reflected in GSTR-3B as revised − original (D-A12)? Does the same apply to tax amounts?
2. **Q-A5.** May a 9A amendment move an invoice between sections (B2CL ↔ B2CS, unregistered → registered), and where does it go then?
3. **Q-A6.** Is there a time limit for 9A/9C/10/11 II amendments that the package should enforce? If so, send the source.
4. **Q-A9.** May Table 8 amounts be negative?
5. **Q-A10.** Is the tax on an advance checked as amount × rate, and with what rounding?
6. **Q-A11.** Do amendments or advances feed Table 12 (HSN)? Do revised invoices count in Table 13 as "Revised Invoice"?
7. **Q-A7.** Can a reverse-charge or SEZ supply be a 4C supply?

**For the owner / GSTN documentation**
- **Q-A1.** What do `flag` `N`/`E`/`D` (`#ecomFlag`) and `N`/`M`/`U`/`E`/`D` (`#flag`) mean in a save request?
- **Q-A2.** Is Table 15 filed only by e-commerce operators? What is the operator's registration type?
- **Q-A3.** What is `inv_typ "RC"` in `at_b2b`, given that `rchrg` exists?
- **Q-A4.** What are `at_ecomurp2b` / `at_ecomurp2c` (and the `txpd`/`ata`/`txpda` twins)?
- **Q-A8.** Is Table 14 (`clttx`) the sum of the supplier's 4C/5B/7 e-commerce supplies?
- **Q-A13.** Do AC `tbl11c_*`/`tbl11d_*` hold revised or differential figures? Which family (`tbl11_i_*` or `tbl11a–d_*`) does the portal fill for a v5.0 save (X5, X6)?
- **Q-A14.** How does the portal fill `tbl4c`/`tbl5b` when the v5.0 save has no `etin` (X1)?

### 17.17 Files to attach (to `sources/gstr1/` unless noted)

| # | File | Settles |
|---|---|---|
| FA-1 | The **current notified Form GSTR-1** with Tables 4–15 and their instructions, i.e. a CGST Rules Part B (Forms) consolidation **after** Tables 14/15 were inserted. gstcouncil.gov.in and cbic-gst.gov.in are reachable from the build environment | Tables 14/14A/15/15A meaning (D-A9, Q-A2, Q-A8); whether 4C/5B, 7A(2)/7B(2) and 10A(1)/10B(1) still exist (X1, X2); 4F; Table 11 after the S5 split (X3) |
| FA-2 | The **full "Help Instruction" sheet** of Excel template V2.2: the rows for `b2ba`, `b2cla`, `b2csa`, `cdnra`, `cdnura`, `expa`, `at`, `ata`, `atadj`, `atadja`, `eco`, `ecoa`, `ecob2b` … `ecoaurp2c` (same zip as H) | field rules for amendments, advances and e-commerce sheets (§17.3–§17.8) |
| FA-3 | **Offline tool 3.2.4 code excerpts** (as `offline-tool/code-excerpts.md`) for `b2ba`, `b2cla`, `b2csa`, `cdnra`, `cdnura`, `expa`, `nil`, `at`, `atadj`, `ata`, `atadja`, `supeco`/`ecom`: the JSON each writes, the `nil` `sply_ty` mapping, the `flag` values written, and the full template key order (`common.js:174-200`) | (b) shapes and key order for the new sections (O9, D-A5, D-A11) |
| FA-4 | GSTN API documentation (description and sample) for **Save GSTR1 v5.0** from developer.gst.gov.in | `flag` (Q-A1), `RC` (Q-A3), `at_ecom` (Q-A4), `etin` removal (X1, Q-A14) |
| F3 | (gstr3b §17, already listed) the GSTN advisory on auto-population of GSTR-3B from GSTR-1 | AC suffixes, the two advance families (X5, X6), Table 14/15 routing; would let D-A14 become default-on |

None of these is needed for a list the package **enforces**: the new checks come from S5/S4 patterns and enums, the §3.1 rate list, and FG-1 table structure. So nothing here is a stop condition for the build. Without FA-1/FA-4, Tables 14/15 stay caller rows and 4C stays (b)-only.

### 17.18 `docs/legal-facts.md` rows to add (at build time)

Each row has source `sources/gstr1/…`, retrieved 2026-10-16/18, status UNVERIFIED — needs CA.

| Fact | File |
|---|---|
| Amendment shapes `b2ba`/`b2cla`/`expa`/`cdnra`/`cdnura` = S5 (full revised document + original number/date); B2CL amendment keeps original POS | `packages/gstr1/src/amend.ts`, `api-payload.ts` |
| 9A/9C section follows the original classified under its own period; section/recipient/kind change refused; B2CS amended only via Table 10 (D-A2) | `amend.ts` |
| Amendment window 07-2017 … period − 1; no statutory limit checked (D-A3) | `amend.ts` |
| Table 10 `b2csa` rows from caller (revised + original), `typ OE`, signed amounts (D-A4) | `b2csa.ts` |
| Table 8 `nil` codes `INTRB2B/INTRAB2B/INTRB2C/INTRAB2C` ↔ 8A–8D by name; caller amounts; signed (D-A5) | `nil.ts` |
| Advances `at`/`txpd`/`ata`/`txpda` S5 split by party; exports `INTER`; `RC` and `at_ecom` not emitted (D-A6); S4 flat merge for (b) (D-A7) | `advances.ts`, `offline-upload.ts` |
| E-commerce operator GSTIN pattern (S4 `#etin`, `C` at position 14); marks only on b2b R non-RCM and b2cl; not expressible in S5 (D-A8) | `eco.ts` |
| Tables 14/15 shapes = S5 `supeco`/`supecoa`/`ecom`/`ecoma`; caller rows; `flag` caller-supplied (D-A9) | `eco-tables.ts` |
| `gstr3b`: G1′/G6′/G11–G15 rows; amendment difference; Table 8 split to 3.1c/3.1e; advances opt-in (D-A12–D-A15) | `packages/gstr3b/src/outward.ts`, `ac-map.ts` |

### 17.19 Changeset plan

- **This spec PR:** no changeset (docs only), as for Tracks A and G.
- **Build PR:**
  - `.changeset/gstr1-remaining-tables.md` with `"@india-gst-kit/gstr1": minor`: "Build GSTR-1 Tables 8, 9A, 9C, 10, 11 (advances and their amendments), 14/14A and 15/15A from caller input, and mark 4C/5B e-commerce supplies (offline JSON only; the v5.0 API payload warns). Render results now carry `warnings`."
  - `.changeset/gstr3b-gstr1-tables.md` with `"@india-gst-kit/gstr3b": minor`: "Derive 3.1 (a)–(c), (e) and 3.2 contributions from GSTR-1 Tables 4C, 5B, 8, 9A, 9C and 10, and optionally Table 11 (`confirmAdvanceMapping`); `notCovered` shrinks accordingly."
  - `packages/fixtures` (private) gains the synthetic `etin` and the new fixtures.
  - The §17.18 rows are added to `docs/legal-facts.md`, and the CLAUDE.md `gstr1` layout line is updated ("Track A/A2: GSTR-1 builder").

### 17.20 Stop conditions (build session)

- S5 or S4 contradicts this section somewhere not listed in §17.15 → follow the source and report.
- A G-row marked **proposal**, or the advance mapping, would have to become default-on or enforced without F3/FA-1 → stop.
- A Table 14/15 value, a `flag`, or a `nil` code would have to be defaulted rather than taken from the caller → stop.
- `pnpm check` cannot go green without weakening strictness or lint rules → stop.
