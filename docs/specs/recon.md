# Spec — `@india-gst-kit/recon` (v0.1)

Status: **draft for review**, 2026-10-16. Product decisions D-P1 to D-P4 (§13) were approved on 2026-10-16. The CA questions (§12) are still open, and v0.1 uses the defaults stated there.

Every legal or official fact here is **UNVERIFIED — needs CA** until it is signed off in `docs/legal-facts.md`.

Source **H** = `sources/recon/gstr2b-get-all-details-v4.5-response-schema.json`. It is authoritative: GSTR-2B "Get All Details" response schema v4.5, **Draft**, published 20-07-2026 on https://developer.gst.gov.in/apiportal/taxpayer/returns, downloaded by hand 2026-10-16. Provenance and the v4.4 → v4.5 changes are in `sources/recon/README.md`. Where source H contradicts this spec, **source H wins** (§11).

## 1. Purpose and scope
**In scope**
- `parseGstr2bJson(text)` parses a GSTR-2B Get-All-Details response (v4.5) into typed records. Money is kept as exact strings.
- `reconcile(register, gstr2b, options?)` compares our purchase register with one or more parsed 2B files and classifies every document. The register is `GstDocument[]` from `@india-gst-kit/model`, with us as the recipient.

**Out of scope**
- **Deciding ITC eligibility.** The package reports what 2B says (`itcavl`, `rsn`, `diffprcnt`, `imsStatus`, …) next to what our register says. It never computes "eligible", "claimable" or an ITC amount.
- Fetching 2B (package `gsp`), IMS actions, GSTR-3B.
- Typing any section other than B2B, B2BA, CDNR and CDNRA. `isd`, `isda`, `impg`, `impgsez`, `ecom`, `ecoma` and the summaries `itcsumm`, `cpsumm`, `cpSummRej` are kept in `raw` but not typed (§10).

**Conventions:** ESM, named exports, Zod 4 (peer `^4.0.0`), `decimal.js`, and `@india-gst-kit/model` (`workspace:^`). Types are `z.infer`. Objects use `z.strictObject`; §3.3 (5) explains how unknown keys become warnings.

## 2. Numbers, dates, JSON
- Source H types money as JSON **numbers**. `val` and `amts` have `multipleOf 0.01` and a maximum of `9999999999999.99`, which is 15 significant digits. In memory they are **strings**.
- `parseGstr2bJson` parses losslessly with the shared helper from `@india-gst-kit/model` (decision D-P1). The helper uses `JSON.parse` with the reviver `context.source` (Node ≥ 22), so every number becomes its source text. A JSON string where a number is expected is a type error, and so is the reverse.
- `Gstr2bMoney` = `/^-?\d{1,13}(\.\d{1,2})?$/`. Source H gives a maximum but **no minimum** for `val`, so a sign is accepted structurally (§11 D4). Output money is normalised to exactly 2 dp: `"1180"` → `"1180.00"`.
- Other number fields:
  - `rt` (rate): 0–999.9, at most 2 dp.
  - `num` (item number): a JSON number, kept as a digit string.
  - `diffprcnt`: enum `0.65 | 1`, kept as `"0.65" | "1"`.
- Dates are `DD-MM-YYYY` (`definitions/date`) and become `IsoDate` `YYYY-MM-DD`. A real-calendar check replaces the source's lookahead regex (it accepts the same dates).
- Periods are `MMYYYY` (`definitions/prd`). They are kept as-is and also exposed as `{ month, year }`.

## 3. Parsing (`src/schema.ts`, `src/parse.ts`)
### 3.1 Sections typed
| Origin | Section | Document array | Record |
|---|---|---|---|
| `docdata` | `b2b` | `inv[]` | invoice |
| `docdata` | `b2ba` | `inv[]` | amended invoice (`oinum`, `oidt`) |
| `docdata` | `cdnr` | `nt[]` | credit/debit note (`typ` C/D) |
| `docdata` | `cdnra` | `nt[]` | amended note (`onttyp`, `ontnum`, `ontdt`) |
| `docRejdata` | the same four | same | as above; documents with **IMS-rejected** origin |
| `docdata.itcrev` | the same four | same | as above; **ITC-reversal** origin (§3.3 (3), §12 Q-CA3) |

