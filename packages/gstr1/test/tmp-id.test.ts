import { describe, expect, it } from "vitest";
import { buildGstr1 } from "../src/index.js";
import { PERIOD, mkDoc } from "./helpers.js";

// Temporary IDs that happen to pass mod-36 are still not GSTINs (model spec §6.4). Recipient GSTINs reach gstr1
// only through the model's GstDocumentSchema, which rejects them; the filer GSTIN is checked here.
const TMP_MESSAGE = "looks like a temporary ID, not a GSTIN";

describe("filer GSTIN: temporary IDs that pass mod-36", () => {
  it("290000000079TMP → SUPPLIER_GSTIN_FORMAT with the temporary-ID message", () => {
    const r = buildGstr1({ gstin: "290000000079TMP", period: PERIOD, documents: [mkDoc()] });
    expect(r.ok).toBe(false);
    const fmt = r.ok ? [] : r.issues.filter((i) => i.code === "SUPPLIER_GSTIN_FORMAT");
    expect(fmt.map((i) => i.message)).toEqual([expect.stringContaining(TMP_MESSAGE)]);
  });
});
