import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

describe("api surface", () => {
  it("has no default export", () => {
    expect("default" in api).toBe(false);
  });
  it("exports the documented helpers", () => {
    for (const name of [
      "STATE_CODES",
      "stateName",
      "stateCodeFromName",
      "isStateCode",
      "UQC_CODES",
      "isUqcCode",
      "isGstinStructurallyValid",
      "gstinCheckDigit",
      "isValidGstin",
      "parseGstin",
      "decideTaxSplit",
      "usesUtgst",
      "money",
      "sumMoney",
      "computeLineTax",
      "GstDocumentSchema",
      "parseGstDocument",
    ] as const) {
      expect(api).toHaveProperty(name);
    }
  });
  it("no longer exports rate lists or a documentDiscount (deferred, spec §12)", () => {
    for (const name of [
      "GST_RATES_OFFERED",
      "GST_RATES_LEGACY",
      "GST_RATES_ALL",
      "rateInForceOn",
      "isGstRate",
    ]) {
      expect(api).not.toHaveProperty(name);
    }
  });
});