Each section schema is a Zod transcription of every constraint in source H for that section: required sets, patterns, enums, min and max. A conformance test checks it (§9), as in `einvoice` §4.

### 3.2 Normalised record (`Gstr2bRecordSchema`)
```ts
{
  origin: "docdata" | "docRejdata" | "itcrev";
  section: "b2b" | "b2ba" | "cdnr" | "cdnra";
  returnPeriod: string;              // data.rtnprd, MMYYYY
  recipientGstin: string;            // data.gstin, upper-cased
  supplier: {                        // ctin (upper-cased), trdnm, supfildt, supprd
    gstin: string; tradeName?: string; filingDate: IsoDate; filingPeriod: string;
  };
  documentType: "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";
                                     // b2b/b2ba → INVOICE; note typ C → CREDIT_NOTE, D → DEBIT_NOTE (Q-CA7)
  number: string;                    // inum / ntnum, as published
  date: IsoDate;                     // dt
  original?: { number: string; date: IsoDate; noteType?: "C" | "D" };
                                     // b2ba oinum/oidt; cdnra ontnum/ontdt/onttyp
  supplyType?: string;               // invoice typ / note suptyp: RAW code, never mapped (Q-CA1)
  placeOfSupply?: string;            // pos (optional in cdnr/cdnra)
  reverseCharge?: "Y" | "N";         // rev (optional in cdnr/cdnra)
  amounts: { value: Money; taxableValue: Money; igst: Money; cgst: Money; sgst: Money; cess: Money };
  amountsSource: "document" | "items";   // §3.4
  items: {
    num: string; rate: string; taxableValue: Money;
    igst?: Money; cgst?: Money; sgst?: Money; cess?: Money;
  }[];
  itc: {                             // verbatim from 2B, never interpreted
    itcavl: "Y" | "N" | "T"; rsn?: string; diffprcnt?: "0.65" | "1";
    imsStatus?: "A" | "R" | "N"; itcRedReq?: "Y" | "N";
    declIgst?: Money; declCgst?: Money; declSgst?: Money; declCess?: Money;
    remarks?: string; isITCRevAmd?: "Y";
  };
  path: (string | number)[];         // JSON path in the source, e.g. ["data","docdata","b2b",0,"inv",2]
}
```
The parsed file has the shape `Gstr2b = { gstin, returnPeriod, version, generatedOn: IsoDate, fileCount?: string, records: Gstr2bRecord[] }`.

