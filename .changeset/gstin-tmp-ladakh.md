---
"@india-gst-kit/model": minor
---

GSTIN-shaped temporary IDs (`<state><10 digits>TMP`) now fail with "looks like a temporary ID, not a GSTIN"; new `isTemporaryId`. `usesUtgst("38")` (Ladakh) now returns `"unknown"` because the amending law was not found; the return type is `boolean | "unknown"`.
