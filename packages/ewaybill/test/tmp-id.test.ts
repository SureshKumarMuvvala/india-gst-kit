import { describe, expect, it } from "vitest";
import { validateEwbRequest } from "../src/index.js";
import { edit, hits, mapped } from "./helpers.js";

// Temporary IDs that happen to pass mod-36 are still not GSTINs (model spec §6.4).
const TMP_MESSAGE = "looks like a temporary ID, not a GSTIN";

describe("V-G6 rejects temporary IDs that pass mod-36", () => {
  it.each([
    ["toGstin", "270000000199TMP"],
    ["fromGstin", "290000000079TMP"],
  ] as const)("%s = %s", (key, value) => {
    for (const gstinCheckDigit of ["enforce", "off"] as const) {
      const r = validateEwbRequest(edit(mapped("interInvoice"), [[[key], value]]), {
        gstinCheckDigit,
        supplierEInvoiceEnabled: false,
      });
      expect(r.ok).toBe(false);
      const g6 = hits(r.issues, "V-G6").filter((i) => i.path.join(".") === key);
      expect(g6.map((i) => i.message)).toEqual([expect.stringContaining(TMP_MESSAGE)]);
    }
  });
});