### 3.3 Source quirks
Each quirk is normalised and cited in a code comment.
1. **GSTIN patterns.** `ctin` and `gstin` are **unanchored**, but `minLength = maxLength = 15`, which makes them equivalent to anchored patterns. They allow **lower case**. Values are upper-cased in records; `raw` keeps them as published.
2. **Non-resident GSTINs.** `ctin` has a second, non-resident alternative: `[0-9]{4}[a-zA-Z]{3}[0-9]{5}NR[0-9a-zA-Z]`. The model's `GstinSchema` cannot accept these. 2B GSTINs are therefore validated against source H's patterns only. If the model's check digit fails, the result is an **info** issue `CTIN_CHECK_DIGIT`, never an error.
3. **`itcrev` wrapper.** `docdata.itcrev` has no `type`/`properties` wrapper: its `b2b`, `b2ba`, `cdnr` and `cdnra` keys sit directly on the node, so a draft-07 validator ignores them. We read them as the intended section shapes. These match `docdata.*` except that `itcrev.b2b` has `anyof: ["items"]`.
4. **`"anyof"`.** It appears in lower case on every document object. It is **not** a JSON-Schema keyword and constrains nothing, so it is not enforced. If neither `items` nor `txval` is present, there is nothing to compare: issue `NO_AMOUNTS` (error) for that document.
5. **Unknown keys.** `additionalProperties: false` appears only at the root and on the `ecom`/`ecoma` arrays, where it has no effect. An unknown key at the **root** is an error (source H). Anywhere else it is an `UNEXPECTED_KEY` **warning**: the known keys are still parsed and `raw` keeps everything. This is the policy `einvoice` D-Q5 uses for decoded responses.
6. **Invoice numbers.** They use `definitions/invnum`, `^(?!0*$)[a-zA-Z0-9-/]+$`, max 16. It allows **no whitespace**, allows leading zeros, and rejects all-zero numbers. The stricter `definitions/inum` exists but none of these sections uses it.
7. **Fields differ between sections** (v4.5):
   - `docdata.b2b[].inv[]` has no `itcRedReq`, `decl*` or `remarks`; `b2ba`, `cdnr` and `cdnra` have them.
   - `docRejdata` documents have `remarks` but no `imsStatus`.

   Transcribed as published.
8. **Rate.** `rt` has `multipleOf 0.01` but a maximum of `999.9`. Transcribed as published.

### 3.4 Amounts
- Absent document-level `igst`, `cgst`, `sgst` and `cess` count as `0.00`; they are optional in source H.
- If document-level `txval` is present, the document-level amounts are used (`amountsSource: "document"`). Otherwise the amounts are the sums over `items[]` (`"items"`). `val` is always the document value.
- If both levels are present and Σ items ≠ the document level for any field, the result is a warning `ITEMS_TOTAL_MISMATCH`. 2B is reported as published and never corrected.

### 3.5 API
```ts
parseGstr2bJson(text: string): Gstr2bParseResult
// { ok: boolean; value?: Gstr2b; raw: unknown; issues: ReconIssue[] }
type ReconIssue = {
  path: (string | number)[]; code: ReconIssueCode; message: string;
  severity: "error" | "warning" | "info";
};
```
- `ok` means no issue with severity `error`.
- Never throws on bad data.
- The section schemas and `Gstr2bRecordSchema` are also exported.

## 4. Register input
`reconcile(register: GstDocument[], gstr2b: Gstr2b | Gstr2b[], options?)`.
- **Already validated.** The register must hold `GstDocument`s that have already passed `parseGstDocument` (decision D-P4). `reconcile` does not re-parse them; it type-checks only.
- **Recipient filter.** Our GSTIN is the one in the 2B files:
  - All files must carry the same `data.gstin`. Otherwise the result is the error `RECIPIENT_MISMATCH` and no reconciliation runs.
  - A register document whose `recipient.gstin` differs or is absent goes to `excluded` with reason `NOT_OUR_PURCHASE`.
- **Kinds.**
  - `TAX_INVOICE` ↔ `INVOICE`, `CREDIT_NOTE` ↔ `CREDIT_NOTE`, `DEBIT_NOTE` ↔ `DEBIT_NOTE`.
  - `BILL_OF_SUPPLY` goes to `excluded` with reason `KIND_NOT_IN_2B_SECTIONS` (Q-CA6).
- **Compared amounts:** `totals.grandTotal` ↔ `val`, `totals.taxableValue` ↔ `txval`, and `totals.igst`/`cgst`/`sgst`/`cess` ↔ `igst`/`cgst`/`sgst`/`cess`.
- **Compared non-amount fields:** `placeOfSupply` ↔ `pos` and `reverseCharge` ↔ `rev`. They are compared only when 2B carries them.
- **Several 2B files.** Files covering several periods, or one period split across `fc` data files, are concatenated. Each record keeps its `returnPeriod`.

