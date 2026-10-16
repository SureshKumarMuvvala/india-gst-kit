import { describe, expect, it } from "vitest";
import {
  parseEwbByIrnRequestJson,
  parseEwbByIrnResponseData,
  parseEwbRequestJson,
  parseEwbResponseData,
  validateEwbByIrnRequest,
  validateEwbRequest,
} from "../src/index.js";
import { hits, must } from "./helpers.js";
import { source } from "./sources.js";

// The official samples are read from sources/, never copied into fixtures (spec §12).
const H_SAMPLE = source("ewaybill/generate-ewaybill-sample-request.json");
const I_SAMPLE = source("ewaybill/ewb-by-irn-sample-request.json");
const off = { supplierEInvoiceEnabled: false, gstinCheckDigit: "off" } as const;
const errors = (r: { issues: { severity: string; rule: string; path: (string | number)[] }[] }) =>
  r.issues.filter((i) => i.severity === "error").map((i) => `${i.rule}@${i.path.join(".")}`);

describe("H sample request (Generate E-way Bill)", () => {
  it('parseEwbRequestJson reports otherValue ("-100") as a string where a number belongs', () => {
    const r = parseEwbRequestJson(H_SAMPLE);
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([
      expect.objectContaining({ code: "WRONG_TYPE", path: ["otherValue"], severity: "error" }),
    ]);
  });
  // With that one field coerced to a number:
  const coerced = H_SAMPLE.replace('"otherValue": "-100"', '"otherValue": -100');
  const parsed = parseEwbRequestJson(coerced);
  it("is otherwise structurally valid (the empty strings count as absent: D-M4)", () => {
    expect(coerced).not.toBe(H_SAMPLE);
    expect(parsed.issues).toEqual([]);
    expect(parsed.ok).toBe(true);
    for (const k of ["transporterName", "transDocNo", "transDocDate", "subSupplyDesc"]) {
      expect(k in must(parsed.value), k).toBe(false);
    }
  });
  it("the sample GSTIN fails the V-G6 check digit, and passes with gstinCheckDigit off", () => {
    const r = validateEwbRequest(parsed.value, { supplierEInvoiceEnabled: false });
    expect(hits(r.issues, "V-G6").map((i) => i.path.join("."))).toEqual(["fromGstin", "toGstin"]);
    expect(hits(validateEwbRequest(parsed.value, off).issues, "V-G6")).toEqual([]);
  });
  it("V-G3 fails (fromGstin = toGstin for sub-type 1)", () => {
    expect(hits(validateEwbRequest(parsed.value, off).issues, "V-G3")).toEqual([
      expect.objectContaining({ path: ["toGstin"], severity: "error" }),
    ]);
  });
  it("V-G7 fails (toStateCode 27 with a 29 GSTIN)", () => {
    expect(hits(validateEwbRequest(parsed.value, off).issues, "V-G7")).toEqual([
      expect.objectContaining({ path: ["toStateCode"], severity: "error" }),
    ]);
  });
  it("V-G10 passes (57100.23 ≤ 68360.00)", () => {
    expect(hits(validateEwbRequest(parsed.value, off).issues, "V-G10")).toEqual([]);
  });
  it('vehicleNo "PVC1234" matches a V-T6 shape', () => {
    expect(parsed.value?.vehicleNo).toBe("PVC1234");
    expect(hits(validateEwbRequest(parsed.value, off).issues, "V-T6")).toEqual([]);
  });
  it("those are the only errors (the sample is inconsistent: spec §13 D11)", () => {
    expect(errors(validateEwbRequest(parsed.value, off))).toEqual([
      "V-G3@toGstin",
      "V-G7@toStateCode",
    ]);
    expect(errors(validateEwbRequest(parsed.value, { supplierEInvoiceEnabled: false }))).toEqual([
      "V-G3@toGstin",
      "V-G6@fromGstin",
      "V-G6@toGstin",
      "V-G7@toStateCode",
    ]);
  });
  it("the item's taxableAmount is far above totalValue, which no rule here compares", () => {
    expect(parsed.value?.totalValue).toBe("56099");
    expect(parsed.value?.itemList[0]?.taxableAmount).toBe("5609889");
  });
});

describe("I sample request (EWB by IRN)", () => {
  it('Irn "" fails the schema (V-B1 length) and TransId "12XXXXXX" fails length 15 and V-T9', () => {
    const r = parseEwbByIrnRequestJson(I_SAMPLE);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => `${i.rule}@${i.path.join(".")}`).sort()).toEqual([
      "S-SCHEMA@Irn",
      "S-SCHEMA@TransId",
      "V-T9@TransId",
    ]);
  });
  it("with those two replaced, no other error remains", () => {
    const fixed = I_SAMPLE.replace('"Irn": ""', `"Irn": "${"b".repeat(64)}"`).replace(
      '"12XXXXXX"',
      '"29AAAAA0000A1ZY"',
    );
    const r = parseEwbByIrnRequestJson(fixed);
    expect(r.issues).toEqual([]);
    const v = validateEwbByIrnRequest(r.value);
    expect(v.issues).toEqual([]);
    expect(v.ok).toBe(true);
  });
});

describe("response samples", () => {
  const generateData = /\{\s*"ewayBillNo":\s*123456789012[^}]*\}/.exec(
    source("ewaybill/generate-ewaybill-sample-response.txt"),
  )?.[0];
  it("H's decrypted sample parses; validUpto 12.00:00 PM is a warning", () => {
    expect(generateData).toBeDefined();
    const r = parseEwbResponseData(must(generateData));
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({
      ewayBillNo: "123456789012",
      ewayBillDate: "25/09/2018 10:30:00 AM",
      validUpto: "26/09/2018 12.00:00 PM",
      alert: "",
    });
    expect(r.issues).toEqual([
      expect.objectContaining({ rule: "P-DATE", path: ["validUpto"], severity: "warning" }),
    ]);
  });
  it("I's sample parses with EwbNo 111008683051", () => {
    const r = parseEwbByIrnResponseData(source("ewaybill/ewb-by-irn-sample-response.json"));
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({
      EwbNo: "111008683051",
      EwbDt: "2020-04-24 11:28:00",
      EwbValidTill: "2020-04-26 23:59:00",
      Remarks: "Pin-Pin calc distance: 997KM",
    });
  });
});
