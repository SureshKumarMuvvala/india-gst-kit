# Spec — `@india-gst-kit/gstr1` (v0.1)

Status: **draft for review** (2026-10-16). Every legal/official fact referenced here is **UNVERIFIED — needs CA** until a chartered accountant signs it off in `docs/legal-facts.md`.

Sources (all under `sources/gstr1/`, see its README for URLs and SHA-256):
- **T** = the official GST Offline Tool, release 3.2.4. Its code is summarised in `offline-tool/code-excerpts.md`, cited as "T §n". Its data files are in `offline-tool/data/` and its CSV templates in `offline-tool/csv/`.
- **H** = the "Help Instruction" sheet of Excel template V2.2 (`excel-template-v2.2-help-excerpt.txt`), cited by Excel row, e.g. "H r48". **M** = the template's master sheet.
- **F** = GSTN's troubleshooting guide and the tool's FAQ (`portal-faq-excerpts.txt`).
- **S** = the GSTN API schema "GSTR1 – Save GSTR1 data v1.1". **Not captured** (bot challenge; see `sources/gstr1/README.md`). F names S as the schema the portal validates uploads against.

**Every JSON key, type and shape below is "pending S".** It comes from what T writes. When S is attached, S wins, and any difference is reported in §11.

## 1. Purpose and scope

`buildGstr1()` takes the supplier's validated `GstDocument`s (`@india-gst-kit/model`) and returns the GSTR-1 JSON for one monthly return period, in the form the portal accepts for upload ("Prepare offline → Upload").

- **In scope (v0.1).** The header plus these sections:
  - `b2b` (Tables 4A, 4B, 6B, 6C)
  - `b2cl` (5)
  - `b2cs` (7)
  - `cdnr` (9B registered)
  - `cdnur` (9B unregistered)
  - `exp` (6A)
  - `hsn` (12)
  - `doc_issue` (13)

  Table numbers are from `offline-tool/data/uploadtablename.json`. The package also covers classification of each document into a section, aggregation, structural validation of its own output, and serialisation.
