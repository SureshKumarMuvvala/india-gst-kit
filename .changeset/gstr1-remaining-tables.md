---
"@india-gst-kit/gstr1": minor
---

Build GSTR-1 Tables 8 (nil), 9A/9C (`b2ba`, `b2cla`, `expa`, `cdnra`, `cdnura` from a revised document and a caller-supplied original), 10 (`b2csa`), 11 (advances `at`/`txpd`/`ata`/`txpda`) and 14/14A, 15/15A (`supeco`, `ecom`) from caller input, and mark supplies made through an e-commerce operator (`etin` in the offline JSON only; the v5.0 API payload warns `ECO_NOT_IN_API_SHAPE`). Render results now carry `warnings`. New `Gstr1Return` keys are optional, so v0.1 returns and outputs are unchanged.
