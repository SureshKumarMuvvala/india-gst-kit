import { describe, expect, it } from "vitest";
import { validateIrnRequest } from "../src/index.js";
import { edit, hits, mapped } from "./helpers.js";

// Temporary IDs that happen to pass mod-36 are still not GSTINs (model spec §6.4).
const TMP_27 = "270000000199TMP";
const TMP_29 = "290000000079TMP";
const TMP_MESSAGE = "looks like a temporary ID, not a GSTIN";

describe("V5 rejects temporary IDs that pass mod-36", () => {
  it.each([
    [["BuyerDtls", "Gstin"], TMP_27, "interInvoice"],
    [["SellerDtls", "Gstin"], TMP_29, "interInvoice"],
    [["ShipDtls", "Gstin"], TMP_29, "billToShipTo"],
  ] as const)("%j = %s", (path, value, from) => {
    for (const gstinCheckDigit of ["enforce", "off"] as const) {
      const r = validateIrnRequest(edit(mapped(from), [[path, value]]), { gstinCheckDigit });
      expect(r.ok).toBe(false);
      const v5 = hits(r.issues, "V5").filter((i) => i.path.join(".") === path.join("."));
      expect(v5.map((i) => i.message)).toEqual([expect.stringContaining(TMP_MESSAGE)]);
    }
  });
});
