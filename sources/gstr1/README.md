# GSTR-1 sources (Track A)

Captured **2026-10-16** from this machine in India. Status of every fact taken from these files: **UNVERIFIED — needs CA**, until signed off in `docs/legal-facts.md`.

## Authoritative schema: GSTR1 – Save GSTR1 data, v5.0

| File | Official page | Version / published | Downloaded | SHA-256 |
|---|---|---|---|---|
| `gstr1-save-v5.0-schema.json` | https://developer.gst.gov.in/apiportal/taxpayer/returns → View API List → "GSTR1 - Save GSTR1 data" → v5.0 → Request Payload → Download Schema | **v5.0 (FINAL), published 23-02-2026** — as shown on the portal page; the file itself carries no version or date | 2026-10-16, by hand in a browser (the page is behind a bot challenge) by the owner | `51c7381fb50688a8b1796dabe0ec57d85da06be4287ed61f50c592cfdf2ca1e5` |
| `gstr1-save-v4.1-schema.json` | same page → "GSTR1 - Save GSTR1 data" → v4.1 → Request Payload → Download Schema | **v4.1, published 04-02-2025** (portal page); superseded by v5.0, kept for comparison | 2026-10-16, by hand, by the owner | `db2c0313b8596a1fe88832202374cf2889595ad8dceb5f4730d3ab2b03543457` |

- Both files are verbatim, with LF line endings, marked `-text` in `.gitattributes`. Sizes: v5.0 354,390 bytes (byte-identical to the browser download `GSTR1 - Save GSTR1 data request_schema.json`); v4.1 206,868 bytes.
- **No GSTINs** in either file: the only 15-character digit runs are the numeric maximums `999999999999999…`. Nothing to redact.
- **v5.0 is authoritative** for `docs/specs/gstr1.md`. v4.1 and v1.1 (the version named by the troubleshooting guide, `portal-faq-excerpts.txt` Issue No. 11; not captured) are superseded. The v4.1 → v5.0 differences are summarised in the spec §4.2.
- **No sample payload** was offered on the portal for either version.
- Publisher quirks, kept as published (v4.1 has the same `if`/`then` quirk):
  - `properties` contains keys named `"if"` and `"then"`. They look like a misplaced conditional for `hsn` with `flag: "D"`. As written, they only declare two optional top-level properties called `if`/`then`.
  - `b2cl[].inv` carries `additionalProperties` on an array.
  - `doc_issue.doc_det_new[].doc_num` has `minimum`/`maximum` on a string.
  - The GSTIN/`ctin` patterns have no `^…$` anchors; `minLength = maxLength = 15` makes them whole-string in effect.

## Offline tool (secondary source)

The JSON produced by the **official GST Offline Tool 3.2.4** was the interim source before the schema was attached. It is kept because the classification rules, thresholds and value conventions come from it and from the Excel template help. Where its output differs from v5.0, v5.0 wins (`docs/specs/gstr1.md` §11). The tool's output is **v4.1-shaped**: `doc_issue.doc_det` with an integer `doc_num`, and `etin` allowed (spec §4.3).

## Files

