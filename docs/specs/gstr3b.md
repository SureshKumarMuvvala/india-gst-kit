# Spec — `@india-gst-kit/gstr3b` (v0.1, Track G)

Status: **draft for review**, 2026-10-18. Spec only: no package code until the decisions in §15 are approved. Every legal or official fact and every decision here is **UNVERIFIED — needs CA** until a chartered accountant signs it off in `docs/legal-facts.md`.

Sources. All are under `sources/gstr3b/`. Provenance, dates and SHA-256 are in that folder's README.
- **SV** = `GSTR3B - Save GSTR3B data request_schema v7.1.json`. This is the GSTN API "GSTR3B – Save GSTR3B data" (2269), **v7.1**, published 23-03-2026, portal status **Draft**. It is **authoritative** for every key, type, pattern and range of the output. Cited as "SV `path`" or "SV `#def`".
- **AC** = `GSTR3B - Get ITC Liability Auto Calc Details response_schema v7.1.json`. This is "GSTR3B – Get ITC Liability Auto Calc Details" (3183), **v7.1**, published 23-03-2026, **Draft**. It is authoritative for the shape of the portal's auto-calculated figures. Its key names are the **only** source in the repo for which GSTR-1 / GSTR-2B table feeds which GSTR-3B box (R5). Cited as "AC `path`", relative to `r3bautopop.liabitc` unless stated.
- **R1–R6** = the observations in `sources/gstr3b/README.md`. They are confirmed or corrected in §13.
- **Packages used:**
  - `@india-gst-kit/gstr1`: `Gstr1Return`; spec `docs/specs/gstr1.md`; GSTR-1 table names from `sources/gstr1/offline-tool/data/uploadtablename.json`, cited as "UT".
  - `@india-gst-kit/recon`: `Gstr2bRecord`, `ReconResult`; spec `docs/specs/recon.md`.
  - `@india-gst-kit/model`: GSTIN, state codes, lossless JSON.

Where SV or AC contradicts this spec, **the source wins**, and the difference goes in §13. Nothing here is filled in from memory. Each rule a source does not state is either a **caller input** or an **open question** (§16), with the file that would settle it listed in §17.

## 1. Principle, purpose and scope

**The package assembles and checks figures. It never decides tax.** This is the same principle as `recon`. The package never decides:
- taxability or rate;
- ITC eligibility, or which GSTR-2B line is claimable;
- reversals (any rule, any reason), ineligible ITC;
- interest or late fee;
- whether a recipient is a composition taxpayer or a UIN holder.

Every such amount is an **explicit caller input**, and it is recorded as one in the provenance trail (§3.3).

**In scope (v0.1)**
- An internal `Gstr3bReturn` model (§3) that mirrors SV for tables 3.1 (a)–(e), 3.1.1, 3.2, 4 (A–D), 5 and 5.1.
- `outwardFromGstr1()` (§4): derives the parts of 3.1 / 3.2 that AC attributes to GSTR-1 tables the `gstr1` package produces. Each contribution is traced to its GSTR-1 table and AC path. Everything else is reported as "not covered".
- `sumGstr2bRecords()` (§5): an optional helper that totals selected `Gstr2bRecord`s. It never selects, filters by eligibility or nets anything.
- `assembleGstr3b()` (§6): builds the return from derived parts and caller inputs, with the trail.
- `validateGstr3b()` (§7): checks arithmetic, ranges, sign, period, GSTIN and POS.
- `toSavePayload()` / `serializeGstr3b()` / `parseSavePayloadJson()` (§8): the SV v7.1 wire format, lossless.
- `parseAutoCalcJson()` / `compareWithAutoCalc()` (§9): a per-box diff of our figures against the portal's, with a caller-set tolerance. It **never auto-corrects**.

**Out of scope / deferred (§14)**
- Fetching, saving, offsetting or filing (that is `gsp` and later tracks).
- Quarterly / QRMP filers (`det_q`), IFF and GSTR-1A.
- GSTR-1 tables the `gstr1` package does not build: 4C, 8, 9A, 9C, 10, 11, 14, 15, and the IMS rows.
- Late fee. SV v7.1 has no field for it (§13 C1).
- Interest computation (AC lists separate APIs 3330/3332, not downloaded).
- Ledger, RCM and ITC opening-balance APIs.

**Conventions:**
- ESM, named exports only; Zod 4 (peer `^4.0.0`); `decimal.js`.
- `@india-gst-kit/model`, `@india-gst-kit/gstr1` and `@india-gst-kit/recon` as `workspace:^` dependencies.
- Types are `z.infer`, and every object is `z.strictObject`. SV itself sets `additionalProperties: false` only on `inter_sup` and `itc_net` (§13 C3), so we are stricter than the source.
- Functions return result objects. They throw only on programmer errors, such as a non-string `text` (as in `recon` §7).

## 2. Numbers, dates, JSON

- **Money in memory.** Money is a decimal **string** with exactly 2 decimals.
  - Signed money (`Signed3b`): `^-?\d{1,13}\.\d{2}$`, within ±9999999999999.99. `-0.00` is rejected.
  - Unsigned money (`Unsigned3b`): `^\d{1,13}\.\d{2}$`, within 0 … 9999999999999.99.
- **Sign per field, from SV:**

  | SV definition | Range | Used by |
  |---|---|---|
  | `#negVal` | −9999999999999.99 … 9999999999999.99, `multipleOf 0.01` | 3.1 a–e; 3.1.1; 3.2 rows; `itc_avl`; `itc_inelg` with `ty = OTH` |
  | `#nonEmptyCost` | 0 … 9999999999999.99 | `itc_rev`; `itc_inelg` with `ty = RUL` (the `oneOf`); `isup_details.inter`/`intra`; `intr_details` |
  | `#nonEmptyCostITCNet` | −9999999999999.99 … 9999999999999.99 | `itc_net` |
  | `#txval` | 0 … 9999999999999.99 | **unused** in SV (§13 C9) |

- **On the wire** (R2), money goes out as JSON **numbers**. `serializeGstr3b` writes each one as a raw number literal with exactly 2 dp (`1180.00`, `-25.50`, `0.00`). This is the technique of `einvoice` §2 and `gstr1` §4. It never goes through a JS `number`, so it is lossless.
- **Reading JSON.** `parseSavePayloadJson` and `parseAutoCalcJson` use the shared lossless parser from `@india-gst-kit/model` (`parseJsonLossless`, recon D-P1). Every number keeps its source text.
  - A string where a number is expected is a type error, and so is the reverse.
  - A number with more than 2 dp is an error (`multipleOf 0.01`).
  - Valid input is normalised to 2 dp: `1180` → `"1180.00"`.
- **`ret_period`.** Must match SV `^((0[1-9]|1[012])((19|20)\d\d))$` (`MMYYYY`). AC uses the same `#ret_period`. In memory it is kept as-is and also exposed as `{ month, year }`.
- **AC dates.** `r1fildt`, `r2bgendt`, `r3bgendt` and `r1afildt` use AC `#date`, `DD-MM-YYYY`. They become `IsoDate` (`YYYY-MM-DD`), with a real-calendar check.
- **Arithmetic** uses decimal.js only (`src/decimal.ts`, the per-package clone used elsewhere). Sums are exact. No amount is ever rounded, because every input already has 2 dp.

## 3. Internal model — `Gstr3bReturnSchema`

### 3.1 Shape

The model mirrors SV one-to-one. Neutral field names are used where SV's key states the meaning. Where the meaning comes only from a code, **SV's codes are kept as keys** (D-H1). Every box is always present: an absent figure is `0.00`, and an absent 3.2 list is `[]`.

