import { describe, expect, it } from "vitest";
import { parse, supplierBlock, wireFile, wireInvoice, type Obj } from "./helpers.js";

const b2b = (inv: Obj, sup: Obj = {}): Obj => ({ b2b: [{ ...supplierBlock(sup), inv: [inv] }] });

// Temporary IDs that happen to pass mod-36 are still not GSTINs (model spec §6.4).
const TMP_MESSAGE = "looks like a temporary ID, not a GSTIN";

describe("GSTR-2B parsing: temporary IDs that pass mod-36", () => {
  it("a TMP-shaped supplier ctin is reported with the temporary-ID message", () => {
    const r = parse(wireFile(b2b(wireInvoice(), { ctin: "270000000199TMP" })));
    const at = r.issues.filter((i) => i.path.join(".") === "data.docdata.b2b.0.ctin");
    expect(at.map((i) => i.message)).toEqual([expect.stringContaining(TMP_MESSAGE)]);
  });
  it("a TMP-shaped recipient gstin is reported with the temporary-ID message", () => {
    const r = parse(wireFile(b2b(wireInvoice()), { gstin: "290000000079TMP" }));
    const at = r.issues.filter((i) => i.path.join(".") === "data.gstin");
    expect(at.map((i) => i.message)).toEqual([expect.stringContaining(TMP_MESSAGE)]);
  });
});
