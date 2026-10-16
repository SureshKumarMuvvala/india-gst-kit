# GSTR-2B sources (Track C, `@india-gst-kit/recon`)

Status of every fact taken from these files: **UNVERIFIED — needs CA**, until it is signed off in `docs/legal-facts.md`.

## Files

| File | Version | Official page | Publisher status | Published | Downloaded | SHA-256 (file as committed) |
|---|---|---|---|---|---|---|
| `gstr2b-get-all-details-v4.5-response-schema.json` | 4.5 | https://developer.gst.gov.in/apiportal/taxpayer/returns ("GSTR-2B — Get All Details", response schema) | **Draft** | 20-07-2026 | 2026-10-16, by hand | `3351e86b8309ebe0cd45abcc217951cbb57401c24336a7bbaaaef5d687202e95` |
| `gstr2b-get-all-details-v4.4-response-schema.json` | 4.4 | same page | **Draft** | 25-02-2026 | 2026-10-16, by hand | `80ef571df18bee03c302af7e1957ecb1d0ae35d21dc14ac96a745f044f42b000` |

- **v4.5 is authoritative** (source **H** in `docs/specs/recon.md`). v4.4 is kept only so the change summary below can be checked.
- The owner downloaded both files by hand and uploaded them to the branch unchanged. The hashes above are of those files. Unlike sources A–C in `sources/README.md`, they could not be checked against the live page: the build environment does not fetch `developer.gst.gov.in`.
- Both schemas are marked **Draft** by the publisher. If a final version differs, the final version supersedes this one.

## Changes v4.4 → v4.5

This is a complete recursive diff of the two JSON documents, covering every key, array element and value. **Everything in it is an addition; nothing was removed or changed.**

- New definition `definitions/isITCRevAmd`: `{"type": "string", "enum": ["Y"]}`.
- A new optional field `isITCRevAmd` ("Is ITC Reversal Amendment", `$ref` to that definition) in:
  - `data.docdata.b2ba[].inv[]`
  - `data.docdata.cdnra[].nt[]`
  - `data.docdata.ecoma[].inv[]`
  - `data.docdata.itcrev.cdnra[].nt[]`
- `data.docRejdata`, the summaries (`itcsumm`, `cpsumm`, `cpSummRej`) and every other section are unchanged.

Consequence: every document valid under v4.4 is valid under v4.5.

## Schema quirks (v4.5; also in v4.4)

Kept as published. How `recon` reads each one is set out in `docs/specs/recon.md` §3.3.

1. The `ctin`/`gstin` patterns are unanchored (with min/max length 15) and allow lower case. `ctin` also has a non-resident alternative, `[0-9]{4}[a-zA-Z]{3}[0-9]{5}[N][R][0-9a-zA-Z]{1}`.
2. `data.docdata.itcrev` has no `type`/`properties` wrapper. Its `b2b`, `b2ba`, `cdnr` and `cdnra` keys sit directly on the node, so a draft-07 validator ignores them.
3. Document objects carry `"anyof": [...]` in lower case. That is not a JSON-Schema keyword, so it constrains nothing.
4. `additionalProperties: false` appears only at the root and on the `ecom`/`ecoma` (and `docRejdata.ecom`/`ecoma`) **arrays**, where it has no effect.
5. Money (`val`, `amts`) has `multipleOf 0.01` and a maximum of `9999999999999.99`, but **no minimum**. `rate` has `multipleOf 0.01` and a maximum of `999.9`.
6. The `invnum` pattern `^(?!0*$)[a-zA-Z0-9-/]+$`, max 16, allows no whitespace. It allows leading zeros and rejects all-zero numbers. A stricter `inum` definition exists but no B2B/CDNR section uses it.
7. Dates are `DD-MM-YYYY`, checked by a lookahead regex that encodes the calendar, leap years included. Periods are `MMYYYY`.
8. The fields differ between sections. `docdata.b2b[].inv[]` has no `itcRedReq`, `decl*` or `remarks`, while `b2ba`/`cdnr`/`cdnra` have them. `docRejdata` documents have `remarks` but no `imsStatus`.
9. The meanings of the code values are not defined in the schema: invoice `typ` `R, DE, SEWP, SEWOP, SEZNAO, SEZWPAO, SEZWOPAO, CBW`, note `typ` `C, D`, `itcavl` `Y, N, T`, `imsStatus` `A, R, N`, `diffprcnt` `0.65, 1`. Descriptions are one-liners such as "Invoice Type" and "Note Type".
