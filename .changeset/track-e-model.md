---
"@india-gst-kit/model": minor
---

Ship-to / dispatch-from (Track E): optional `shipTo` and `dispatchFrom` on `GstDocumentSchema` (`ShipToSchema`, `DispatchFromSchema`, `ShipAddressSchema`: PIN required, address in India). They never change `placeOfSupply` or the tax split. New `shipmentPattern` (REGULAR / BILL_TO_SHIP_TO / BILL_FROM_DISPATCH_FROM / COMBINATION) and the warning-only PIN helpers `pinStateCheck` / `documentPinWarnings` (`PinWarningSchema`).
