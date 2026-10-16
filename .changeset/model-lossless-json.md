---
"@india-gst-kit/model": minor
"@india-gst-kit/einvoice": patch
---

`model` now exports the lossless-JSON helper (`JsonNumber`, `parseJsonLossless`, `convertNumbers`, `parseLenient`, `markNumber`, `isNumberLeaf` and path helpers), moved out of `einvoice`, which imports it from here with no change in behaviour.
