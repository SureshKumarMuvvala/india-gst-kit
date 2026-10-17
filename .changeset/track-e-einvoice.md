---
"@india-gst-kit/einvoice": minor
---

Maps `dispatchFrom` → `DispDtls` and `shipTo` → `ShipDtls` (no GSTIN ⇒ `Gstin` omitted, never `URP`). New warnings V29 (an e-way bill without ship-to needs the buyer PIN) and V30 (an export e-way bill needs the port in India as ship-to).