```ts
type Heads5 = { taxableValue: Signed3b; igst: Signed3b; cgst: Signed3b; sgst: Signed3b; cess: Signed3b };
type TaxHeads<M> = { igst: M; cgst: M; sgst: M; cess: M };
type PosRow = { pos: Pos3b; taxableValue: Signed3b; igst: Signed3b };   // §7 V6

type Gstr3bReturn = {
  gstin: string;                 // §7 V4
  period: string;                // MMYYYY
  t31: {
    a: Heads5;                                           // SV sup_details.osup_det
    b: { taxableValue: Signed3b; igst: Signed3b; cess: Signed3b };  // SV osup_zero (no camt/samt)
    c: { taxableValue: Signed3b };                       // SV osup_nil_exmp
    d: Heads5;                                           // SV isup_rev
    e: { taxableValue: Signed3b };                       // SV osup_nongst
  };
  t311: {
    i: Heads5;                                           // SV eco_dtls.eco_sup
    ii: { taxableValue: Signed3b };                      // SV eco_dtls.eco_reg_sup
  };
  t32: { unregistered: PosRow[]; composition: PosRow[]; uinHolders: PosRow[] };  // SV inter_sup.*
  t4: {
    available: { IMPG: TaxHeads<Signed3b>; IMPS: …; ISRC: …; ISD: …; OTH: … };  // SV itc_avl[ty]
    reversed:  { RUL: TaxHeads<Unsigned3b>; OTH: TaxHeads<Unsigned3b> };       // SV itc_rev[ty]
    net:       TaxHeads<Signed3b>;                                             // SV itc_net
    ineligible:{ RUL: TaxHeads<Unsigned3b>; OTH: TaxHeads<Signed3b> };         // SV itc_inelg[ty] (oneOf)
  };
  t5:  { GST: { inter: Unsigned3b; intra: Unsigned3b }; NONGST: { inter: Unsigned3b; intra: Unsigned3b } }; // SV inward_sup.isup_details[ty]
  t51: { interest: TaxHeads<Unsigned3b> };               // SV intr_ltfee.intr_details (no late-fee field: C1)
};
```

### 3.2 Box ids and SV paths

**Box ids.** Every figure has a `BoxId`. Diffs (§9), the trail (§3.3) and issues (§7) use these ids.

| BoxId | SV path | AC box (subtotal) | Fields | Label basis |
|---|---|---|---|---|
| `3.1a` | `sup_details.osup_det` | `sup_details.osup_3_1a` | 5 | AC key `osup_3_1a`; R1 |
| `3.1b` | `sup_details.osup_zero` | `sup_details.osup_3_1b` | txval, iamt, csamt | AC `osup_3_1b`; R1 |
| `3.1c` | `sup_details.osup_nil_exmp` | `sup_details.osup_3_1c` | txval | AC `osup_3_1c`; R1 |
| `3.1d` | `sup_details.isup_rev` | `sup_details.isup_3_1d` | 5 | AC `isup_3_1d`; R1 |
| `3.1e` | `sup_details.osup_nongst` | `sup_details.osup_3_1e` | txval | AC `osup_3_1e`; R1 |
| `3.1.1i` | `eco_dtls.eco_sup` | `sup_details.esup_3_1_1a` | 5 | AC `esup_3_1_1a`; same field set |
| `3.1.1ii` | `eco_dtls.eco_reg_sup` | `sup_details.esup_3_1_1b` | txval | AC `esup_3_1_1b`; same field set |
| `3.2unreg` | `inter_sup.unreg_details[]` | `inter_sup.osup_unreg_3_2` | pos, txval, iamt | AC key |
| `3.2comp` | `inter_sup.comp_details[]` | `inter_sup.osup_comp_3_2` | pos, txval, iamt | AC key |
| `3.2uin` | `inter_sup.uin_details[]` | `inter_sup.osup_uin_3_2` | pos, txval, iamt | AC key |
| `4A.IMPG` … `4A.OTH` | `itc_elg.itc_avl[ty]` | see §9.2 | 4 heads | SV `ty` enum |
| `4B.RUL`, `4B.OTH` | `itc_elg.itc_rev[ty]` | see §9.2 | 4 heads | SV `ty` enum |
| `4C` | `itc_elg.itc_net` | — | 4 heads | SV key |
| `4D.RUL`, `4D.OTH` | `itc_elg.itc_inelg[ty]` | see §9.2 | 4 heads | SV `ty` enum |
| `5.GST`, `5.NONGST` | `inward_sup.isup_details[ty]` | — | inter, intra | SV `ty` enum |
| `5.1` | `intr_ltfee.intr_details` | — | 4 heads | SV key |

**Caveat on the labels.** SV has no descriptions that name the return's table numbers. "3.1 (a)" for `osup_det` rests on AC's key names (`osup_3_1a`, …), the matching field sets and R1. The meanings of the codes `IMPG`, `IMPS`, `ISRC`, `ISD`, `OTH`, `RUL`, `GST` and `NONGST` are **not defined** in SV. SV's own descriptions for `ty` say "Identifer if Goods or Services" even for `RUL`/`OTH` (§13 C2). The package therefore uses the codes and never their meanings (Q-H1). File F1 settles this.

### 3.3 Provenance trail

`assembleGstr3b` returns a `Gstr3bDraft = { return: Gstr3bReturn; trail: TrailEntry[] }`.

```ts
type TrailEntry = {
  box: BoxId; pos?: Pos3b;                       // pos for 3.2 rows
  source: "GSTR1" | "GSTR2B_SUM" | "CALLER" | "COMPUTED";
  ref: string;            // GSTR1: AC table key ("tbl4a"); GSTR2B_SUM: the helper's selection label;
                          // CALLER: the caller's label (required, non-empty); COMPUTED: "4C = Σ4A − Σ4B" (D-H7)
  amounts: Partial<Record<"taxableValue"|"igst"|"cgst"|"sgst"|"cess"|"inter"|"intra", string>>;
  documents?: { section: string; number: string }[];  // GSTR1 only: which gstr1 documents fed it
};
```

- **Invariant.** For every box, field and 3.2 POS, the value in `return` equals the sum of that box's trail entries. A box with no entries is `0.00`. `validateGstr3b` checks this (V1).
- **Caller labels.** Every caller amount carries a `label`, such as `"4B per CA working 2026-10"`. An empty label is an error (`CALLER_LABEL_MISSING`). This is how "caller input, recorded as such" is enforced.
- **Boxes the package never fills.** `3.1c`, `3.1d`, `3.1e`, all of 3.1.1, 4A–4D, 5 and 5.1 can only have `CALLER`, `GSTR2B_SUM` (4A and `3.1d` only; §5) or `COMPUTED` (4C only) entries. `GSTR1` entries are limited to `3.1a`, `3.1b` and 3.2 (§4).

## 4. Outward side — `outwardFromGstr1(gstr1, ctx)`

```ts
function outwardFromGstr1(
  gstr1: Gstr1Return,              // value of a successful buildGstr1(); re-validated with Gstr1ReturnSchema
  ctx: {
    recipientTypes?: Readonly<Record<string, "COMPOSITION" | "UIN_HOLDER">>; // caller input; default: none
  },
): OutwardDerivation;

type OutwardDerivation = {
  gstin: string; period: string;
  entries: TrailEntry[];           // source "GSTR1", one per (box, AC table, pos)
  unmapped: { section: string; number?: string; reason: Gstr3bIssueCode }[]; // gstr1 data we could not place
  notCovered: string[];            // AC det keys that feed 3.1a/3.1b/3.2 but that gstr1 cannot produce (§4.3)
  recipientTypes: Record<string, "COMPOSITION" | "UIN_HOLDER">; // echo of the caller input
};
```

### 4.1 Two mappings, two sources

A GSTR-1 document reaches a 3B box in two steps:
- **Mapping M (GSTR-1 table → 3B box).** This comes from AC's key names (R5). It is the **only** official statement available, and it is quoted path by path in §4.2. If AC does not list a table under a box, nothing from that table goes into that box.
- **Mapping G (our `Gstr1Return` data → GSTR-1 table).** UT says only that `b2b` = "4A, 4B, 6B, 6C", `b2cl` = "5A, 5B", `b2cs` = "7", `exp` = "6A" and `cdnr`/`cdnur` = "9B". **No source in the repo says which invoice goes to which sub-table.** The rows below are a **proposal** (D-H6), and each one is marked. File F4 settles them.

| Row | `Gstr1Return` data | GSTR-1 table (AC key) | Basis |
|---|---|---|---|
| G1 | `b2b` invoice, `invoiceType R`, `reverseCharge false` | `tbl4a` | UT "4A, 4B, 6B, 6C"; proposal |
| G2 | `b2b` invoice, `invoiceType R`, `reverseCharge true` | `tbl4b` | UT; proposal. AC `tbl4b` has only `txval` |
| G3 | `b2b` invoice, `invoiceType SEWP`/`SEWOP`, `reverseCharge false` | `tbl6b` | UT; H r27 ("SEZ unit/developer"); proposal |
| G4 | `b2b` invoice, `invoiceType DE`, `reverseCharge false` | `tbl6c` | UT; H r27 ("deemed export"); proposal |
| G5 | `b2b` invoice, `reverseCharge true`, `invoiceType` ≠ `R` | — | **unmapped**: `RCM_NOT_MAPPED` (Q-H4) |
| G6 | `b2cl` invoice | `tbl5a` | UT "5A, 5B"; proposal: `gstr1` has no e-commerce data, so we assume 5A (Q-H5) |
| G7 | `exp` invoice (`WPAY`/`WOPAY`) | `tbl6a` | UT "6A" |
| G8 | `b2cs` row, `supplyType INTRA` | `tbl7a_1` | UT "7"; by shape, because AC `tbl7a_1` has `camt`/`samt` and no `iamt`; proposal (Q-H6) |
| G9 | `b2cs` row, `supplyType INTER` | `tbl7b_1` | by shape, because AC `tbl7b_1` has `iamt` and no `camt`/`samt`; proposal (Q-H6) |
| G10 | `cdnr` note; `cdnur` note | `tbl9b` | UT "9B" |