## 5. Normalisation
- **Document number:** `normaliseDocNumber(s)`.
  - Trim, uppercase, and collapse every run of Unicode whitespace to one space.
  - **Keep punctuation:** `/`, `-` and anything else.
  - Leading zeros are kept: `INV/001` ≠ `INV/1`. Pairs like these surface as `NUMBER_LOOSE` possible matches (§6.2).
  - Not configurable in v0.1.
- **Loose number** (for possible matches only): `looseDocNumber(s)`.
  - Apply `normaliseDocNumber`.
  - Strip the leading zeros of each maximal digit run, keeping a single `0` for an all-zero run. Runs are delimited by any non-digit **before** punctuation is removed, so `2026/007` has the two runs `2026` and `007`.
  - Then remove every character that is not `A–Z` or `0–9`.
  - Example: `INV/0012-A` → `INV12A`; `inv 12a` → `INV12A`; `2026/007` → `20267` (decision D-P3).
- **GSTIN:** uppercase.
- **Date:** ISO `YYYY-MM-DD` on both sides.
- **Match key:** `K = gstin | documentType | normaliseDocNumber(number) | date`.

## 6. Matching
Options: `{ amountTolerance?: string }`. The tolerance is absolute, per field and inclusive; the default is `"0.00"` (exact). All comparisons use `decimal.js`.

### 6.1 Pass 1 — exact key
- **Pairing.** Register documents and 2B records with equal `K` are paired one-to-one. The order is deterministic: the register in input order; 2B by file, then the section order of §3.1, then array order.
- **Amendments.** For `b2ba`/`cdnra` records, the key uses the **amended** (current) number and date.
- **Comparing a pair.** Each pair's amounts (§4) and its `pos`/`rev` are compared:
  - All amounts within tolerance and `pos`/`rev` equal → **matched**.
  - Otherwise → **matchedWithDifferences**, with `differences: { field, register, gstr2b, difference }[]`. `difference` is gstr2b − register, signed, 2 dp; `pos`/`rev` differences have no `difference`.
- **Duplicates.** A duplicate `K` within the register is a warning `DUPLICATE_IN_REGISTER`; within 2B it is a warning `DUPLICATE_IN_2B`. The extra copies stay unmatched and go on to pass 2.

### 6.2 Pass 2 — possible matches
Among the records left over from pass 1, a candidate pair needs the **same supplier GSTIN** and at least one of these reasons:

| Reason | Rule |
|---|---|
| `AMENDED_FROM` | The 2B record is `b2ba`/`cdnra`, and its `original` number and date (normalised) equal the register document's number and date |
| `DATE_DIFFERS` | Same type and number, different date |
| `TYPE_DIFFERS` | Same number and date, different `documentType` |
| `NUMBER_DIFFERS` | Same type, different number; `value` and `taxableValue` within tolerance; dates **in the same calendar month** (decision D-P2) |
| `NUMBER_LOOSE` | Same type, the normalised numbers differ but `looseDocNumber` is equal; any date (the date difference is reported) (decision D-P3) |

- **Unique pairs only.** A pair goes to **possibleMatches** only if it is **unique both ways**: the register document has exactly one candidate, and that 2B record has exactly one candidate.
  - The pair carries `reasons[]` and `differences[]`: the fields of §6.1, plus `number`, `date` and `documentType` when they differ.
  - Otherwise both records stay in the "only" buckets, with their `candidates` listed.
- **Suggestions only.** Possible matches, `NUMBER_LOOSE` included, are never promoted to matched.

