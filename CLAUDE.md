# CLAUDE.md — india-gst-kit

Monorepo of small packages for Indian GST. Current scope: `@india-gst-kit/model` (Track 0). The spec is `docs/specs/model.md`; read it before changing behaviour. Sources and findings: `sources/README.md`, `sources/acts/README.md`. Legal facts register: `docs/legal-facts.md`.

## Toolchain

- pnpm workspaces, `packageManager: "pnpm@11.25.0"` (do **not** change the pin). Activate: `corepack enable && corepack prepare pnpm@11.25.0 --activate`, or `npm i -g pnpm@11.25.0`.
- `.nvmrc` = `22.22.2`; root `engines.node` `>=22.18 <25`; published packages `>=22`.
- `zod`: peer `^4.0.0`, dev `4.5.4` (exact). Zod 4 API only. `decimal.js` for all money maths.
- TypeScript **~6.0** (typescript-eslint does not support TS 7 yet), strict + `NodeNext` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. Vitest. ESLint flat config, typescript-eslint strict-type-checked, no default exports (tool configs excepted). Prettier. Changesets. `turbo.json` present.
- **Gate:** `pnpm check` = typecheck + lint + test. It must be green before any commit that changes code.
- Layout: `packages/model` (published), `packages/fixtures` (private, synthetic), `packages/einvoice` (published, Track B: IRN mapping/validation/JWT decode, spec `docs/specs/einvoice.md`), `packages/recon` (published, Track C: parse GSTR-2B v4.5 JSON, reconcile a purchase register against it, spec `docs/specs/recon.md`; never decides ITC), placeholders `packages/{gstr1,ewaybill,gsp}` (README "planned" only).
- `scripts/verify-gstin.mjs` checks GSTINs from the gitignored `scripts/local/gstins.txt`. Never commit real GSTINs.

## Rules

- ESM only, named exports only. Types are `z.infer` of schemas — no hand-written duplicate interfaces. Money, quantities, rates and dates are **strings**, never JS numbers.
- Tests first. Every behaviour in the spec's test list has a test; a bug fix starts with a failing test.
- **No legal/official list is filled from memory.** Each one lives in its own file with a header (`// Source: <URL>`, `// Retrieved: YYYY-MM-DD`, `// Status: UNVERIFIED — needs CA`) and one row in `docs/legal-facts.md`. Everything is UNVERIFIED until a CA signs it off.
- The model validates arithmetic; it does **not** decide taxability or which rate applies. No rate list in v0.1.
- Fixtures contain only synthetic data and only the GSTINs registered in `packages/fixtures/src/gstins.ts` (check digits computed, not real). The portal's sample GSTINs `37BZNPM9430M1KL` / `03BZNPM9430M1KL` are invalid by mod-36 and must never be used as valid.
- No AGPL/GPL reference code, no real company data.
- Do not weaken strictness or lint rules to get green.
- All commits use author `Suresh Kumar Muvvala <suresh.kumar0465@gmail.com>` and carry a `Co-Authored-By: Claude` trailer.
- The official GSTIN pattern is the loose `^[0-9]{2}[0-9A-Z]{13}$` + a GSTIN-capable state code (not 96/99) + the mod-36 check digit (UNVERIFIED). State codes are stored 2-digit (`01`); 25 is withdrawn as place of supply; 96/97/99 are special.
- Unknown keys are rejected (`z.strictObject`) so a silently dropped field (e.g. `documentDiscount`) can never go unnoticed.

## Stop conditions — halt and report instead of guessing

- A source needed for a legal list the model **enforces** is unavailable or ambiguous → stop and name the file to attach.
- An _official_ sample GSTIN fails the check-digit algorithm → stop. (None exist publicly; the portal's illustrative ones are known to fail.)
- Source C (e-invoice schema) contradicts the spec → follow the source, report under "Deviations from spec".
- A requirement would need AGPL/GPL reference code or real company data → stop.
- `pnpm check` can't be made green without weakening strictness or lint rules → stop and report.

## Deferred (spec §12)

`UIN_HOLDER`; export details; other document kinds; rate lists / `rateInForceOn` (needs rate notifications + CA); invoice-level discount (needs CA); full UTGST territory list after later amendments (Ladakh etc.); e-invoice/GSTR-1 mappings (other packages); the portal's ±1 rupee tolerance (belongs in `einvoice`).

## Environment notes

`einvoice1.gst.gov.in`, `www.gst.gov.in`, `taxinformation.cbic.gov.in` are unreachable from the cloud build environment (captured by hand into `sources/`). `gstcouncil.gov.in` and `cbic-gst.gov.in` are reachable.