**Sign (D-H6).** Credit notes (`noteType C`) contribute **negative** amounts and debit notes (`D`) positive ones. AC types the `tbl9b` rows as signed (`#txamt`). It types `tbl11b_*`/`tbl11d_*` as `#negtxamt` (≤ 0), which suggests that AC adds signed rows. **No source states this** (Q-H7).

**Amounts.** Each row uses the item amounts `taxableValue`, `igst`, `cgst`, `sgst` and `cess` as `gstr1` holds them. An absent `igst`/`cgst`/`sgst` counts as `0.00`. The document `value` is never used, because AC's `val` has no stated meaning (§13 C10).

### 4.2 Mapping M — quoted from AC

Only the AC keys reachable through G1–G10 are applied. "Fields" lists what AC's det node carries; any other head of our row is **not** added to that box. For example, G2's IGST does not go into `3.1a` (D-H6).

| Box | AC det path (under `liabitc.`) | Fields (AC) | Fed by |
|---|---|---|---|
| `3.1a` | `sup_details.osup_3_1a.det.tbl4a` | txval, iamt, camt, samt, csamt | G1 |
| `3.1a` | `…osup_3_1a.det.tbl4b` | txval | G2 (taxable value only) |
| `3.1a` | `…osup_3_1a.det.tbl5a` | txval, iamt, csamt | G6 |
| `3.1a` | `…osup_3_1a.det.tbl6c` | txval, iamt, camt, samt, csamt | G4 |
| `3.1a` | `…osup_3_1a.det.tbl7a_1` | txval, camt, samt, csamt | G8 |
| `3.1a` | `…osup_3_1a.det.tbl7b_1` | txval, iamt, csamt | G9 |
| `3.1a` | `…osup_3_1a.det.tbl9b` | txval, iamt, camt, samt, csamt | G10, for notes whose `invoiceType`/`type` is `R`, `DE` or `B2CL` (D-H6 (c)) |
| `3.1b` | `sup_details.osup_3_1b.det.tbl6a` | txval, iamt, csamt | G7 |
| `3.1b` | `…osup_3_1b.det.tbl6b` | txval, iamt, csamt | G3 |
| `3.1b` | `…osup_3_1b.det.tbl9b` | txval, iamt, csamt | G10, for notes whose `invoiceType`/`type` is `SEWP`, `SEWOP`, `EXPWP` or `EXPWOP` (D-H6 (c)) |
| `3.2comp` / `3.2uin` | `inter_sup.osup_comp_3_2.det.tbl4a[]` / `osup_uin_3_2.det.tbl4a[]` | pos, txval, iamt | G1, where `ctx.recipientTypes[ctin]` is `COMPOSITION` / `UIN_HOLDER` (D-H6 (d), (e)) |
| `3.2comp` / `3.2uin` | `…osup_comp_3_2.det.tbl9b[]` / `osup_uin_3_2.det.tbl9b[]` | pos, txval, iamt | G10 `cdnr` notes with `invoiceType R`, as above |
| `3.2unreg` | `inter_sup.osup_unreg_3_2.det.tbl5a[]` | pos, txval, iamt | G6 |
| `3.2unreg` | `…osup_unreg_3_2.det.tbl7b_1[]` | pos, txval, iamt | G9 |
| `3.2unreg` | `…osup_unreg_3_2.det.tbl9b[]` | pos, txval, iamt | G10 `cdnur` notes with `type B2CL` |

**AC lists more, and those keys are not applied.**
- `tbl6c` and `tbl6b` are not under any 3.2 node, so deemed-export and SEZ supplies never go into 3.2.
- `tbl4b` is not under 3.2.
- `tbl6a`/`tbl6b` are not under `3.1a`.

All of this follows from M as quoted.

### 4.3 What the derivation does not cover

`notCovered` lists every AC det key under `osup_3_1a`, `osup_3_1b` and the three 3.2 nodes that G cannot reach. The caller must add those amounts as `CALLER` entries if they apply.

| Box | AC det keys not covered |
|---|---|
| `3.1a` | `tbl4c`, `tbl4f`, `tbl5b`, `tbl9a`, `tbl9c`, `tbl10a`, `tbl10b`, `tbl11a_1_2_4`, `tbl11b_1_2_4`, `tbl11c_1_2_4`, `tbl11d_1_2_4`, `tbl11_i_a_1`, `tbl11_i_a_2`, `tbl11_i_b_1`, `tbl11_i_b_2`, `tbl11_ii`, `ims_9b_cn`, `ims_9c_cn`, `ims_9a_9c_dn` |
| `3.1b` | `tbl9a`, `tbl9c`, `tbl9bSezEco`, `tbl9cSezEco`, `tbl9bSezEcourp2b`, `tbl9cSezEcourp2b`, `tbl11a_3`, `tbl11a_5`, `tbl11b_3`, `tbl11b_5`, `tbl11c_3`, `tbl11c_5`, `tbl11d_3`, `tbl11d_5`, `tbl15b2b`, `tbl15urp2b`, `tbl15b2ba`, `tbl15urp2ba`, `ims_9b_cn`, `ims_9c_cn`, `ims_9a_9c_dn`, `ims_9b_cn_eb2b`, `ims_9b_cn_ec2b`, `ims_9c_cn_eb2b`, `ims_9c_cn_ec2b`, `ims_9a_9c_dn_eb2b`, `ims_9a_9c_dn_ec2b`, `ims_15_b2ba`, `ims_15_urp2ba` |
| `3.2unreg` | `tbl9a`, `tbl9c`, `tbl10b`, `tbl11_i_a_2`, `tbl11_i_b_2`, `tbl11_ii`, `tbl11a_4_5` … `tbl11d_4_5`, `tbl15b2c`, `tbl15urp2c`, `tbl15b2ca`, `tbl15urp2ca` |
| `3.2comp`, `3.2uin` | `tbl4c`, `tbl9a`, `tbl9c`, `tbl11a_1_5` … `tbl11d_1_5`, `tbl15b2b`, `tbl15urp2b`, `tbl15b2ba`, `tbl15urp2ba` |
| `3.1c`, `3.1e` | `tbl8` (both boxes). AC does not say how GSTR-1 Table 8 splits between them (Q-H8). `gstr1` has no Table 8. Always caller input. |
| `3.1.1i`, `3.1.1ii` | every key (Tables 14, 15 and the IMS rows). Always caller input. |
| `3.1d` | fed from GSTR-2B, not GSTR-1 (`isup_3_1d.det.itcavl`, `itcunavl`, `itcavl_cn`). Caller input, or optionally §5. |

The suffixes `_1`, `_1_2_4`, `_3`, `_5`, `_4_5`, `_1_5`, `SezEco`, `urp2b`, `eb2b`, `ec2b` and the `ims_*` rows are **not defined** in AC (Q-H2). The package reads them only as names.

### 4.4 Preconditions and issues

**Errors.** Each one is an issue; the derivation still returns everything else.
- `gstr1` fails `Gstr1ReturnSchema` → `GSTR1_INVALID`. The whole derivation fails.
- `gstr1.gstin` ≠ the 3B `gstin` passed to `assembleGstr3b` → `GSTR1_GSTIN_MISMATCH`. Checked at assembly.
- `gstr1.period` ≠ the 3B `period` → `GSTR1_PERIOD_MISMATCH`. Checked at assembly.

