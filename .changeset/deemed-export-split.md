---
"@india-gst-kit/model": minor
---

`decideTaxSplit`: only `SEZ_*` and `EXPORT_*` are always inter-state; `DEEMED_EXPORT` now follows the states like `DOMESTIC` (source C validations list only exports and SEZ; UNVERIFIED — needs CA). Same-state deemed-export documents now take CGST/SGST instead of IGST.
