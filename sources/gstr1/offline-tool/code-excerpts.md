# GST Offline Tool — code excerpts (GSTR-1 upload JSON)

- Source: `GST Offline Tool.exe` inside https://tutorial.gst.gov.in/offlineutilities/returns/gst_offline_tool.zip (zip SHA-256 `f0a7d6f66bf71b30e9ecd045a664dda428c8fac239f51127d656e6faac60e312`; tool release 3.2.4). Unpacked with `innoextract` 1.9, read only, never run.
- Retrieved: 2026-10-16
- Status: **UNVERIFIED — needs CA**. Secondary source: the authoritative schema is `../gstr1-save-v5.0-schema.json` (GSTR1 – Save GSTR1 data v5.0). Where the tool's output differs from it, v5.0 wins (`docs/specs/gstr1.md` §11).
- Hashes of the files quoted: `app/utility/returnStructure.js` `b29f8951…f645c`, `app/service/offline.js` `5ab8d3d9…53962`, `app/utility/common.js` (not hashed separately; same installer), `app/utility/constants.js` `73465d57…a3fe8`. Full hashes in `../README.md`.

Short fragments only; the tool's code is not redistributed. Line numbers refer to the files as unpacked. "**[infer]**" marks a conclusion drawn from reading the code, not something it shows directly.

## 1. How the upload file is produced

1. Records are normalised by `formateNodePayload` (`returnStructure.js:4420`) and saved into a working JSON (`offline.js:2056+`). The empty starting document comes from `common.js:155-215`.
2. `/generateFile` (`offline.js:4038`). The "New" flow (`type:"N"`) runs `offline.js:5314-5554`:
   - `omitEmpty` (5349) removes `null`, `undefined`, `""`, `[]` and `{}`, and keeps `0` and `false`. Package `omit-empty@0.4.1`.
   - `fixUQC` (5350): `uqc` becomes the code before `-`.
   - `removeCName` (5352-5387): drops `cname` from b2b/cdnr groups.
   - `fixOldNum` (5394-5403).
   - `fixDiffVal` (5407-5422): drops `diffval`; drops `diff_percent` unless it is `0.65`.
   - `fixPOS` on b2cs (5427).
   - `flatObject*` (5432-5458): forces zero IGST and cess on SEWOP/WOPAY/EXPWOP.
   - IFF filter (5464-5470).
   - Size check against `4.7 * 1024 * 1024` bytes (`offline.js:42`), then chunking (`common.js:240+`).
3. The browser's download step (`returns1.ctrl.js`/`returns.ctrl.js:1053-1400`) also deletes `supplierRecipientName`, `registrationStatus` and `isNotAdded`, plus `productName` and `invalidhsnCode` on HSN rows. The file this step saves is the one the user uploads.

## 2. Header — `common.js:159-169`, `:174-200`

```js
var HSN_BIFURCATION_START_DATE = "052025";
var version = "GST3.2.4";
var hash = "hash";
var gt = parseInt(req.body.gt);
```
- The template starts with `{"gstin": …, "fp": "MMYYYY", ["gt", "cur_gt",] "version", "hash", "b2b":[], "b2ba":[], "b2cl":[], …, "doc_issue":{"doc_det":[]}, "hsn":{…}, …}`.
- `gt` and `cur_gt` are emitted only when numeric. The dashboard asks for them only for FY 2017-18 (`returns.ctrl.js:2153-2175`).
- `hsn` is `{"data":[]}` for fp before `052025`, and `{"hsn_b2b":[],"hsn_b2c":[]}` from then on.

## 3. Sections

### b2b — `returnStructure.js:466-490` (invoice), `:3008-3041` (item), `:4425-4470` (grouping)
```js
"inum": …, "idt": …, "val": cnvt2Nm(…), "pos": (…).substring(0, 2), "rchrg": …,
"diff_percent": …, "etin": …, "inv_typ": getInvType(iSec, …), "ctin": …, "itms": [itemFn(i, inv)]
```
```js
tempNum = inv['Rate'] * 100 + 1; // now minimum 0 is required
if (dashGstin == inv['Place Of Supply'].substring(0, 2) && (invType == 'R' || invType == 'DE') && !isSEZ) {
    return { "num": tempNum, "itm_det": { "txval": …, "rt": inv['Rate'], "camt": …, "samt": …, "csamt": … } }
```
- Output: `b2b: [{ ctin, inv: [{ inum, idt, val, pos, rchrg, inv_typ, [etin], [diff_percent], itms: [{ num, itm_det: { txval, rt, iamt | camt+samt, csamt } }] }] }]`.
- `inv_typ` codes come from `public/data/invtypesforb2b.json`: `R`, `DE`, `SEWP`, `SEWOP`, `CBW`.
- CBW requires `rchrg = Y`; DE requires `rchrg = N` (`:5451-5466`).

