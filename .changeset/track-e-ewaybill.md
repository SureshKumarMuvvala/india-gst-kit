---
"@india-gst-kit/ewaybill": minor
---

The Generate route takes the from/to address, PIN, actual state codes and `transactionType` from the document's `dispatchFrom` / `shipTo`. `EwbMovement.dispatchFrom` (now `legalName`, the model's `DispatchFromSchema`) and `shipTo` (the model's `ShipAddressSchema`) remain only for EWB by IRN; passing them to `toEwbRequest` is `ADDRESS_IN_MOVEMENT`. A ship-to GSTIN gives the warning `SHIP_TO_GSTIN_NOT_SENT` (the Generate schema has no field for it).