**Unmapped. Listed, not fatal.**
- G5 → `RCM_NOT_MAPPED`.
- An RCM `cdnr` note (`reverseCharge true`) → `RCM_NOT_MAPPED`. AC does not say whether `tbl9b` carries RCM notes as tax or taxable value only (Q-H4).
- A 3.2-bound item with `cgst`/`sgst` > 0 → `INTRA_ITEM_IN_32`. That item feeds 3.1 only. 3.2 carries IGST only (D-H6 (d)).
- A `cdnur` `B2CL` note without `pos` → `NOTE_POS_MISSING`. It goes into 3.1 only.
- A 3.1b-bound item with `cgst`/`sgst` > 0 → `INTRA_ITEM_IN_31B`. SV `osup_zero` has no `camt`/`samt`. This should not happen with `gstr1` output.

## 5. Inward / ITC side

### 5.1 Caller inputs

The following are **always caller inputs**, each with a `label`:
- 4A (all five `ty` rows)
- 4B (`RUL`, `OTH`)
- 4D (`RUL`, `OTH`)
- 5 (`GST`, `NONGST` × inter/intra)
- 5.1 (interest)
- `3.1d`

4C is caller input, or `"COMPUTE"` (D-H7). The package does not check that 4A rows are "eligible", and it does not derive 4B or 4D from anything.

### 5.2 Optional helper — `sumGstr2bRecords(records, options?)`

```ts
function sumGstr2bRecords(
  records: readonly Gstr2bRecord[],         // e.g. result.matched.map(p => p.gstr2b); the caller chooses
  options?: { label?: string; filerGstin?: string; period?: string },
): Gstr2bTotals;

type Gstr2bTotals = {
  label: string;
  groups: {                                 // one per distinct key; never merged
    key: { documentType: "INVOICE" | "DEBIT_NOTE" | "CREDIT_NOTE";
           itcavl: "Y" | "N" | "T" | "ABSENT"; reverseCharge: "Y" | "N" | "ABSENT";
           origin: Gstr2bOrigin; returnPeriod: string };
    count: number;
    totals: { taxableValue: string; igst: string; cgst: string; sgst: string; cess: string }; // positive, as in 2B
    paths: Gstr2bRef[];
  }[];
  issues: Gstr3bIssue[];   // PERIOD_MIXED, RECIPIENT_MISMATCH (warnings)
};
```

- **Totals only.** It **never** filters by `itcavl`, `rsn`, `imsStatus` or `diffprcnt`. It never nets credit notes against invoices, and it never chooses a 4A row. Grouping by `itcavl`, `reverseCharge` and `origin` shows the caller what is in the selection, and nothing more.
- **Feeding a box.** To put a figure into 4A or `3.1d`, the caller passes a group or groups explicitly to `assembleGstr3b`, with a box id and a sign (`+`/`−`). Each group becomes a `GSTR2B_SUM` trail entry whose `ref` is `label` plus the group key. The cess, IGST, CGST and SGST totals are copied as they are.
- **Coverage.** `recon` types only B2B, B2BA, CDNR and CDNRA (`recon.md` §3.1), so the helper cannot total IMPG or ISD. Those 4A rows are caller-only.
- **Warnings.** If `filerGstin` / `period` is given and a record's `recipientGstin` / `returnPeriod` differs, the helper warns (`RECIPIENT_MISMATCH`, `PERIOD_MIXED`). It still totals the record, because the caller chose it.

## 6. Assembly — `assembleGstr3b(input)`

```ts
function assembleGstr3b(input: {
  gstin: string; period: string;
  outward?: OutwardDerivation;                                   // §4; optional
  entries?: readonly CallerEntry[];                              // CALLER amounts, each with box, label, amounts (and pos for 3.2)
  fromGstr2b?: readonly { box: "4A.IMPG"|"4A.IMPS"|"4A.ISRC"|"4A.ISD"|"4A.OTH"|"3.1d";
                          sign: "+" | "-"; totals: Gstr2bTotals; groupIndexes: number[] }[];
  itcNet?: TaxHeads<string> | "COMPUTE";                        // D-H7; default: caller must supply
}): { ok: true; value: Gstr3bDraft; issues: Gstr3bIssue[] } | { ok: false; issues: Gstr3bIssue[] };
```

- **Summing.** It sums trail entries per box, field and POS, and builds `Gstr3bReturn`. Then it runs `validateGstr3b` (§7). `ok: false` iff there is an issue with severity `error`.
- **3.2 rows.** These are aggregated per `pos` within each list and sorted by `pos`. A row whose `taxableValue` and `igst` are both `0.00` after summing is dropped.
- **Fields not in the box.** A caller entry with a field the box does not have (for example `cgst` on `3.1b`) is an error, `FIELD_NOT_IN_BOX`.
- **Duplicate entries.** Two entries for the same box are summed; both stay in the trail.

## 7. Validation — `validateGstr3b(draft | ret, options?)`

Every check below names its source. A check without a source is **not** made; it is listed in §16 instead.