### b2cl — `returnStructure.js:629-669`, grouping `:4470-4497`
- Output: `b2cl: [{ pos, inv: [{ inum, idt, val, [etin], [diff_percent], itms: [{ num, itm_det: { txval, rt, iamt, csamt } }] }] }]`.
- Threshold (`returnStructure.js:8696-8706`; `constants.js`: `B2CL_MIN_VAL = 100000`, `B2CL_MIN_VAL_STR_PRD = "082024"`):
```js
if (Number(fp.substring(2) + fp.substring(0,2)) < Number("082024".substring(2) + "082024".substring(0,2)) && (… 'b2cl' || 'b2cla'))
    setInvoiceValueLimit = 250000;
else setInvoiceValueLimit = constants.B2CL_MIN_VAL;
if (inv['Invoice Value'] <= setInvoiceValueLimit && (iSecID == 'b2cl' || iSecID == 'b2cla')) isInvalidInvoice = true;
```
  The same rule is in the UI at `returns1.ctrl.js:122-131`. The message reads "Invoice value needs to be greater than ₹…".
- B2CL must be inter-state: a row where POS equals the supplier state is rejected, unless the supplier is SEZ (`returnStructure.js:8806-8820`, `9023-9034`).

### b2cs — `returnStructure.js:1181-1255`
```js
if (pos == dashGstin && !isSEZ) { intraObj = { "sply_ty": "INTRA", "rt": …, "typ": inv['Type'], "etin": …, "pos": pos,
    "diff_percent": …, "txval": …, "camt": cnvt2Nm(txval * rt * 0.005 * diff), "samt": …, "csamt": … };
```
- Output: flat rows `{ sply_ty, rt, typ, [etin], pos, [diff_percent], txval, iamt | camt+samt, csamt }`.
- Excel `Type` must match `/^(OE)$/` (`:5590`).
- A row is keyed by pos + rt + etin + diff_percent; a later row replaces the earlier one (`offline.js:2358-2400`).
- Amount patterns for b2cs allow a leading `-`. The official `b2cs.csv` sample has a negative taxable value.

### cdnr — `returnStructure.js:940-1014`, item `:3092-3180`
- Output: `cdnr: [{ ctin, nt: [{ nt_num, nt_dt, ntty, val, pos, rchrg, inv_typ, [diff_percent], itms: [{ num, itm_det }] }] }]`.
- `ntty` must match `/^(C|D)$/` (`:9306`).
- Amounts are non-negative. Note value ≥ 0, txval > 0 and cess ≥ 0 are checked at `:5652-5654`. The direction is carried only by `ntty`.

### cdnur — `returnStructure.js:1016-1058`, item `:3183-3207`
```js
"nt_num": …, "nt_dt": …, "ntty": …, "val": cnvt2Nm(…), "typ": inv[trans.LBL_UR_TYPE],
"pos": (inv[…POS…]) ? (…).substring(0, 2) : …, "diff_percent": …, "itms": [itemFn(i, inv)]
```
- Output: flat `{ nt_num, nt_dt, ntty, val, typ, [pos], [diff_percent], itms: [{ num, itm_det: { txval, rt, iamt, csamt } }] }`.
- `typ` must match `/^(B2CL|EXPWP|EXPWOP|)$/` (`:9311`).
- `B2CL` needs a POS that differs from the supplier state (`:5417-5427`).
- `EXPWP`/`EXPWOP` have no POS (`:5403-5414`).
- On `EXPWOP`, `iamt` and `csamt` are forced to 0 (`offline.js:5624-5637`).

### exp — `returnStructure.js:858-872`, item `:3288-3304`
```js
"exp_typ": …, "inum": …, "idt": …, "val": …, "sbpcode": …, "sbnum": …, "sbdt": …, "diff_percent": …, "itms": [itemFn(i, inv)]
…
return { "txval": cnvt2Nm(…), "rt": inv['Rate'],
         "iamt": (inv["Export Type"] == "WOPAY") ? 0 : parseFloat((txval * rt * 0.01 * diff).toFixed(2)),
         "csamt": (inv["Export Type"] == "WOPAY") ? 0 : cnvt2Nm(inv['Cess Amount']) }
```
- Output: `exp: [{ exp_typ: "WPAY"|"WOPAY", inv: [{ inum, idt, val, [sbpcode], [sbnum], [sbdt], itms: [{ txval, rt, iamt, csamt }] }] }]`.
- Export items have **no `num` and no `itm_det`**.
- Shipping bill number matches `/^[0-9]{3,7}$/`; port code matches `/^[a-zA-Z0-9]{1,6}$/`. If either the shipping bill number or its date is given, both are required (`:5774-5806`).

