# india-gst-kit

Small, typed building blocks for Indian GST.

| Package                                        | Status                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| [`@india-gst-kit/model`](packages/model)       | v0.1 — one GST document as Zod schemas + pure helpers               |
| [`@india-gst-kit/einvoice`](packages/einvoice) | v0.1 — e-invoice IRN request mapping, validation, signed JWT decode |
| [`@india-gst-kit/gstr1`](packages/gstr1)       | v0.1 — GSTR-1 builder, API payload + offline JSON                   |
| [`@india-gst-kit/recon`](packages/recon)       | v0.1 — reconcile a purchase register against GSTR-2B                |
| `ewaybill`, `gsp`                              | planned                                                             |

Every legal/official fact in this repo is **UNVERIFIED — needs CA** until signed off in [`docs/legal-facts.md`](docs/legal-facts.md). This is not tax advice.

Development: see [`CLAUDE.md`](CLAUDE.md) and [`docs/specs/model.md`](docs/specs/model.md). Gate: `pnpm check`.