- **Out of scope / deferred (§12):**
  - amendment sections (`b2ba`, `b2cla`, `b2csa`, `cdnra`, `cdnura`, `expa`)
  - advances (`at`, `atadj`, `txpd`)
  - `nil` (Table 8)
  - e-commerce sections (`ecom`, `supeco`, Tables 14/15)
  - quarterly/IFF filers
  - `gt`/`cur_gt` (FY 2017-18 only)
  - splitting files above the size limit
  - uploading/HTTP (package `gsp`)
  - deciding taxability or rates (the model's rule applies)
- ESM only, named exports, Zod 4 (peer `^4.0.0`), `decimal.js`, `@india-gst-kit/model` (`workspace:^`). Types are `z.infer`. Objects are `z.strictObject`.

## 2. API

```ts
export function buildGstr1(input: Gstr1Input): Gstr1Result;
export function serializeGstr1(json: Gstr1Json): string;      // compact JSON, numbers as raw literals
export function parseGstr1Json(text: string): z.ZodSafeParseResult<Gstr1Json>; // round-trip / validate others' files
export function classifyDocument(doc: GstDocument, ctx: ClassifyContext): Classification; // pure; exposed for tests and UIs
export function b2clThreshold(fp: ReturnPeriod): Money;        // "250000.00" | "100000.00"
export const Gstr1Schema;                                      // Zod schema of the output (§4)

type Gstr1Input = {
  gstin: Gstin;                       // the filer = supplier.gstin of every document
  period: ReturnPeriod;               // "MMYYYY", e.g. "102026"
  documents: readonly GstDocument[];  // already passed parseGstDocument
  options?: {
    originalInvoices?: readonly GstDocument[]; // earlier-period invoices, to classify notes to unregistered persons (§3.3)
    aatoAbove5Cr?: boolean;                    // HSN minimum 6 digits instead of 4 (§5.2); default false
    docIssue?: readonly DocIssueSeries[];      // overrides derivation of doc_issue (§5.3)
    version?: string;                          // header "version"; default "GST3.2.4" (T §2)
  };
};
type Gstr1Result =
  | { ok: true; value: Gstr1Json; classification: readonly { number: string; kind: DocumentKind; section: Section }[] }
  | { ok: false; issues: readonly Gstr1Issue[] };
type Gstr1Issue = { code: Gstr1IssueCode; message: string; documentNumber?: string; path?: (string | number)[] };
```

- `ReturnPeriod` = `/^(0[1-9]|1[0-2])\d{4}$/`. The builder supports periods from `052021`, the first period with the current HSN row shape (T §3 hsn). Earlier periods give `PERIOD_NOT_SUPPORTED`.
- `buildGstr1` never throws on data problems. It collects **all** issues. It runs `Gstr1Schema` on its own output, so `ok: true` means the output passed the schema.

## 3. Classification (document → section)

Rules are taken only from T and H. Inputs:
- `S` = `supplier.stateCode`, which the model guarantees equals the first two digits of `supplier.gstin`
- `P` = `placeOfSupply`
- `cat` = `supplyCategory`
- `val` = `totals.grandTotal`

T compares POS with the first two digits of the filer's GSTIN (T §3 b2cs, §4).

### 3.1 Preconditions (each failure is an issue, and the document is not placed)

| Code | Rule | Source |
|---|---|---|
| `SUPPLIER_MISMATCH` | `doc.supplier.gstin === input.gstin` | the return is per GSTIN (header `gstin`, T §2) |
| `DATE_OUT_OF_RANGE` | `2017-07-01 ≤ doc.date ≤` last day of `period`. Earlier-period documents **are** allowed: T accepts any date up to the end of the period | T §4 (`validateDate`) |
| `DUPLICATE_DOCUMENT` | no two documents with the same `kind` group (invoice / note) and `number` | H r378 ("Duplication of invoices … System throws error"); H r401 (a later upload overwrites) |
| `UNSUPPORTED_SUPPLIER` | `supplier.registrationType` ∉ {`SEZ_UNIT`, `SEZ_DEVELOPER`, `COMPOSITION`}. SEZ suppliers change T's rules (always IGST; B2CL state check skipped, T §3 b2cl, §4); composition: see Q6 | T; Q6 |
| `UNSUPPORTED_DOCUMENT` | `kind !== "BILL_OF_SUPPLY"`. Bills of supply belong in `nil` (Table 8), deferred; see Q5 | H r233–237 |
| `RATE_NOT_ACCEPTED` | every line `gstRate` is in the GSTR-1 rate list `0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40`, compared numerically | T §4; `data/rate.json` `CommGST` |
| `REVERSE_CHARGE_B2C` | `reverseCharge` only when the document goes to `b2b`/`cdnr`. `b2cl`, `b2cs` and `cdnur` have no `rchrg` field | T §3 |
| `RECIPIENT_GSTIN_FORMAT` | for `b2b`/`cdnr`: `recipient.gstin` matches one of T's recipient patterns (regular GSTIN, UIN, TDS, NRTP) **and** the mod-36 check character. The model's own check (loose pattern + mod-36) is weaker | T §4 (`returnStructure.js:330-414`) |

### 3.2 Tax invoices (`kind = TAX_INVOICE`)

The first rule that matches wins.

| # | Condition | Section | Fields | Source |
|---|---|---|---|---|
| I1 | `cat ∈ {EXPORT_WITH_PAYMENT, EXPORT_WITHOUT_PAYMENT}` | `exp`, `exp_typ` = `WPAY` / `WOPAY` | no POS, no recipient | H r143–144; T §3 exp |
| I2 | `recipient.gstin` present | `b2b`, `inv_typ` from `cat`: `DOMESTIC→R`, `DEEMED_EXPORT→DE`, `SEZ_WITH_PAYMENT→SEWP`, `SEZ_WITHOUT_PAYMENT→SEWOP` | `ctin = recipient.gstin`, `pos = P`, `rchrg = Y/N` | H r18 ("taxable supplies made to other registered taxpayers"); `data/invtypesforb2b.json` |
| I3 | no GSTIN, `cat = DOMESTIC`, `P ≠ S`, `val > b2clThreshold(period)` | `b2cl`, grouped by `pos` | | H r48 ("place of supply is outside the state … more than INR100000 from August 2024 return period … INR 250000 upto July 2024"); T §3 b2cl (strictly greater) |
| I4 | no GSTIN, `cat = DOMESTIC`, otherwise (intra-state of any value, or inter-state ≤ threshold) | `b2cs` row, `sply_ty` = `INTRA` if `P = S` else `INTER`, `typ = "OE"` | | H r70; T §3 b2cs |
| I5 | no GSTIN and `cat` ∈ {`SEZ_*`, `DEEMED_EXPORT`} | issue `CATEGORY_NEEDS_GSTIN` | | SEZ/DE exist only as b2b invoice types (`invtypesforb2b.json`) |

- `b2clThreshold(fp)` is `250000.00` for fp before `082024` and `100000.00` from `082024` (T §3 b2cl; `constants.js`). It is compared with the invoice's **own** return period. The return period, not the invoice date, decides; see Q3 for late-reported invoices.
- POS `96` with no GSTIN and `cat = DOMESTIC` is a supply to an overseas recipient that is not an export: issue `POS_96_NOT_EXPORT` (Q7).

### 3.3 Credit and debit notes (`kind ∈ {CREDIT_NOTE, DEBIT_NOTE}`)

`ntty` = `C` / `D`. H r89 and r119 say a note is reported "based on original invoice". Notes therefore follow the **original invoice's** section. The original is looked up by `originalDocument.number` + `.date`, first in `documents`, then in `options.originalInvoices`.

| # | Condition | Section | Source |
|---|---|---|---|
| N1 | `cat` export | `cdnur`, `typ = EXPWP / EXPWOP`, no `pos` | H r119; T §3 cdnur |
| N2 | `recipient.gstin` present | `cdnr`, grouped by `ctin`; `inv_typ` as I2; `pos = P`, `rchrg` | H r89; T §3 cdnr |
| N3 | no GSTIN, and the original invoice classifies as `b2cl` (I3, using the **original's** period) | `cdnur`, `typ = B2CL`, `pos = P` | H r119 ("against interstate invoice value is more than Rs 1.0 lakh"); T §3 cdnur |
| N4 | no GSTIN, and the original classifies as `b2cs` | **netted into the `b2cs` row** (credit note negative, debit note positive) | b2cs amounts may be negative (T §3 b2cs; `csv/b2cs.csv` sample `-500000`). See Q2: the sources show negative b2cs values but do not say in words that B2CS notes go there |
| N5 | no GSTIN, and the original is not found | issue `ORIGINAL_NOT_FOUND` | can't decide N3 vs N4 |

- A note's `P` must equal the original's `pos` ("Declare the place of supply based on the original document", H r95, r124). If it differs: issue `NOTE_POS_MISMATCH`, raised only when the original is available.
- **Signs.** In `cdnr`/`cdnur` all amounts are positive; direction is carried only by `ntty` (T §3 cdnr). In `b2cs` (N4) and `hsn` (§5.2), credit notes are subtracted.

## 4. Output JSON (pending S)

Values that are amounts, rates or quantities are JSON **numbers**. In memory they are strings, as everywhere in this repo, and `serializeGstr1` writes them as raw number literals. Money is written with 2 dp (`1000.00`); T writes `1000` (Deviation D2). Codes, numbers and dates are strings. Dates are `DD-MM-YYYY`. Empty sections and absent optional keys are **omitted**, never `null` or `[]`, matching T's `omitEmpty` (T §1).

```jsonc
{
  "gstin": "<filer>", "fp": "MMYYYY", "version": "GST3.2.4", "hash": "hash",
  "b2b":  [ { "ctin": "…", "inv": [ { "inum": "…", "idt": "DD-MM-YYYY", "val": 0.00, "pos": "NN", "rchrg": "N",
              "inv_typ": "R", "itms": [ { "num": 1801, "itm_det": { "txval": 0.00, "rt": 18, "camt": 0.00, "samt": 0.00, "csamt": 0.00 } } ] } ] } ],
  "b2cl": [ { "pos": "NN", "inv": [ { "inum", "idt", "val", "itms": [ { "num", "itm_det": { "txval", "rt", "iamt", "csamt" } } ] } ] } ],
  "b2cs": [ { "sply_ty": "INTRA|INTER", "rt": 5, "typ": "OE", "pos": "NN", "txval", "iamt" | "camt"+"samt", "csamt" } ],
  "exp":  [ { "exp_typ": "WPAY|WOPAY", "inv": [ { "inum", "idt", "val", "itms": [ { "txval", "rt", "iamt", "csamt" } ] } ] } ],
  "cdnr": [ { "ctin": "…", "nt": [ { "nt_num", "nt_dt", "ntty": "C|D", "val", "pos", "rchrg", "inv_typ", "itms": [ { "num", "itm_det": {…} } ] } ] } ],
  "cdnur":[ { "nt_num", "nt_dt", "ntty", "val", "typ": "B2CL|EXPWP|EXPWOP", "pos"?, "itms": [ { "num", "itm_det": { "txval", "rt", "iamt", "csamt" } } ] } ],
  "doc_issue": { "doc_det": [ { "doc_num": 1, "doc_typ": "Invoices for outward supply", "docs": [ { "num": 1, "from", "to", "totnum", "cancel", "net_issue" } ] } ] },
  "hsn":  { "hsn_b2b": [ HsnRow ], "hsn_b2c": [ HsnRow ] }          // fp ≥ 052025; before that: { "data": [ HsnRow ] }
}
// HsnRow = { "num", "hsn_sc", "uqc", "qty", "rt", "txval", "iamt", "camt", "samt", "csamt" }
```

- **Key order** follows T's template (T §2): `gstin, fp, version, hash, b2b, b2cl, b2cs, exp, cdnr, cdnur, doc_issue, hsn`.
- **`gt` / `cur_gt`** are not emitted. T asks for them only for FY 2017-18.
- **Header.** `version` defaults to T's literal `"GST3.2.4"` and `hash` is the literal `"hash"` (T §2). What the portal requires here is Q4.
- **Invoice-level fields:**
  - `inum` / `nt_num` = `number`.
  - `idt` / `nt_dt` = `date` re-formatted.
  - `val` = `totals.grandTotal`, the "total value indicated in the invoice" (H r23).
  - `pos` = `placeOfSupply`, 2 digits.
  - `etin`, `diff_percent` and the `CBW` type are never emitted, because the model has no data for them (§12).
- **Items** (`b2b`, `b2cl`, `cdnr`, `cdnur`) are one per distinct rate in the document. H r388 ("Taxable Value, Rate and cess … may be different in the same invoice") and T key items by rate.
  - `num = rt × 100 + 1` (T §3 b2b, `returnStructure.js:3020`). Example: 18 → `1801`, 0.25 → `26`, 0 → `1`.
  - `txval = Σ taxableValue`, `iamt = Σ igst`, `camt = Σ cgst`, `samt = Σ sgst`, `csamt = Σ cess` over the lines at that rate.
  - Inter-state items carry `iamt` and no `camt`/`samt`; intra-state items carry `camt` + `samt` and no `iamt`. The split is the model's (`decideTaxSplit`), which matches T's rule: intra only for R/DE with POS = supplier state; SEZ and exports always inter (T §4).
  - `samt` holds SGST **or UTGST** ("State/UT Tax Amount", H r248).
- **`exp` items** have no `num` and no `itm_det` (T §3 exp). For `WOPAY` / `SEWOP` / `EXPWOP`, `iamt` and `csamt` are `0.00`. The model already forces zero tax on `*_WITHOUT_PAYMENT`, and T forces it too.
- **`rt`** is the model's `gstRate` as a number literal with trailing zeros removed (`"18.000"` → `18`).
- **`b2cs` rows** are keyed by (`sply_ty`, `pos`, `rt`, `typ`) and amounts are summed. A row whose amounts sum to zero after netting is still emitted. Row order: by `pos`, then `rt`.
- **Order** of groups and documents: input order of first appearance, so output is deterministic for the same input.

### 4.1 Size

If `serializeGstr1(value)` is longer than `4.7 × 1024 × 1024` bytes (UTF-8), the builder returns issue `FILE_TOO_LARGE`. That is T's chunking threshold (T §1); the portal limit is 5 MB (F, FAQ 43). Splitting is deferred.

## 5. Summary sections

### 5.1 Common
`hsn` and `doc_issue` are built from **all** documents placed in §3. The rows below define how.

### 5.2 `hsn` (Table 12)
- **Shape.** For fp ≥ `052025`: `hsn_b2b` + `hsn_b2c`. For fp from `052021` to `042025`: `data` (T §2; release note 3.2.2; H r404).
- **Split.** No source states which documents feed which table: T leaves it to the user (T §3 hsn), and H r238/r250 says only "HSN Summary of B2B / B2C Supplies".
  - **Proposed:** documents placed in `b2b`/`cdnr` feed `hsn_b2b`; documents in `b2cl`, `b2cs`, `cdnur` and `exp` feed `hsn_b2c`.
  - This is **Q1**. It needs CA confirmation before implementation.
- **Rows.**
  - Key: (`hsn_sc` = line `hsnSac`, `rt`, `uqc`).
  - `uqc` = the line's `unit`, or `"NA"` for services (`isService` / HSN `99…`), with `qty = 0` (T §3 hsn; H r241–242).
  - `qty` = Σ quantity. `txval`/`iamt`/`camt`/`samt`/`csamt` = Σ of the line values.
  - `num` = 1..n after sorting by (`hsn_sc`, `rt`, `uqc`).
  - Credit-note lines subtract; debit-note lines add. H's HSN amount fields allow negatives (T §4). This is **Q2**.
  - `desc`/`user_desc` are omitted: "Description is optional for period May'21 and onwards" (H r240).
- **Checks:**
  - `HSN_LENGTH`: if `aatoAbove5Cr`, `hsnSac` needs ≥ 6 digits; otherwise ≥ 4. The model already restricts it to 4/6/8 (T §3 hsn; H r239).
  - `QTY_PRECISION`: H r242 says "up to 2 decimal Digits", but the model allows 3. An aggregated `qty` with a non-zero 3rd decimal is an issue (Q8).
  - Not checked: membership of T's HSN master (`HSN.json`, 2.7 MB). Deferred; the portal checks it.

### 5.3 `doc_issue` (Table 13)
- `doc_num` / `doc_typ` come from T's list (T §3 doc_issue): `TAX_INVOICE` → 1 "Invoices for outward supply", `DEBIT_NOTE` → 4 "Debit Note", `CREDIT_NOTE` → 5 "Credit Note".
- **Derivation (default).** One series per `doc_num`, using only documents **dated within** the period.
  - `from` / `to` = the numbers of the first and last document, ordered by (`date`, input order).
  - `totnum` = count, `cancel` = 0, `net_issue = totnum − cancel`.
  - The model has no "cancelled" concept, and gaps or several series cannot be inferred. **Q9.**
- **Override.** `options.docIssue` supplies the series explicitly as `{ docNum, from, to, totnum, cancel }`. Checks: `from`/`to` match T's pattern; `totnum ≥ cancel` (T §3 doc_issue).
- `doc_typ` is emitted because T's file carries it (**[infer]** from T; pending S).

## 6. Numbers and rounding
- No arithmetic is redone. Every amount is a sum of the model's already-validated line amounts (decimal.js). The model's split conventions and half-up rounding (model spec §7, §8.3) carry through.
- T **recomputes** tax per item as `round(txval × rt / 100)` and halves (T §4). Our per-rate sums can differ from that by a few paise when an invoice has many lines at one rate. We keep the invoice's own figures (Deviation D1, Q10).

## 7. Exports
`buildGstr1`, `classifyDocument`, `b2clThreshold`, `serializeGstr1`, `parseGstr1Json`, `Gstr1Schema` and section sub-schemas, the types (`Gstr1Json`, `Gstr1Input`, `Gstr1Issue`, `Section`, `ReturnPeriod`, `DocIssueSeries`), and the constants `GSTR1_RATES` and `DOC_ISSUE_TYPES`. Each constant is in its own file with the `// Source / Retrieved / Status` header.

## 8. Issue codes
`SUPPLIER_MISMATCH`, `DATE_OUT_OF_RANGE`, `DUPLICATE_DOCUMENT`, `UNSUPPORTED_SUPPLIER`, `UNSUPPORTED_DOCUMENT`, `RATE_NOT_ACCEPTED`, `REVERSE_CHARGE_B2C`, `RECIPIENT_GSTIN_FORMAT`, `CATEGORY_NEEDS_GSTIN`, `POS_96_NOT_EXPORT`, `ORIGINAL_NOT_FOUND`, `NOTE_POS_MISMATCH`, `HSN_LENGTH`, `QTY_PRECISION`, `DOC_ISSUE_INVALID`, `PERIOD_NOT_SUPPORTED`, `FILE_TOO_LARGE`, `SCHEMA` (own-output failure; a bug).

## 9. Test list (Vitest; written first)

Fixtures: synthetic documents built with the GSTINs registered in `packages/fixtures/src/gstins.ts` only.

**period / threshold**
- `b2clThreshold("072024") = 250000.00`; `("082024") = 100000.00`; `("012025") = 100000.00`; `("122023") = 250000.00`. The year is compared before the month: `"092023"` < `"082024"`.
- Invalid fp `"132024"`, `"0824"` → schema error. fp `"042021"` → `PERIOD_NOT_SUPPORTED`.

**classification — invoices**
- Registered recipient: DOMESTIC → b2b/`R`; DEEMED_EXPORT → `DE`; SEZ_WITH_PAYMENT → `SEWP`; SEZ_WITHOUT_PAYMENT → `SEWOP` with zero `iamt`/`csamt`.
- Unregistered, inter-state:
  - fp 102026, val `100000.01` → b2cl
  - val `100000.00` → b2cs INTER (boundary: strictly greater)
  - fp 072024, val `250000.00` → b2cs; `250000.01` → b2cl
  - fp 072024, val `150000.00` → b2cs; same invoice in fp 082024 → b2cl
- Unregistered intra-state, val `5000000.00` → b2cs INTRA (any value).
- Export with/without payment → exp `WPAY` / `WOPAY`; no `pos`; WOPAY amounts `0.00`.
- SEZ category with an unregistered recipient → `CATEGORY_NEEDS_GSTIN`.
- Unregistered, POS 96, DOMESTIC → `POS_96_NOT_EXPORT`.
- Bill of supply → `UNSUPPORTED_DOCUMENT`.
- Composition or SEZ supplier → `UNSUPPORTED_SUPPLIER`.
- Reverse charge to an unregistered recipient → `REVERSE_CHARGE_B2C`.
- `gstRate "0.5"` → `RATE_NOT_ACCEPTED`. `"18.000"` is accepted and emitted as `18`; `"40"` is accepted.

**classification — notes**
- Credit note to a registered recipient → cdnr with `ntty "C"` and positive amounts.
- Debit note → `ntty "D"`.
- Note on an export → cdnur `EXPWP`/`EXPWOP` without `pos`.
- Unregistered recipient:
  - original b2cl invoice in `documents` → cdnur `B2CL` with `pos`
  - original in `options.originalInvoices` from an earlier period → classified with **that** period's threshold
  - original b2cs → b2cs row reduced (credit) / increased (debit)
  - original missing → `ORIGINAL_NOT_FOUND`
- Note POS different from the original's → `NOTE_POS_MISMATCH`.

**preconditions**
- Another supplier's document → `SUPPLIER_MISMATCH`.
- Date `2017-06-30` → `DATE_OUT_OF_RANGE`. A date after the period end → `DATE_OUT_OF_RANGE`. An earlier-period date inside the range is accepted.
- Two invoices with the same number → `DUPLICATE_DOCUMENT`. An invoice and a credit note sharing a number are allowed.
- Recipient GSTIN that passes the model but not T's PAN-structured pattern (synthetic) → `RECIPIENT_GSTIN_FORMAT`.
- All issues are collected (a document with 3 problems → 3 issues), not first-fail.

**items / aggregation**
- An invoice with 3 lines at 18 % and 1 at 5 % → 2 items `num` 1801 and 501 with summed values. Rate 0.25 → `num` 26; rate 0 → `num` 1.
- Intra item has `camt`/`samt` and no `iamt`; inter item has `iamt` only.
- UT place of supply → `samt` carries the UTGST amount.
- `val` equals `grandTotal`, including `roundOff` and `otherCharges`.
- b2cs: two invoices with the same pos and rate → one row with summed amounts; different `rt` → two rows.
- Odd-paisa line amounts sum exactly (no re-rounding); case from model spec §10 (`100.10` @ 5 %).

**hsn**
- fp 102026 → `hsn_b2b`/`hsn_b2c` (Q1 rule); fp 042025 → `data`.
- Same HSN, rate and uqc across documents → one row. Same HSN with a different rate → two rows.
- A service line → `uqc "NA"`, `qty 0`.
- Credit-note lines subtract.
- `num` is 1..n in sorted order.
- `aatoAbove5Cr` with a 4-digit HSN → `HSN_LENGTH`.
- Aggregated qty `1.005` → `QTY_PRECISION`.

**doc_issue**
- Derived series per kind: from/to/totnum/net_issue. Documents dated before the period are not counted.
- Override replaces the derivation. `cancel > totnum` → `DOC_ISSUE_INVALID`.

**output / serialisation**
- Key order as §4. Empty sections are omitted. No `null` anywhere. Dates are `DD-MM-YYYY`.
- `serializeGstr1` writes `1000.00` as a number literal. `99999999999.99` survives byte-exact (`parseGstr1Json` round-trip with the `context.source` reviver, as in `einvoice`).
- `Gstr1Schema` rejects unknown keys.
- An empty `documents` list → header only.
- `FILE_TOO_LARGE` at the 4.7 MiB boundary (generated synthetic input).
- **Golden test:** a mixed synthetic period (b2b intra + inter, SEZ, b2cl, b2cs, export, cdnr, cdnur B2CL, b2cs credit note) equals a committed expected JSON. **Once S is attached**, the same output also validates against S with a JSON-Schema validator (dev dependency).

**api surface** — no default exports.

## 10. Stop conditions (build session)
- S attached and it contradicts §4 → follow S and report under §11.
- Any Q marked **blocking** in §13 unanswered → build everything else, and leave that rule throwing `NOT_IMPLEMENTED`-style issues rather than guessing.
- A real GSTIN or company name would need to appear in fixtures or sources → stop. The official CSV samples were redacted for this reason (`sources/gstr1/README.md`).
- `pnpm check` can't be made green without weakening strictness or lint rules → stop and report.

## 11. Deviations from the sources (intentional)

| # | What | T / H says | We do | Why |
|---|---|---|---|---|
| D1 | Item tax amounts | T recomputes `txval × rt` per item, `toFixed(2)` | sum of the invoice's own line amounts | the invoice is the legal record; T's figures are editable defaults (T §4: "user can edit") — Q10 |
| D2 | Number formatting | `parseFloat` → `1000`, `12.5` | always 2 dp for money (`1000.00`) | exact decimals; numerically equal JSON |
| D3 | Rounding | T's `cnvt2Nm` is binary `toFixed(2)` (1.005 → 1.00) | decimal half-up (model) | repo rule; affects only recomputation, which we don't do |
| D4 | `etin`, `diff_percent` (65 %), `CBW` | supported | never emitted | the model has no fields for them (§12) |
| D5 | `doc_issue` series | user-entered | derived by default (§5.3) | convenience; override available |

The model spec has none of its rules contradicted by these sources. One is tightened: the GSTR-1 rate list (§3.1), which the model deliberately does not enforce.

## 12. Deferred
- Amendment sections; `at`/`atadj`; `nil` (Table 8, including bills of supply); e-commerce (`etin`, `ecom`, `supeco`, Tables 14/15).
- 65 % rate (`diff_percent`); `CBW`.
- Export details: `sbpcode`, `sbnum`, `sbdt`. The model has no port code or shipping bill (model spec §12); T makes them optional and allows them "later" (H r148–149).
- Quarterly/IFF (T keeps only `b2b`, `b2ba`, `cdnr`, `cdnra`, `ecom`, `ecoma` in months 1–2).
- File splitting; HSN master check; SEZ and composition suppliers; FY 2017-18 `gt`/`cur_gt`.
- Excluding e-invoiced documents that the portal auto-populates (T release 2.4.2) — Q11.

## 13. Open questions (for owner / CA)

1. **(blocking for `hsn` only)** HSN B2B/B2C split: is "recipient has a GSTIN → `hsn_b2b`, everything else (including exports and unregistered notes) → `hsn_b2c`" correct? No source states the rule.
2. **(blocking for N4)** Credit/debit notes to unregistered persons where the original was B2C-small: are they netted into `b2cs` (negative values allowed, as the tool's sample suggests)? And does HSN also net credit notes?
3. B2CL threshold for **late-reported** invoices: does the return period or the invoice date decide (e.g. a July 2024 invoice of ₹1.5 lakh reported in the October 2024 return)? T uses the return period. Same question for a note's original invoice.
4. Header: does the portal require `version` (T: `"GST3.2.4"`) and `hash` (T: `"hash"`)? What do they mean? S should answer.
5. Bills of supply: Table 8 (`nil`) needs nil-rated / exempt / non-GST split that the model can't tell apart. Should v0.1 reject them (current spec), or should the model gain a field? Should they count in `doc_issue` row 1?
6. No captured source says whether composition suppliers file GSTR-1. The spec rejects them (`UNSUPPORTED_SUPPLIER`) — confirm.
7. Supplies to overseas recipients that are not exports (POS 96, DOMESTIC) — which section, if any?
8. HSN quantity: H says up to 2 decimals; the model allows 3. Reject (current spec), or round?
9. `doc_issue`: should the model track cancelled documents, and should several series per kind be inferred from number prefixes?
10. D1: is it acceptable that item tax amounts are the invoice's own sums rather than `txval × rt` recomputed? Does the portal tolerate small differences (the e-invoice portal allows ±₹1)?
11. Should documents already reported through e-invoice (auto-populated into GSTR-1) be excluded or included in the upload?
12. **Source S**: attach "GSTR1 – Save GSTR1 data v1.1" (Request Payload → Download Schema) and any sample payload. Until then every shape here is pending.

## 14. `docs/legal-facts.md` rows to add (at build time)

| Fact | File |
|---|---|
| GSTR-1 rate list `0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40` | `packages/gstr1/src/rates.ts` |
| B2CL limit: > ₹2,50,000 up to fp 07-2024; > ₹1,00,000 from fp 08-2024; inter-state only | `packages/gstr1/src/classify.ts` |
| B2CS: unregistered intra-state of any value, or inter-state ≤ limit | `classify.ts` |
| Invoice types R/DE/SEWP/SEWOP(/CBW) and the SEZ/export = IGST rule | `classify.ts` |
| CDNUR types B2CL/EXPWP/EXPWOP; notes follow the original invoice | `classify.ts` |
| Doc-issue document types (12) and numbering | `packages/gstr1/src/doc-issue.ts` |
| HSN: 6 digits if AATO > ₹5 Cr else 4; B2B/B2C split from fp 05-2025; services `uqc NA` | `packages/gstr1/src/hsn.ts` |
| Document dates 01-07-2017 … end of return period | `build.ts` |
| Upload size: 5 MB portal limit (T splits at 4.7 MiB) | `serialize.ts` |
| Recipient GSTIN patterns + mod-36 as implemented by the offline tool | `packages/gstr1/src/recipient.ts` |

Each row: source `sources/gstr1/…`, retrieved 2026-10-16, UNVERIFIED — needs CA.