| File | Official origin | Notes | SHA-256 |
|---|---|---|---|
| (not stored) `gst_offline_tool.zip` | https://tutorial.gst.gov.in/offlineutilities/returns/gst_offline_tool.zip, linked from https://www.gst.gov.in/download/returns ("Returns Offline Tool") | 29,217,506 bytes, `Last-Modified: Wed, 30 Sep 2026 16:04:13 GMT`. Contains the files below plus the installer and two Excel templates. Too large to commit; re-download and compare the hash. | `f0a7d6f66bf71b30e9ecd045a664dda428c8fac239f51127d656e6faac60e312` |
| (not stored) `GST Offline Tool.exe` | in the zip | Inno Setup 5.5.3 installer (2026-09-24). Unpacked with `innoextract` 1.9 for reading only, never run. Contains a Node/AngularJS app; the upload JSON is built in `app/utility/returnStructure.js` and `app/service/offline.js`. | `7b4b89faf1f2ffe17839d6baefd3558fb3ad282f4b5aef764652615fbe9efb0a` |
| (not stored) `app/utility/returnStructure.js` | inside the installer | Source of the JSON key names and section rules; cited by line in `offline-tool/code-excerpts.md` | `b29f8951195f2437a9b3c13fd52653ce2a3090e31a39ada3ca32177d389f645c` |
| (not stored) `app/service/offline.js` | inside the installer | JSON file generation (`generateFile`) | `5ab8d3d962e883ee5f8916b10d441fb341a426464b97346c04a4255211353962` |
| (not stored) `app/utility/constants.js` | inside the installer | `B2CL_MIN_VAL = 100000`, `B2CL_MIN_VAL_STR_PRD = "082024"` | `73465d57c8d1969653f9bdf3009bf32958c65a61e66ad8aed794a30a429a3fe8` |
| `offline-tool/code-excerpts.md` | the three files above | Short quoted fragments with file:line, and the JSON shape derived from them. Excerpts only — the tool's code is not redistributed. | n/a (derived) |
| `offline-tool/Readme.txt`, `offline-tool/ReleaseNotes.txt` | in the zip | verbatim (CRLF kept). Release 3.2.1: B2CL limit split at Aug 2024; 3.2.2: HSN split into B2B/B2C; 3.2.3: 40 % rate; 3.2.4: B2CL boundary fix | `7eda55412f08c565b302b3ece9cad3c3875c6ee700033113b322a7a8fe047643`, `a9408cb53bf1430c9f0add4266fa00578cdf750796b89a5af09994563ac17f2a` |
| `offline-tool/data/*.json` (`gstr`, `invtypes`, `invtypesforb2b`, `rate`, `rsn`, `state`, `uploadtablename`) | installer, `app/public/data/` | verbatim. Invoice-type codes (`R`, `DE`, `SEWP`, `SEWOP`, `CBW`), rate drop-downs, state codes, section codes and titles with GSTR-1 table numbers | see `sha256sum` in the folder; files are byte-identical to the installer's |
| `offline-tool/csv/*.csv` | in the zip, `Section_wise_CSV_files/GSTR1/` | Official per-section CSV import templates. Headers and sample rows verbatim **except**: GSTIN-shaped values replaced by `[REDACTED-GSTIN]` (all 12 distinct ones pass mod-36, so they may be real registrations — CLAUDE.md forbids committing real GSTINs) and two real-looking company names in `cdnr.csv` replaced by `[REDACTED-NAME]`. Original hashes below. | below |
| `excel-template-v2.2-help-excerpt.txt` | `GSTR1_Excel_Workbook_Template_V2.2.xlsx` (in the zip, 2025-10-07), sheet "Help Instruction" | Excerpt: the rows for b2b, b2cl, b2cs, cdnr, cdnur, exp, exemp, hsn(b2b)/hsn(b2c), docs, and the special instructions. One example GSTIN redacted. | xlsx `425084547928a31eab53123b9247bad9ded1ee421fbc9202d009260e5d9b18e5` |
| `portal-faq-excerpts.txt` | https://tutorial.gst.gov.in/offlineutilities/gsterrorandresolution/gstissuesandsuggestedsolutions.pdf (Issue No. 11) and the zip's "FAQs and User Manual Returns Offline Tool.pdf" (FAQ 42–43) | Excerpts: which schema the portal validates against; 5 MB file limit; file name | PDF `ded23f944f793f1929a23e96d5e5f47d8bb20534e3c88bbe9869a94d3a21b1bc`; manual `81a819f9a1399e5057fbe14da2a1b17265c081a4516397de31ac132d3c1b972c` |

Not stored: `GSTR1_Excel_Workbook_Template_V2.0.xlsx` (`633209caa23ebd54a1cdc7a96626d466a88044afdb9a1a9bfba2d597f4eb9e6a`, superseded by V2.2) and the GSTR-2 files.

### Original SHA-256 of the CSV templates (before redaction)

Files not listed as redacted are byte-identical to the original.