### hsn — `returnStructure.js:1468-1577`, formatter `:4685-4741`
- fp from `052021` (`newHSNStartDateConstant`, `:35`), row = `{ num, hsn_sc, desc, uqc, qty, rt, txval, iamt, camt, samt, csamt }`.
- fp from `052025`: rows go into `hsn.hsn_b2b[]` and `hsn.hsn_b2c[]` and add `user_desc` (the user's text). `desc` comes from the tool's HSN master.
- `qty = Number(qty)` (`:4691`). `uqc` is the code part only (`fixUQC`).
- For an HSN starting `99` the UI forces `uqc = "NA"` and `qty = 0` (`returns1.ctrl.js:268-274`).
- A row is keyed by hsn_sc + rt + uqc. `num` is a running number (`offline.js:3028-3256`).
- No code derives `hsn_b2b`/`hsn_b2c` from the other sections. The user fills them as two tables ("HSN-wise summary … (B2B) - 12" and "(B2C) - 12", `returns.fct.js:526-544`).
- HSN length (`:5940-5961`): 6–8 digits if AATO > ₹5 Cr, otherwise 4–8. HSN(b2b)/(b2c) codes must also be in the tool's master `public/data/HSN.json` (`:6040-6044`).

### doc_issue — `returnStructure.js:1599-1611`, item `:3305-3318`
```js
var docDetails = ["Invoices for outward supply", "Invoices for inward supply from unregistered person", "Revised Invoice",
  "Debit Note", "Credit Note", "Receipt Voucher", "Payment Voucher", "Refund Voucher", "Delivery Challan for job work", …];
comonObj = { "doc_num": docDetails.indexOf(inv['Nature of Document']) + 1, "doc_typ": inv['Nature of Document'], "docs": [itemFn(i, inv)] };
…
return { "num": parseInt(i), "from": ….toString(), "to": ….toString(), "totnum": parseFloat(…), "cancel": parseFloat(…),
         "net_issue": parseFloat(inv['Total Number'] - inv['Cancelled']) }
```
- Output: `doc_issue: { doc_det: [{ doc_num, doc_typ, docs: [{ num, from, to, totnum, cancel, net_issue }] }] }`.
- **[infer]** `doc_typ` survives into the file because `fixDoc` returns early for objects (`offline.js:1155`: `if (!data || !data.length) return data;`).
- `from`/`to` match `/^(?=.{1,16}$)([/\-0]*[a-zA-Z0-9/\-]*[a-zA-Z1-9]+[a-zA-Z0-9/\-]*)$/` and `totnum ≥ cancel` (`:6141-6146`).

## 4. Common rules

- Number helper (`returnStructure.js:9-18`): `cnvt2Nm(s)` = `parseFloat(parseFloat(s).toFixed(2))`. **[infer]** This is binary-double `toFixed`, not decimal half-up.
- Tax is computed per item (one rate per item): `iamt = txval*rt/100`; `camt = samt = txval*rt*0.005`, each rounded on its own (Excel import `:3008-3304`; UI `returns.fct.js:2251-2318`). The UI lets the user edit the amounts but rejects `camt != samt` (`returns1.ctrl.js:4395-4415`).
- Intra vs inter (`getSupplyType`, `:8392-8430`): intra when POS equals the supplier state and the supplier is not SEZ. SEWP, SEWOP and CBW are always inter.
- Document/note number matches `/^[a-zA-Z0-9-\/]{1,16}$/` and must not be all zeros (`:9308`, `:5497`).
- Dates are emitted as `DD-MM-YYYY`. A date must be ≤ the last day of the return period and ≥ 01-07-2017 (`:9110-9126`).
- Excel rates match `/^(0|0.25|0.1|0.10|1|1.5|1.50|3|5|6|7.5|7.50|12|18|28|40)$/` (`:9312`). `public/data/rate.json` `CommGST` has the same set.
- `diff_percent` (`/^(100|65)$/` in Excel) is stored as 1.00 or 0.65 and written only when 0.65.
- POS: Excel accepts 01–38, 96 and 97 (`:8472-8476`). The UI offers 96 "Foreign Country" only in b2b/b2ba/cdnr/cdnra (`returns1.ctrl.js:548-560`).
- Recipient GSTIN (b2b/cdnr) must pass a PAN-structured GSTIN, UIN, TDS or NRTP pattern **and** a mod-36 check character (`returnStructure.js:330-414`).
- Values are JSON numbers. `pos`, `ctin`, `inum`, `idt`, `nt_num`, `sbnum` and `hsn_sc` are strings.