| # | Check | Code | Severity | Source |
|---|---|---|---|---|
| V1 | Each box/field/POS value = Σ trail entries | `TRAIL_MISMATCH` | error | design (§3.3) |
| V2 | Money pattern, 2 dp, range and sign per SV definition (§2 table); `itc_inelg` `RUL` ≥ 0 and `OTH` signed (SV `oneOf`) | `AMOUNT_OUT_OF_RANGE`, `NEGATIVE_NOT_ALLOWED` | error | SV `#negVal`, `#nonEmptyCost`, `#nonEmptyCostITCNet` (R2) |
| V3 | `period` matches `^((0[1-9]\|1[012])((19\|20)\d\d))$` | `PERIOD_FORMAT` | error | SV `ret_period` |
| V4 | `gstin` passes the model's `GstinSchema` (loose pattern + GSTIN-capable state + mod-36) **and** SV's pattern (anchored) | `GSTIN_INVALID`, `GSTIN_NOT_ACCEPTED_BY_3B` | error | model; SV `gstin` (R3); D-H4 |
| V5 | 3.2 `pos` matches SV `#state_cd` `^(3[0-8]\|[12][0-9]\|0[1-9]\|97)$` | `POS_NOT_ACCEPTED` | error | SV `#state_cd` (R4) |
| V6 | 3.2 `pos` is also a model place-of-supply code (`isPlaceOfSupplyCode`): this rejects `25` (withdrawn) and `28` (not in the model's list) | `POS_UNKNOWN` | error | model `states.ts`; D-H5 |
| V7 | No two 3.2 rows in one list with the same `pos` | `DUPLICATE_POS` | error | design (one row per POS); SV is silent |
| V8 | 4C vs Σ4A − Σ4B, per head, when the caller supplied 4C | `ITC_NET_DIFFERS` | **warning** | **no source** (D-H7, Q-H9) |
| V9 | Caller entries have a non-empty `label` | `CALLER_LABEL_MISSING` | error | §1 principle |
| V10 | Rendered payload passes `SavePayloadSchema` | `SCHEMA` | error (a bug) | SV |

**Checks not made** (each is a question in §16):
- **CGST = SGST** per box. No source in the repo states it (Q-H10).
- **3.2 ⊆ 3.1 (a)+(b).** Not stated (Q-H11).
- **3.1.1 vs 3.1.** Not stated (Q-H12).
- **Periods.** No future-period or earliest-period check. SV allows 1900–2099, and the only stated limit is the pattern.

**Rounding to whole rupees.** No source in the repo requires it for GSTR-3B, so it is not checked or applied.

## 8. Output — `toSavePayload(ret)` (SV v7.1)

```ts
function toSavePayload(ret: Gstr3bReturn): RenderResult<SavePayload>;   // validated with SavePayloadSchema
function serializeGstr3b(payload: SavePayload): string;                  // compact JSON, raw 2-dp number literals
function parseSavePayloadJson(text: string): ParseResult<SavePayload>;   // lossless
const SavePayloadSchema;  // Zod transcription of SV, every constraint, strictObject at every level (D-H3)
```

**Key order** follows SV's property order:
- top level: `gstin`, `ret_period`, `sup_details`, `inter_sup`, `eco_dtls`, `itc_elg`, `inward_sup`, `intr_ltfee`;
- inside each object: SV's order. For example, `osup_det` is `txval, iamt, camt, samt, csamt`, and 3.2 rows are `iamt, pos, txval`, as in SV.

**Completeness (D-H3).** Every section and every fixed row is emitted, with zeros where empty:
- `sup_details`: all five objects.
- `eco_dtls`: both objects.
- `itc_avl`: five rows in the order `IMPG, IMPS, ISRC, ISD, OTH`.
- `itc_rev`: `RUL, OTH`.
- `itc_net`.
- `itc_inelg`: `RUL, OTH`.
- `isup_details`: `GST, NONGST`.
- `intr_details`.
- `inter_sup`: all three arrays, which may be empty, sorted by `pos`.

SV does not say whether a missing section means "unchanged" or "zero" (Q-H13). A complete payload depends on neither reading.

**Field mapping.** It is the reverse of §3.2:
- `taxableValue` → `txval`, `igst` → `iamt`, `cgst` → `camt`, `sgst` → `samt`, `cess` → `csamt`.
- `t5.GST.inter` → `{ ty: "GST", inter, intra }`.

**Never on the wire:**
- the trail;
- `-0.00`;
- numbers with more than 2 dp;
- lower-case GSTINs (V4).

**Conformance against the schema file (tests, §12):**
- Ajv, with `multipleOfPrecision: 2` as in `gstr1/test/helpers.ts`, compiles SV and validates every `toSavePayload` output in the suite.
- A probe walks every SV leaf (pattern, enum, min/max, `multipleOf`, `required`) and checks that `SavePayloadSchema` accepts and rejects the same boundary values. Decimal maths is used for `multipleOf`, as in `ewaybill/test/conformance.test.ts`.
- `SavePayloadSchema` is **stricter** than SV in one way only: unknown keys are rejected everywhere (§13 C3). The probe asserts this difference explicitly.

## 9. Compare — `parseAutoCalcJson` and `compareWithAutoCalc`

### 9.1 Parsing

```ts
function parseAutoCalcJson(text: string): ParseResult<AutoCalc>;
const AutoCalcSchema;  // Zod transcription of AC
```

- **Lossless and strict.** `AutoCalcSchema` transcribes `r3bautopop` with its three blocks `liabitc`, `liabitcr1` and `liabitcr1a`.
  - The blocks share one shape, except for the 35 node paths listed in §13 C5, which get per-block overrides (D-H9).
  - Money uses AC `#txamt` (signed), `#nonzerotxamt` (≥ 0) and `#negtxamt` (≤ 0), each exactly as typed per node.
  - `pos` uses AC `#pos`, which also allows `96` and the empty string (§13 C4). `form` uses `#taxperiod` / `#r2btaxprd`.
- **Unknown keys** are warnings (`UNEXPECTED_KEY`), and the raw data is kept. This is the recon §3.3 (5) approach for a Draft response schema.
- **`r3bautopop.error[]`** (`error_cd`, `error_desc`) is returned as data. A non-empty array gives the warning `PORTAL_ERRORS`, and the figures present are still compared.
- **Conformance.** A test walks AC and checks that every object path, `required` set and definition reference in all three blocks matches `AutoCalcSchema`, and that the 35 differences are encoded as in AC.

### 9.2 Diff

```ts
function compareWithAutoCalc(
  ours: Gstr3bReturn, portal: AutoCalc,
  options?: { block?: "liabitc" | "liabitcr1" | "liabitcr1a"; tolerance?: string },  // defaults: "liabitc", "0.00"
): CompareResult;

type CompareResult = {
  block: string; tolerance: string;
  meta: { r1fildt?: IsoDate; r2bgendt?: IsoDate; r3bgendt?: IsoDate; r1afildt?: IsoDate };
  boxes: { box: BoxId; pos?: string; field: string; ours: string; portal: string | null;
           difference: string | null; withinTolerance: boolean | null }[];
  uncompared: { box: BoxId; reason: "NOT_AUTO_CALCULATED" | "MAPPING_UNCONFIRMED"; portalPath?: string; portal?: Record<string,string> }[];
  detail?: { box: BoxId; acTable: string; ours: Record<string,string>; portal: Record<string,string> | null }[]; // GSTR1-sourced trail only
  issues: Gstr3bIssue[];
};
```

- **What it compares.** It compares **our box** against the **AC `subtotal`** of the matching box (§3.2 table), field by field. 3.2 is compared per `pos`: a POS on only one side is compared against `0.00` on the other.
- **The arithmetic.** `difference = ours − portal`, and `withinTolerance` is `|difference| ≤ tolerance` (absolute, per field, inclusive). This is the same convention as recon D-P2 and its legal-facts row.
- **Box missing from AC.** `portal: null`, and `difference`/`withinTolerance` are `null`.
- **Never corrects.** The result is a report. Nothing in it is ever written back into `ours`, and no function takes a `CompareResult` as input to change a return.
- **Which block.** `block` picks `liabitc`, `liabitcr1` or `liabitcr1a`. AC does not describe them (Q-H3). The default is `liabitc`, which is a choice, not a fact.
- **ITC boxes.** AC's ITC nodes are `elgitc.itc4a1`, `itc4a3`, `itc4a4`, `itc4a5`, `itc4b2` and `itc4d2`. Their pairing with SV's codes is **not stated** anywhere.
  - v0.1 proposes (D-H8): `itc4a1` ↔ `4A.IMPG` (AC `itc4a1` carries only `iamt`/`csamt`), `itc4a3` ↔ `4A.ISRC`, `itc4a4` ↔ `4A.ISD`, `itc4a5` ↔ `4A.OTH`.
  - These four are compared **only** if the caller passes `confirmItcMapping: true`; otherwise they are listed as `MAPPING_UNCONFIRMED`, with the portal values attached.
  - `itc4b2` and `itc4d2` are **always** `MAPPING_UNCONFIRMED`. Whether "4B(2)" is `itc_rev` `OTH` cannot be read from either schema (Q-H1).
  - `4A.IMPS`, `4B.RUL`, `4D.RUL`, `4C`, 5 and 5.1 have no AC node, so they are `NOT_AUTO_CALCULATED`.
- **`detail` (optional, `options.detail: true`).** For boxes with `GSTR1` trail entries, it compares our per-table contribution (`tbl4a`, …) with AC's `det.<table>`. This helps find where a box differs.
- **Field names in `det`.** AC's `det` nodes under `isup_3_1d` and `elgitc` use `igst`/`cgst`/`sgst`/`cess` instead of `iamt`/`camt`/`samt`/`csamt`. The parser maps both spellings to our names.
- **`val`.** It is parsed and never compared (§13 C10).

## 10. Exports

- **Functions:** `outwardFromGstr1`, `sumGstr2bRecords`, `assembleGstr3b`, `validateGstr3b`, `toSavePayload`, `serializeGstr3b`, `parseSavePayloadJson`, `parseAutoCalcJson`, `compareWithAutoCalc`.
- **Constants:**
  - `GSTR3B_SAVE_SCHEMA_VERSION = "7.1"`, `GSTR3B_AUTOCALC_SCHEMA_VERSION = "7.1"`
  - `BOX_IDS`
  - `AC_GSTR1_MAP`: the quoted mapping M of §4.2, as data, with its AC path per row
  - `AC_NOT_COVERED`: §4.3, as data
- **Schemas and types:** `Gstr3bReturnSchema`/`Gstr3bReturn`, `Gstr3bDraft`, `TrailEntry`, `SavePayloadSchema`/`SavePayload`, `AutoCalcSchema`/`AutoCalc`, `CompareResult`, `Gstr2bTotals`, `OutwardDerivation`, `Gstr3bIssue`/`Gstr3bIssueCode`.

## 11. Issue codes

`Gstr3bIssue = { code, severity: "error" | "warning" | "info", message, box?, pos?, path? }`.

- **Errors:**
  - `GSTR1_INVALID`, `GSTR1_GSTIN_MISMATCH`, `GSTR1_PERIOD_MISMATCH`
  - `TRAIL_MISMATCH`, `AMOUNT_OUT_OF_RANGE`, `NEGATIVE_NOT_ALLOWED`
  - `PERIOD_FORMAT`, `GSTIN_INVALID`, `GSTIN_NOT_ACCEPTED_BY_3B`
  - `POS_NOT_ACCEPTED`, `POS_UNKNOWN`, `DUPLICATE_POS`
  - `CALLER_LABEL_MISSING`, `FIELD_NOT_IN_BOX`, `SCHEMA`
  - `WRONG_TYPE` (lossless parse)
- **Unmapped (warnings):** `RCM_NOT_MAPPED`, `INTRA_ITEM_IN_32`, `INTRA_ITEM_IN_31B`, `NOTE_POS_MISSING`.
- **Other warnings:** `ITC_NET_DIFFERS`, `PERIOD_MIXED`, `RECIPIENT_MISMATCH`, `UNEXPECTED_KEY`, `PORTAL_ERRORS`, `SCHEMA_VERSION`.

## 12. Test list (Vitest; written first)

Fixtures must be synthetic and use only GSTINs registered in `packages/fixtures/src/gstins.ts`.
- **New fixture GSTIN.** One build-time addition: a GSTIN that is valid under the model (mod-36 computed) but fails SV's PAN-structured pattern. Its 13th character is `0`. It exists for V4.
- **New fixture module.** `packages/fixtures/src/gstr3b.ts` holds a synthetic `Gstr1Return`, a synthetic 2B record set (reusing the recon fixture) and a synthetic AC response.

**model / schema**
- `Gstr3bReturnSchema` rejects:
  - unknown keys at every level;
  - `"1.5"` (not 2 dp), `"-0.00"`, `"10000000000000.00"` (out of range);
  - a negative in an `Unsigned3b` field: `4B.RUL`, `4B.OTH`, `4D.RUL`, 5 and 5.1.
- It accepts negatives in `3.1*`, 3.2, `4A.*`, `4C` and `4D.OTH`.

**outwardFromGstr1 (one test per mapping row)**
- **G1–G10.** Each row places a one-document `Gstr1Return` into exactly the boxes of §4.2, with the AC table as `ref`.
- **Field restriction.** G2 adds only `taxableValue` to `3.1a`. G7 and G3 add nothing to `3.1a`.
- **3.2 placement.** G4 and G3 add nothing to 3.2. G1 adds to `3.2comp` only when `recipientTypes[ctin] = "COMPOSITION"`, to `3.2uin` only with `"UIN_HOLDER"`, and to no 3.2 list otherwise.
- **Signs.** A credit note subtracts (negative entry) and a debit note adds, in `3.1a`, `3.1b` and 3.2.
- **Note routing.** A `cdnr` `SEWP` note goes to `3.1b`. A `cdnur` `EXPWOP` note goes to `3.1b`. A `cdnur` `B2CL` note goes to `3.1a` and `3.2unreg`.
- **Unmapped.**
  - G5 and an RCM `cdnr` note are listed with `RCM_NOT_MAPPED` and add nothing.
  - An intra-state item bound for 3.2 is `INTRA_ITEM_IN_32`; it still goes to 3.1.
  - A `B2CL` note without `pos` is `NOTE_POS_MISSING`.
- **`notCovered`** equals §4.3 exactly. The test compares it with `AC_NOT_COVERED`, and also, **independently**, with the det keys read from the AC file minus the keys in `AC_GSTR1_MAP`.
- **`AC_GSTR1_MAP` vs AC.** Every row's AC path exists in the AC file, and its field set equals the AC node's leaves minus `val`/`form`.
- **Validation.** A mismatched `gstin` or `period` between `gstr1` and the assembly gives `GSTR1_GSTIN_MISMATCH` / `GSTR1_PERIOD_MISMATCH`.

**sumGstr2bRecords**
- **Grouping.** Groups by `documentType × itcavl × reverseCharge × origin × returnPeriod`. Credit notes are **not** netted.
- **No filtering.** `itcavl` `N` records are totalled like `Y` ones.
- **Warnings.** A mixed period gives `PERIOD_MIXED`, and a foreign recipient gives `RECIPIENT_MISMATCH`.
- **Exactness.** Totals are exact decimal sums, for example `0.10 + 0.20 = "0.30"`.
- **Selection.** Only the selected `groupIndexes` reach the box, with the given sign.

**assemble / trail**
- **Trail sums.** Every box equals Σ trail. A hand-edited return gives `TRAIL_MISMATCH`.
- **Caller entries.**
  - A caller entry without a label gives `CALLER_LABEL_MISSING`.
  - A `cgst` on `3.1b` gives `FIELD_NOT_IN_BOX`.
  - Two caller entries for one box are summed, and both stay in the trail.
- **3.2 rows.** They are aggregated per POS, sorted, and zero rows are dropped.
- **4C.** `itcNet: "COMPUTE"` gives Σ4A − Σ4B per head, as a `COMPUTED` entry. A supplied 4C that differs gives the warning `ITC_NET_DIFFERS` and is kept as supplied.
- **Boxes the package never fills.** Without caller entries, `3.1c`, `3.1d`, `3.1e`, 3.1.1, 4, 5 and 5.1 are all zero. No function writes them from `gstr1` data.

**validate**
- **Period.** `102026` passes. `132026`, `002026`, `10226` and `102126` fail.
- **GSTIN.**
  - A model-valid, PAN-pattern GSTIN passes.
  - The new fixture GSTIN (13th character `0`) gives `GSTIN_NOT_ACCEPTED_BY_3B`.
  - A bad check digit gives `GSTIN_INVALID`.
  - A lower-case GSTIN gives `GSTIN_INVALID` (the model).
- **POS.**
  - `29` and `97` pass.
  - `96`, `99`, `00` and `39` give `POS_NOT_ACCEPTED`.
  - `25` and `28` give `POS_UNKNOWN`.
  - A duplicate POS gives `DUPLICATE_POS`.
- **Not checked.** A return with CGST ≠ SGST in `3.1a` gives **no** issue (the check is not made, Q-H10).

**toSavePayload / conformance**
- **Full payload.** A full fixture renders to the exact expected JSON text: key order, all fixed rows, zeros as `0.00`, empty 3.2 arrays.
- **Ajv.** Ajv, compiled from the SV **file**, accepts every rendered payload in the suite.
- **Leaf probe.** For every SV leaf, boundary values are accepted or rejected identically by Ajv(SV) and `SavePayloadSchema`. Examples: `9999999999999.99`, `10000000000000.00`, `-9999999999999.99`, `0.001`, the `ty` enums and `oneOf` `itc_inelg`. Unknown keys are the one documented difference.
- **Lossless.** `9999999999999.99` and `-0.01` survive `serializeGstr3b` → `parseSavePayloadJson` unchanged. `1180` parses to `"1180.00"`. `1e3`, `"10.00"` (a string) and `10.005` are errors.

**compare**
- **Our own return.** A fixture AC built from our own return diffs to all-zero with `withinTolerance: true`.
- **Tolerance.** A 0.50 difference is outside tolerance `"0.00"` and within `"1.00"`. `|−1.00| ≤ 1.00` is inclusive.
- **3.2.** A POS present only on the portal compares against `0.00` on our side.
- **ITC boxes.**
  - With `confirmItcMapping: false`, the four ITC boxes are listed as `MAPPING_UNCONFIRMED`.
  - With `true`, they are compared.
  - `itc4b2` and `itc4d2` are always `MAPPING_UNCONFIRMED`.
- **Blocks.**
  - `block: "liabitcr1"` reads that block.
  - A `liabitcr1` with `osup_3_1b.det.ims_9b_cn_eb2b` as an **array** parses, while the same node as an array in `liabitc` is a schema error (C5).
- **Portal errors.** `error[]` gives `PORTAL_ERRORS` and still compares.
- **Detail.** With `detail: true`, our `tbl4a` contribution is compared with AC `det.tbl4a`.
- **No mutation.** The input return is unchanged after compare (deep-equal before and after).

**AC parse / conformance**
- **Structure.** Every object path, `required` set and `$ref` in all three AC blocks matches `AutoCalcSchema`, including the 35 per-block differences of C5.
- **`pos`.** AC `#pos` accepts `96` and `""`; both parse. Comparing a portal 3.2 row with POS `96` gives the issue `POS_NOT_ACCEPTED` on the portal side, and that row is not compared.
- **Dates.** `29-02-2024` is accepted and `31-04-2026` is rejected.

## 13. Source observations and contradictions (R1–R6 confirmed or corrected)

- **R1** is confirmed. The table labels are inferred from AC key names, because SV itself names no table numbers (§3.2 caveat).
- **R2** is confirmed, with two corrections:
  - `itc_inelg` `OTH` is `#negVal` (signed). Only `RUL` is `#nonEmptyCost`.
  - `#txval` is defined but unused.
- **R3** is confirmed. The pattern is also **unanchored**: it has no `^`/`$`. Because it is exactly 15 characters long and `minLength`/`maxLength` are both 15, it acts as a full match.
- **R4** is confirmed for SV. AC's `#pos` differs (C4).
- **R5** is confirmed, with a caveat. The mapping is carried **only by key names**: AC has no description on any table node. The sub-row suffixes are undefined (Q-H2), and the sign convention is implied only by `#negtxamt` (Q-H7).
- **R6** is confirmed. AC is 1,492,895 bytes, and no GSTIN-shaped values are in it.

**Contradictions and anomalies:**
- **C1. No late fee in "5.1".**
  - SV `intr_ltfee` contains only `intr_details` (interest by head). Its name suggests late fee, but SV has no late-fee field.
  - The package models interest only, and late fee is deferred until a source shows where it goes.
- **C2. Copy-paste descriptions in SV.**
  - `itc_avl.ty`, `itc_rev.ty` and `isup_details.ty` all say "Identifer if Goods or Services"; `itc_inelg.ty` has no description.
  - The `itc_net` fields say "Amount of ITC reversal of …".
  - The 3.1 fields say "available in the current month".
  - The descriptions cannot be used to give the codes a meaning (Q-H1).
- **C3. SV is loose on unknown keys and types.**
  - The top level has no `type` and no `additionalProperties`.
  - `eco_dtls` and its children have no `type: "object"`.
  - Only `inter_sup` and `itc_net` forbid extra keys.
  - We reject unknown keys everywhere, as CLAUDE.md requires.
- **C4. POS patterns disagree.**
  - SV `#state_cd` (3.2): `^(3[0-8]|[12][0-9]|0[1-9]|97)$`, exactly 2 characters. It has no `96`.
  - AC `#pos`: `(^(3[0-8]|[12][0-9]|0[1-9]|9[67])$)*`, length 0–2. It allows `96` and, through `*` with `minLength 0`, the empty string.
  - Both allow `25` and `28`. The model withdraws `25` as POS and has no `28`.
- **C5. The three AC blocks are not the same shape.** 35 object/array paths differ:
  - `liabitc.sup_details.osup_3_1b.det.ims_{9b_cn,9c_cn,9a_9c_dn}_{eb2b,ec2b}` are **objects**; in `liabitcr1`/`liabitcr1a` they are **arrays**.
  - `osup_3_1b.det_q.ims_*_{eb2b,ec2b}` exist only in `liabitc`.
  - `esup_3_1_1a.det_q.ims_*_{eb2b,ec2b}` exist only in `liabitc`.
  - `esup_3_1_1a.det_q.tbl11{a,b,c,d}_5` are objects in `liabitc`/`liabitcr1` but arrays in `liabitcr1a`.
  - `osup_3_1a.det_q.tbl11_i_*` / `tbl11_ii` are missing from `liabitcr1`.
  - `inter_sup.osup_comp_3_2.det_q.tbl11{a,b,c,d}_1_5` are missing from `liabitcr1a`.
- **C6. Inconsistent `required` in AC.**
  - Most `det_q` items require `form`, but the `ims_*_{eb2b,ec2b}` `det_q` items and the `esup_3_1_1a.det` arrays do not.
  - The `det` nodes have no `required` at all, except `itc4a5.det` (`itcavl`) and `itc4d2.det` (`itcunavl`).
- **C7. One odd sign in AC.** `esup_3_1_1a.det.tbl15urp2ba[].csamt` is `#negtxamt` (≤ 0), while its sibling fields are signed `#txamt`.
- **C8. Name vs range.** AC `#nonzerotxamt` has `minimum: 0`, so it allows zero.
- **C9. Unused definition.** SV `#txval` is never referenced.
- **C10. `val` is undefined.** Every AC row has `val`, described only as "val". It is never in `required`, and it is not in SV. We parse it and never use it.
- **C11. GSTIN patterns differ across schemas.**
  - SV/AC use the PAN-structured pattern, which accepts lower case.
  - The model uses the loose official e-invoice pattern plus mod-36.
  - `gstr1` S5 `#gstin` is PAN-structured too, as in gstr1 `SUPPLIER_GSTIN_FORMAT`.
- **C12. Typo.** AC has "Stae/UT tax" twice. It is harmless.
- **C13. No ITC row for 4A(2), 4B(1) or 4D(1) in AC.** AC `elgitc` has `itc4a1`, `itc4a3`, `itc4a4`, `itc4a5`, `itc4b2` and `itc4d2` only. SV has five 4A rows, two 4B rows and two 4D rows, and the pairing is unstated (Q-H1, D-H8).
- **C14. Draft status.** Both schemas are **Draft** on the portal. A final version supersedes this spec.

## 14. Deferred

- QRMP / quarterly (`det_q`, `form`, IFF); GSTR-1A (`liabitcr1a` is only parsed).
- GSTR-1 tables `4C`, `4F`, `5B`, 8, 9A, 9C, 10, 11, 14, 15 and the IMS rows. These arrive as `gstr1` grows; until then they are caller input.
- Late fee (C1). Interest computation. Payment, offset and filing APIs (2271, 2272), and the "Validate against AutoCalculated" API (3198).
- 3.2 for UIN holders from model data. The model has no `UIN_HOLDER` (model §12), so it is caller input through `recipientTypes`.
- Rounding to whole rupees; CGST = SGST; 3.2 ⊆ 3.1. Each waits on a source (§16).

## 15. Decisions (proposed; owner to approve) — each **UNVERIFIED — needs CA**

- **D-H1. Internal model mirrors SV; codes stay codes.**
  - `Gstr3bReturn` has every SV box, always present, with zeros.
  - ITC and inward rows are keyed by SV's `ty` codes (`IMPG`, `IMPS`, `ISRC`, `ISD`, `OTH`, `RUL`, `GST`, `NONGST`), never by guessed meanings.
  - *Recommend: approve.*
- **D-H2. Provenance trail.**
  - Every amount is a trail entry: `GSTR1`, `GSTR2B_SUM`, `CALLER` (labelled) or `COMPUTED`.
  - A box equals the sum of its entries.
  - Boxes that need a tax decision accept no `GSTR1` entries.
  - *Recommend: approve.*
- **D-H3. Complete payload.**
  - `toSavePayload` emits every section and every fixed row, with zeros, in SV order.
  - `SavePayloadSchema` rejects unknown keys although SV mostly does not.
  - *Recommend: approve.* Q-H13 asks whether the portal treats omission as "unchanged".
- **D-H4. GSTIN: both the model and SV.**
  - The filer GSTIN must pass the model's `GstinSchema` **and** SV's PAN-structured pattern, as gstr1 `SUPPLIER_GSTIN_FORMAT` already does.
  - Lower case is rejected because of the model, although SV allows it.
  - *Recommend: approve; **needs CA**.* Can a GSTR-3B filer ever hold a GSTIN outside the PAN structure? (Q-H14)
- **D-H5. 3.2 POS: both SV and the model.**
  - SV `#state_cd` **and** `isPlaceOfSupplyCode`. This rejects `25` (withdrawn) and `28` (not in the model), although SV accepts both.
  - *Recommend: approve; **needs CA**.* Are `25`/`28` ever needed in 3.2 for current periods?
- **D-H6. GSTR-1 derivation rules** (§4). *Recommend: approve (a)–(e), each flagged; **needs CA**, and F4 to source mapping G.*
  - (a) Mapping G rows G1–G10 as proposed. G5 and RCM notes are unmapped.
  - (b) Credit notes are negative, debit notes positive.
  - (c) A 9B note follows its invoice type: `R`/`DE`/`B2CL` → `3.1a`; `SEWP`/`SEWOP`/`EXPWP`/`EXPWOP` → `3.1b`. A note goes into 3.2 only if its invoice type's table feeds 3.2 (`R` → 4A; `B2CL` → 5A).
  - (d) Only IGST items enter 3.2, which has no `camt`/`samt`.
  - (e) Composition and UIN-holder status comes only from `ctx.recipientTypes`. It is never inferred from a GSTIN.
- **D-H7. 4C.**
  - 4C is caller input by default. `itcNet: "COMPUTE"` gives Σ4A − Σ4B per head, recorded as `COMPUTED`.
  - A supplied 4C that differs is only a **warning**, because no source states the formula.
  - *Recommend: approve; **needs CA** (Q-H9).*
- **D-H8. Compare scope.**
  - Box level against AC `subtotal`. Default block `liabitc`. Default tolerance `"0.00"` (absolute, inclusive).
  - The ITC pairings `itc4a1`/`3`/`4`/`5` ↔ `IMPG`/`ISRC`/`ISD`/`OTH` apply only with `confirmItcMapping: true`.
  - `itc4b2`/`itc4d2` are never paired.
  - Nothing is ever auto-corrected.
  - *Recommend: approve; **needs CA** on the pairings (Q-H1) and on a customary tolerance (Q-H15).*
- **D-H9. AC parsing.**
  - Full strict Zod transcription with per-block overrides for C5. Unknown keys are warnings.
  - *Recommend: approve.* The alternative is to transcribe only `subtotal` nodes and keep `det`/`det_q` raw. That is smaller, but it loses the `detail` diff.
- **D-H10. Periods.**
  - Monthly only. Any SV-valid `MMYYYY` is accepted.
  - When `gstr1` is used, its own limit (≥ `052025`) applies through `buildGstr1`.
  - *Recommend: approve.*
- **D-H11. 2B helper.**
  - Groups, never filters, never nets, never picks a 4A row. The caller passes chosen groups with a sign.
  - *Recommend: approve.*

## 16. Open questions

**For the CA, in priority order.** v0.1 defaults are in brackets.
1. **Q-H1. Meaning and pairing of codes.**
   - What do the `itc_avl` codes `IMPG`, `IMPS`, `ISRC`, `ISD`, `OTH` mean?
   - What do `itc_rev`/`itc_inelg` `RUL`/`OTH` and `isup_details` `GST`/`NONGST` mean?
   - Do AC `itc4a1`/`itc4a3`/`itc4a4`/`itc4a5`/`itc4b2`/`itc4d2` correspond to `IMPG`/`ISRC`/`ISD`/`OTH`/`itc_rev OTH`/`itc_inelg OTH`?
   - [Codes only; the pairing is opt-in; 4B2/4D2 are unpaired.]
2. **Q-H7. Sign convention.** Are credit notes and Table 11 adjustments subtracted from the 3.1 / 3.2 boxes? [Yes, as negative entries.]
3. **Q-H9. 4C formula.** Is 4C = 4A − 4B per head, and may it be negative (SV allows it)? [Warning only.]
4. **Q-H10. CGST = SGST.** Must CGST equal SGST in each 3B box? [Not checked; no source.]
5. **Q-H4. RCM notes and non-R RCM invoices.** Where do RCM credit/debit notes (9B) go, and RCM SEZ/deemed-export invoices? [Unmapped; caller input.]
6. **Q-H5. 5A vs 5B.** Is every `b2cl` invoice without an e-commerce operator Table 5A? [Yes, G6.]
7. **Q-H6. 7A(1) / 7B(1).** Is an intra-state B2CS row Table 7A(1) and an inter-state row 7B(1)? [Yes, by shape.]
8. **Q-H8. Table 8 split.** How does GSTR-1 Table 8 split between 3.1 (c) and 3.1 (e)? [Caller input.]
9. **Q-H11 / Q-H12.** Should 3.2 be within 3.1 (a)+(b)? How does 3.1.1 relate to 3.1? [Not checked.]
10. **Q-H14.** D-H4: can a 3B filer hold a non-PAN-structured GSTIN?
11. **Q-H15. Tolerance.** Is a tolerance against the auto-calculated figures customary, and how large? [Exact.]

**For the owner / GSTN documentation:**
- **Q-H2.** What do the AC suffixes mean: `_1`, `_1_2_4`, `_3`, `_5`, `_4_5`, `_1_5`, `SezEco`, `urp2b`, `eb2b`, `ec2b`, `b2ba`, `ims_*`, `tbl14b_A`? (F3)
- **Q-H3.** What are `liabitc`, `liabitcr1` and `liabitcr1a`, and which should a filer compare against? [`liabitc`.] (F2)
- **Q-H13.** Does Save GSTR3B replace the whole return, or merge, so that an omitted section means "unchanged"? [Moot: we always send everything.] (F2)
- **Q-H16.** Where does late fee go in v7.1, if anywhere (C1)? (F1, F2)
- **Q-H17.** Is there a payload size limit for Save GSTR3B? [None applied.] (F2)

## 17. Files to attach (to `sources/gstr3b/` unless noted)

| # | File | Settles |
|---|---|---|
| F1 | The notified **Form GSTR-3B** with its table headings and instructions (CGST Rules, rule 61; PDF from `cbic-gst.gov.in`, which is reachable from the build environment) | Table labels ↔ SV keys (§3.2); the code meanings (Q-H1); 4C formula (Q-H9); 3.2 scope (Q-H11); late fee (Q-H16); CGST = SGST (Q-H10) |
| F2 | GSTN API documentation pages (description, sample JSON, error codes) for **Save GSTR3B (2269) v7.1** and **Get ITC Liability Auto Calc (3183) v7.1**, from developer.gst.gov.in | Q-H3, Q-H13, Q-H17; `val` (C10) |
| F3 | GSTN advisory / FAQ / manual on **auto-population of GSTR-3B from GSTR-1/1A/IFF and GSTR-2B** (tutorial.gst.gov.in or gst.gov.in, captured by hand) | Q-H2, Q-H7; confirms R5 row by row |
| F4 | The notified **Form GSTR-1** table instructions (4A/4B/4C/5A/5B/6A/6B/6C/7A/7B/9B), to `sources/gstr1/` | Mapping G (§4.1, D-H6) |
| F5 | *(Optional)* The "Validate GSTR3B against AutoCalculated data" (3198) request/response schema | Whether the portal applies a tolerance (Q-H15) |

Without F4, mapping G stays a flagged proposal (D-H6). Without F1–F3, the ITC compare stays opt-in (D-H8). Neither blocks the build of the rest. No list that the package **enforces** depends on F1–F5: V2–V6 come from SV and the model.

## 18. `docs/legal-facts.md` rows to add (at build time)

Each row: source `sources/gstr3b/…` (developer.gst.gov.in, Draft v7.1, retrieved 2026-10-18), status UNVERIFIED — needs CA.

| Fact | File |
|---|---|
| GSTR-3B Save payload shape = SV v7.1 (all sections; complete payload, D-H3) | `packages/gstr3b/src/save-payload.ts` |
| SV money ranges and signs per box (`#negVal`, `#nonEmptyCost`, `#nonEmptyCostITCNet`; `itc_inelg` `oneOf`) | `save-payload.ts` |
| `ret_period` `MMYYYY` pattern (SV/AC) | `src/primitives.ts` |
| Filer GSTIN = model `GstinSchema` ∧ SV PAN-structured pattern (D-H4) | `src/validate.ts` |
| 3.2 POS = SV `#state_cd` ∧ model place-of-supply code; 25 and 28 rejected (D-H5) | `validate.ts` |
| SV `ty` codes `IMPG/IMPS/ISRC/ISD/OTH`, `RUL/OTH`, `GST/NONGST` used as codes, meanings not assumed (D-H1, Q-H1) | `src/return-schema.ts` |
| GSTR-1 table → 3B box mapping M as stated by AC key names (R5) | `src/ac-map.ts` |
| Our `gstr1` data → GSTR-1 table mapping G (G1–G10), note signs and routing (D-H6) — proposal pending F4 | `src/outward.ts` |
| 4C computed as Σ4A − Σ4B only on request; mismatch is a warning (D-H7) | `src/assemble.ts` |
| AC block default `liabitc`; tolerance default exact; ITC pairing opt-in (D-H8) | `src/compare.ts` |
| AC `#pos` allows 96 and empty; portal rows with such POS are not compared (C4) | `src/autocalc-schema.ts` |

## 19. Changeset plan

- **This spec PR:** no changeset (docs only).
- **Build PR:**
  - `.changeset/gstr3b-initial.md` with `"@india-gst-kit/gstr3b": minor`: "Initial release: assemble a GSTR-3B (Save v7.1) from GSTR-1-derived outward figures and caller-supplied ITC, reversal, ineligible, inward and interest figures, with a provenance trail; validate, render and parse the Save payload losslessly; parse the Auto Calc v7.1 response and diff it per box with a caller tolerance. Never decides taxability, ITC eligibility, reversals, interest or late fee."
  - `packages/fixtures` gets the new GSTIN and `gstr3b.ts`. It is private and ignored by changesets.
  - If the build needs an export that `gstr1` or `recon` does not have yet, that export goes in with its own `patch` changeset. Candidates are `InvoiceTypeSchema` and `NoteTypeSchema`, which are not exported from `gstr1` today.
  - Docs in the same PR: a `CLAUDE.md` layout line for `packages/gstr3b` (Track G, spec `docs/specs/gstr3b.md`), and the §18 rows in `docs/legal-facts.md`.

## 20. Stop conditions (build session)

- SV or AC contradicts this spec → follow the source, and report it under "Deviations".
- A G-row (D-H6) or an ITC pairing (D-H8) would have to become **enforced** (an error, not a flagged proposal) without F4 / F1–F3 → stop.
- `pnpm check` cannot go green without weakening strictness or lint rules → stop.