### 6.3 Result
```ts
type ReconResult = {
  matched: Pair[];
  matchedWithDifferences: Pair[];
  possibleMatches: (Pair & { reasons: PossibleReason[] })[];
  in2bOnly: { record: Gstr2bRecord; candidates: RegisterRef[] }[];
  inRegisterOnly: { register: RegisterRef; candidates: Gstr2bRef[] }[];
  excluded: { register: RegisterRef; reason: "NOT_OUR_PURCHASE" | "KIND_NOT_IN_2B_SECTIONS" }[];
  issues: ReconIssue[];
  options: { amountTolerance: string };
};
// Pair        = { register: RegisterRef; gstr2b: Gstr2bRecord; differences: Difference[] }
// RegisterRef = { index: number; supplierGstin: string; kind: DocumentKind; number: string; date: IsoDate }
// Gstr2bRef   = { returnPeriod: string; path: (string | number)[] }
```
- **Invariant.** Every register document and every typed 2B record appears in **exactly one** bucket. A test checks this.
- **ITC data passes through unchanged.** `Gstr2bRecord.itc` and `origin` travel with every 2B side as they are.
- **Classification ignores ITC data.** It never depends on `itc.*` or on `origin`. Rejected and ITC-reversal records are classified like the rest, and their origin stays visible (Q-CA3, Q-CA4).
- **`summarise(result)`** returns counts per bucket and per-field totals of the differences, as decimal strings. It reports no ITC figures.

## 7. Errors
- Functions return result objects.
- They throw only on programmer errors: a non-string `text`, or a non-array register.

## 8. Exports
- Functions: `parseGstr2bJson`, `reconcile`, `summarise`, `normaliseDocNumber`, `looseDocNumber`.
- Constant: `GSTR2B_SCHEMA_VERSION = "4.5"`.
- Schemas and types: `Gstr2bSchema`/`Gstr2b`, `Gstr2bRecordSchema`/`Gstr2bRecord`, `ReconResult`, `ReconIssue`, and the section schemas.
- A `data.version` other than `"4.5"` gives a warning `SCHEMA_VERSION`; the file is still parsed.

## 9. Test list (Vitest; written first)
**model: lossless JSON (D-P1)**
- The tests move from `einvoice` with the helper:
  - `JsonNumber` keeps its source text;
  - a number/string mismatch is `WRONG_TYPE`;
  - unknown keys are dropped and reported by `parseLenient`.
- The `einvoice` suite stays green unchanged after it imports from `model`.

**parse**
- **Sections.** A minimal valid 2B with one record per section gives typed records with the correct `origin`, `section`, `documentType` and `original`. It covers b2b, b2ba, cdnr and cdnra, in docdata, docRejdata and itcrev.
- **Lossless numbers.** `9999999999999.99` round-trips as a string, and `1180` becomes `"1180.00"`. Each of these is an error: `1e3`, a string in a number field, a number in a string field.
- **Dates.** `29-02-2024` is accepted; `29-02-2025` and `31-04-2026` are rejected. Output dates are ISO. Period `132026` is rejected.
- **Enums.** Each one accepts exactly its published values:
  - `itcavl` Y/N/T; `imsStatus` A/R/N;
  - `diffprcnt` 0.65/1 (0.5 is rejected);
  - `nttyp` C/D; the `invtyp` codes;
  - `isITCRevAmd` only `Y`.
- **Required fields.** For each section, one case with a missing field, asserting the path.
- **Unknown keys.** At the root → error. In a record → `UNEXPECTED_KEY` warning, and `raw` keeps the key.
- **GSTINs.**
  - A lower-case `ctin` is accepted and upper-cased.
  - An NR-pattern `ctin` is accepted.
  - An invalid check digit gives only an info `CTIN_CHECK_DIGIT`.
- **Amounts.**
  - Document level is used when `txval` is present; item sums are used when it is absent.
  - Absent tax fields are 0.00.
  - A mismatch between the levels gives a warning `ITEMS_TOTAL_MISMATCH`.
  - Neither items nor `txval` gives `NO_AMOUNTS`.
- **`invnum`.** `0012` is accepted; `000`, `A B` and a 17-character number are rejected.
- **Untyped sections.** With `isd`, `impg`, `ecom`, `itcsumm` etc. present, parsing still succeeds and they are kept in `raw`.
- **Version.** `version` `"4.4"` gives a `SCHEMA_VERSION` warning.

