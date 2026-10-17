---
"@india-gst-kit/model": patch
---

Temporary IDs (`<state><10 digits>TMP`) that happen to pass mod-36 (e.g. `330000000000TMP`) are no longer accepted: `isGstinStructurallyValid`, `isValidGstin` and `parseGstin` reject them, and `GstinSchema` reports "looks like a temporary ID, not a GSTIN".
