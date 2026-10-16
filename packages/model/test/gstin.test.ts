import { GSTINS } from "@india-gst-kit/fixtures";
import { describe, expect, it } from "vitest";
import {
  gstinCheckDigit,
  isGstinStructurallyValid,
  isValidGstin,
  parseGstin,
} from "../src/index.js";

const synthetic = Object.values(GSTINS);
const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

describe("check digit (mod-36, UNVERIFIED — see spec §6.4)", () => {
  it.each(synthetic)("synthetic GSTIN %s is valid", (g) => {
    expect(isValidGstin(g)).toBe(true);
    expect(gstinCheckDigit(g.slice(0, 14))).toBe(g[14]);
  });
  it("every wrong check digit is invalid", () => {
    for (const g of synthetic) {
      for (const c of CHARSET) {
        if (c === g[14]) continue;
        expect(isValidGstin(g.slice(0, 14) + c)).toBe(false);
      }
    }
  });
  it("the portal's illustrative sample GSTINs fail (they are not valid; sources/README.md finding 2)", () => {
    expect(isValidGstin("37BZNPM9430M1KL")).toBe(false);
    expect(isValidGstin("03BZNPM9430M1KL")).toBe(false);
    expect(gstinCheckDigit("37BZNPM9430M1K")).toBe("E");
    expect(gstinCheckDigit("03BZNPM9430M1K")).toBe("P");
  });
  it("matches the algorithm worked by hand for one input", () => {
    // 14 chars "29AAAAA0000A1Z": weights alternate 1,2; each product p adds floor(p/36)+p%36.
    const first14 = "29AAAAA0000A1Z";
    let sum = 0;
    for (let i = 0; i < first14.length; i++) {
      const p = CHARSET.indexOf(first14.charAt(i)) * (i % 2 === 0 ? 1 : 2);
      sum += Math.floor(p / 36) + (p % 36);
    }
    expect(CHARSET[(36 - (sum % 36)) % 36]).toBe("Y");
    expect(gstinCheckDigit(first14)).toBe("Y");
  });
  it("gstinCheckDigit throws on malformed input", () => {
    expect(() => gstinCheckDigit("29AAAAA0000A1")).toThrow();
    expect(() => gstinCheckDigit("29aaaaa0000a1z")).toThrow();
    expect(() => gstinCheckDigit("29AAAAA0000A1Z!")).toThrow();
  });
});

describe("structure (loose official pattern + state code)", () => {
  it("accepts GSTINs of the official shape regardless of PAN layout (TDS/TCS/non-resident shapes are not separately published)", () => {
    expect(isGstinStructurallyValid("29AAAAA0000A1ZY")).toBe(true);
    expect(isGstinStructurallyValid("29AAAAA0000A1Z0")).toBe(true); // structure only; check digit is separate
    expect(isGstinStructurallyValid("07ABCD12345E1ZX")).toBe(true); // TAN-like body, still the loose pattern
    expect(isGstinStructurallyValid("97ABCDE1234F1Z5")).toBe(true); // Other Territory prefix
  });
  it.each([
    ["wrong length (14)", "29AAAAA0000A1Z"],
    ["wrong length (16)", "29AAAAA0000A1ZYY"],
    ["lowercase", "29aaaaa0000a1zy"],
    ["unknown state prefix 28", "28AAAAA0000A1ZY"],
    ["prefix 00", "00AAAAA0000A1ZY"],
    ["prefix 96 (outside India)", "96AAAAA0000A1ZY"],
    ["prefix 99 (outside India)", "99AAAAA0000A1ZY"],
    ["non-digit state", "AAAAAAA0000A1ZY"],
    ["symbol", "29AAAAA0000A1Z-"],
    ["whitespace", " 29AAAAA0000A1ZY"],
    ["empty", ""],
  ])("rejects %s", (_name, g) => {
    expect(isGstinStructurallyValid(g)).toBe(false);
    expect(isValidGstin(g)).toBe(false);
  });
  it("does not accept the buyer-only token URP as a GSTIN", () => {
    expect(isGstinStructurallyValid("URP")).toBe(false);
  });
});

describe("parseGstin", () => {
  it("extracts state, PAN/ID, entity code and check digit", () => {
    expect(parseGstin(GSTINS.supplierKa)).toEqual({
      stateCode: "29",
      panOrId: "AAAAA0000A",
      entityCode: "1",
      checkDigit: "Y",
    });
    expect(parseGstin(GSTINS.recipientCh)?.stateCode).toBe("04");
  });
  it("returns undefined for structurally invalid input", () => {
    expect(parseGstin("nope")).toBeUndefined();
    expect(parseGstin("28AAAAA0000A1ZY")).toBeUndefined();
  });
});