**conformance**
- The Zod section schemas enforce exactly source H's required sets, patterns, enums, min and max, checked with boundary probes generated from the source. The §3.3 quirks are asserted explicitly.
- Every v4.4 constraint holds under v4.5 (strict subset, from the diff in `sources/recon/README.md`).

**normalise**
- `normaliseDocNumber`:
  - `"  inv/ 001  "` → `"INV/ 001"`;
  - tabs and newlines collapse;
  - punctuation is kept, so `INV-1` ≠ `INV/1`.
- `looseDocNumber`:
  - `INV/0012-A` → `INV12A`;
  - `INV-1` = `INV/1` = `inv1`;
  - `2026/007` → `20267`;
  - `000` → `0`;
  - `A00B` → `A0B`.

**reconcile**
- **Exact match.** → `matched`. A number that differs only in case or surrounding whitespace is still `matched`.
- **Amount differences.**
  - Each amount field off by 0.01 → `matchedWithDifferences`, with the field, both values and the signed difference.
  - Tolerance `"1.00"` turns it into `matched`.
  - The boundary is inclusive: a difference of `1.00` passes, `1.01` does not.
- **`pos`/`rev`.** Differences are reported. When 2B (cdnr) omits them, they are not compared.
- **Only buckets.** In 2B only; in register only.
- **Possible matches**, one test per reason:
  - `DATE_DIFFERS`;
  - `TYPE_DIFFERS`;
  - `AMENDED_FROM`: a b2ba record whose `oinum` equals the register number;
  - `NUMBER_DIFFERS`: same month → suggested; next month → not suggested;
  - `NUMBER_LOOSE`: `INV/001` vs `INV-1` → suggested, never `matched`, even when all amounts are equal.
  - An ambiguous candidate stays in the only buckets, with `candidates`.
- **Amendments.** An amended record is matched exactly on its new number.
- **Duplicates.** Duplicates in the register or in 2B give warnings, and the extra copy stays unmatched.
- **Note types.** A credit note and a debit note with the same number do not match exactly (`TYPE_DIFFERS`).
- **Excluded.** Recipient GSTIN ≠ the 2B GSTIN; recipient without a GSTIN; bill of supply.
- **Recipient mismatch.** Two 2B files with different `gstin` → `RECIPIENT_MISMATCH`.
- **Periods.** Several periods are concatenated, and each record keeps its `returnPeriod`.
- **ITC neutrality.**
  - Flipping `itcavl` N↔Y, `imsStatus`, `diffprcnt` or `origin` never changes a bucket.
  - The `itc` fields come out byte-identical.
  - No output key is named like eligible or claimable.
- **Invariant.** Every input document and record is in exactly one bucket; property-style test over the fixtures.
- **Order.** The output order is deterministic.

**api / data**
- No default exports.
- Fixtures:
  - synthetic only;
  - GSTINs only from `packages/fixtures/src/gstins.ts`;
  - a synthetic 2B fixture in `packages/fixtures/src/gstr2b.ts`, built from the same fixture documents.

## 10. Deferred
ISD/ISDA; imports (IMPG/IMPGSEZ); ECO sections (ECOM/ECOMA); the summaries (`itcsumm`, `cpsumm`, `cpSummRej`) and cross-checking them against records; rate-wise (item-level) comparison; netting amendments across periods; GSTR-2A; configurable normalisation; fuzzier number matching beyond §6.2; IMS actions.

