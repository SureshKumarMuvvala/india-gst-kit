#!/usr/bin/env node
// Private check of real GSTINs against the model's rules (pattern, state code, mod-36 check digit).
//
//   pnpm --filter @india-gst-kit/model build
//   node scripts/verify-gstin.mjs [file]        # default: scripts/local/gstins.txt (gitignored)
//
// The file holds one GSTIN per line; blank lines and `#` comments are ignored. Nothing is printed
// except PASS/FAIL per line (GSTIN masked), and nothing is written anywhere. Never commit real GSTINs.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const modelEntry = new URL("../packages/model/dist/index.js", import.meta.url);
if (!existsSync(fileURLToPath(modelEntry))) {
  console.error("Build the model first: pnpm --filter @india-gst-kit/model build");
  process.exit(2);
}
const { isGstinStructurallyValid, isValidGstin } = await import(modelEntry.href);

const file = process.argv[2] ?? fileURLToPath(new URL("./local/gstins.txt", import.meta.url));
if (!existsSync(file)) {
  console.error(`No input file: ${file}\nCreate it (it is gitignored) with one GSTIN per line.`);
  process.exit(2);
}

// Output never shows a full GSTIN: first 4 + last 3 characters, e.g. 36LG…1ZM.
const mask = (g) => (g.length > 7 ? `${g.slice(0, 4)}…${g.slice(-3)}` : "…");

let failed = 0;
let total = 0;
for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
  const gstin = raw.trim();
  if (gstin === "" || gstin.startsWith("#")) continue;
  total += 1;
  if (isValidGstin(gstin)) {
    console.log(`PASS  ${mask(gstin)}`);
    continue;
  }
  failed += 1;
  if (!isGstinStructurallyValid(gstin)) {
    console.log(
      `FAIL  ${mask(gstin)}  (structure: need 15 chars [0-9A-Z], a valid state code, not 96/99)`,
    );
  } else {
    console.log(`FAIL  ${mask(gstin)}  (check digit mismatch)`);
  }
}
console.log(
  `\n${total - failed}/${total} passed (mod-36 is UNVERIFIED — a FAIL on a real GSTIN means the algorithm assumption is wrong)`,
);
process.exit(failed === 0 ? 0 : 1);