```
a80bc9e413797a63d3db93ed54560662f44f652398e065e1d9721766c82db330  b2b,sez,de.csv   (redacted)
723567ee69ccecc6d81100d6f94930ee243445132c4b00aa6fd3c9cfa5db683f  b2ba.csv        (redacted)
dd9e6b724215026b5e5b23a0758cebe99444d6f79442c4a9a6fcdfdd2c3e1483  b2cl.csv        (redacted)
70b8546a394b38c60489ea30abc57ae765808c682eed541504c6ca9e865cbbac  b2cla.csv
d9c8d10a9661b3e6b49d210ec913cefa5f8eb15d9763f0dd5beb44af0170d482  b2cs.csv        (redacted)
455b980878829cb9123e90db0665a5e817edefed88d36465321d46e2d5a14be0  b2csa.csv       (redacted)
9e56d1a39b0b48e8fa336b493bdca422de221a3f5765878739ea034a363c9f1b  cdnr.csv        (redacted)
ebbd18d6313003403df728f928655bdbc98b3b35d51e2004b7acf583f94c4105  cdnra.csv       (redacted)
4dbe1aefc9c3ba74eefd16fb3b5c842a64979916eccbdfdbb6d8d59adfe4d29e  cdnur.csv
ad3a83a4e821e2af03c306cb7371d4ced66cf8ce4a3b35f90c1c7db1d32af709  cdnura.csv
47f9f0afeeae3cf7bec62631e24468e8ec4f1d62f23c2bc2c663deccaf09aac4  docs.csv
20d4db60b0e1e30abca680d9183c37e001fb9a97c3760aafa1dd7a22d93ecd8a  eco.csv         (redacted)
fe162159679e5f1bd2052893862ac68a6b7b8028c35c34bd1f350c3f08bca682  ecoa.csv        (redacted)
9e60357049702577879a74782984cc64daf1c47b5f94915945d83b0c660cda19  ecoab2b.csv     (redacted)
2d7efa345af86c823fa7b109279dbbc7ca0cbc0305e722359470957ad887ac0b  ecoab2c.csv     (redacted)
bac3f1a86f7df67287cb12ee1700ff7a1633b606e859a5c063f9ceb73a67396f  ecoaurp2b.csv   (redacted)
23cb4b6743a04d80fff7dfa139acf422c26c0f4832addaf3faf347a263cc1e6c  ecoaurp2c.csv
8cf4d179b3ec742a45651d333fc31b23c871355db58de376e7f67844f938104f  ecob2b.csv      (redacted)
596babc6c4c948193cf2c4c5f8857a1572eea229eac2d055250de0547625e589  ecob2c.csv      (redacted)
d19242fb8e4b3b6ee54e46878755857ef5b331131700734b0f3ca734e384ef91  ecourp2b.csv    (redacted)
2ffe4945ea78f7a54b61348e802981155866e7f97614bde004b8e04606198bfe  ecourp2c.csv
e1ca93bf6fdc2d01a09a4e8e1b2f2fd2cf643fce5bbb49106f7ed20049ca1c06  exemp.csv
e46fb007873b92ad01bcc0143576f899ca2eda3623b353639d74eb6fc212dc84  exp.csv
069c710468d14c8f2c20e3aa39f88c0109ebabc794e1c5b510270c9082f7a8ad  expa.csv
056fd0f8027e42a93f2ba05392a36b434abaac654b5b41566d630f946f0c3025  hsn(b2b).csv, hsn(b2c).csv, hsn.csv (identical)
6b72b9f0ca50ece55fb9736f6d5cbab25ae1d5cd816975e18fbfa612e01a1e8a  at.csv
6d81479bb197b34a3dfbf291c971b368bd4218d63fc6a7e830b438581518e8a6  ata.csv
7d20444e96c489755b7b9d9a66eee1dcd2440dba8c34feac6db77d17eee6a842  atadj.csv
9396f9fee508f56c3a470f38710a1489b55ba3fbddbdb56e27e0e22060824d72  atadja.csv
```

`.gitattributes` marks `sources/gstr1/offline-tool/**` as `-text` so Git does not rewrite CRLF line endings.

## How to re-check

```sh
curl -sO https://tutorial.gst.gov.in/offlineutilities/returns/gst_offline_tool.zip && sha256sum gst_offline_tool.zip
innoextract -s -d out "GST Offline Tool.exe"   # reading only; do not install
sha256sum out/app/utility/returnStructure.js out/app/service/offline.js out/app/utility/constants.js
```
GSTN replaces the zip in place when it releases a new tool version, so a hash mismatch most likely means a newer release (check `ReleaseNotes.txt`).