## 11. Deviations from the brief / source contradictions
- **D1. Document type in the match key.** 2B has no document-type field for invoices. The type comes from the section (b2b/b2ba ⇒ invoice) and, for notes, from `typ` C/D. An invoice's `typ` is a **supply-type** code; its codes are not defined in source H, so it is not part of the key.
- **D2. "Collapse whitespace."** Source H's `invnum` and the model's `DocumentNumberSchema` both forbid whitespace, so on valid data this step does nothing. It is kept as specified.
- **D3. 2B GSTINs.** They are not validated with the model's `GstinSchema`, because of the NR pattern and lower case (§3.3 (1)–(2)).
- **D4. Negative money.** `val` has no minimum in source H, so negative money is accepted structurally and reported as it is.
- **D5. Quirks.** `itcrev` and `anyof` are read as described in §3.3 (3) and (4).
- **D6. Draft source.** Source H is itself a **Draft** API schema. If the final published version differs, it supersedes this one.

## 12. Open questions for the CA (tax rules; v0.1 defaults in brackets)
Each one becomes a `docs/legal-facts.md` row when it is answered.
- **Q-CA1. Invoice `typ` codes.** What do `R, DE, SEWP, SEWOP, SEZNAO, SEZWPAO, SEZWOPAO, CBW` and the note `suptyp` codes mean? Source H does not define them; an official code list is needed before mapping them to `supplyCategory`. [Passed through raw; not compared.]
- **Q-CA2. `diffprcnt` 0.65.** With it, 2B tax is 65 % of the rate. Should the register be expected to carry the same reduced tax, or should recon flag differential-rate pairs separately? [Reported only.]
- **Q-CA3. `itcrev`.** What do `docdata.itcrev` and `isITCRevAmd = "Y"` represent? Should those records be reconciled against the register like the others, or kept as a separate list? They may repeat a document already in b2b/cdnr. [Reconciled like the others, `origin: "itcrev"` visible.]
- **Q-CA4. IMS-rejected documents (`docRejdata`).** Should they form their own bucket? [Matched like the others, `origin: "docRejdata"` visible.]
- **Q-CA5. Amendments across periods.** Does a `b2ba` record in period P supersede a `b2b` record from an earlier 2B? [No cross-period netting; both reported.]
- **Q-CA6. Bills of supply.** Bills of supply, and reverse-charge purchases from unregistered suppliers, are not expected in these sections. Confirm. [Excluded.]
- **Q-CA7. Note types.** Source H says only "Note Type". Is `C` a credit note and `D` a debit note? [Assumed.]
- **Q-CA8. Tolerance.** Is exact the right default, or is ±1 rupee (or a per-tax-head tolerance) customary for 2B reconciliation? [Exact.]

## 13. Decisions (owner, approved 2026-10-16)
- **D-P1. Shared lossless JSON.** The lossless-JSON helper moves from `packages/einvoice/src/lossless.ts` (with the parts of `zod-walk.ts` it needs) into `@india-gst-kit/model`. It is exported there with its tests, and `einvoice` and `recon` both import it.
  - It is done as a **separate model change** in the recon build PR, with a changeset (minor for `model`, patch for `einvoice`).
  - The note is in `docs/specs/einvoice.md` §2.
  - This spec PR has no code.
- **D-P2. `NUMBER_DIFFERS`** requires all of:
  - the same supplier and document type;
  - `value` and `taxableValue` within tolerance;
  - both dates in the same calendar month.
- **D-P3. `NUMBER_LOOSE`** compares `looseDocNumber` (§5). It is a suggestion only and never matched.
- **D-P4. Register input.** The register must already consist of validated `GstDocument`s; `reconcile` does not run `parseGstDocument`.

## 14. `docs/legal-facts.md` rows to add (at build time)
Each row cites the source H URL, retrieved 2026-10-16, status UNVERIFIED — needs CA:
- the enums used: `itcavl`, `imsStatus`, `diffprcnt`, `isITCRevAmd`;
- the note type C/D mapping (Q-CA7);
- section → document type;
- the exclusion of bills of supply (Q-CA6);
- the default exact tolerance (Q-CA8, design decision);
- reading `itcrev` and `docRejdata` like `docdata` (Q-CA3, Q-CA4, design decision).
