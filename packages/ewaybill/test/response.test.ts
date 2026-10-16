import { describe, expect, it } from "vitest";
import { parseEwbByIrnResponseData, parseEwbResponseData } from "../src/index.js";

describe("parseEwbResponseData", () => {
  const ok =
    '{"ewayBillNo":123456789012,"ewayBillDate":"25/09/2018 10:30:00 AM","validUpto":"26/09/2018 11:59:00 PM"}';
  it("parses a response with all dates in the expected format, without issues", () => {
    const r = parseEwbResponseData(ok);
    expect(r.issues).toEqual([]);
    expect(r.value?.ewayBillNo).toBe("123456789012");
  });
  it("keeps a 16-digit number exactly", () => {
    const r = parseEwbResponseData(ok.replace("123456789012", "1234567890123456"));
    expect(r.value?.ewayBillNo).toBe("1234567890123456");
  });
  it("accepts alert null or text", () => {
    expect(parseEwbResponseData(ok.replace("}", ',"alert":null}')).ok).toBe(true);
    expect(
      parseEwbResponseData(ok.replace("}", ',"alert":"distance not available"}')).value?.alert,
    ).toBe("distance not available");
  });
  it("a date in an unexpected format is a warning (the published samples disagree)", () => {
    const r = parseEwbResponseData(
      ok.replace("25/09/2018 10:30:00 AM", "16 / 09 / 2017 10: 30: 00 AM"),
    );
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([
      expect.objectContaining({ path: ["ewayBillDate"], severity: "warning" }),
    ]);
  });
  it("unknown keys are UNEXPECTED_KEY warnings and the raw JSON is returned", () => {
    const r = parseEwbResponseData(ok.replace("}", ',"extra":{"deep":1}}'));
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([
      expect.objectContaining({ code: "UNEXPECTED_KEY", path: ["extra"], severity: "warning" }),
    ]);
    expect(r.raw).toMatchObject({ extra: { deep: "1" }, ewayBillNo: "123456789012" });
  });
  it("a string ewayBillNo is a type error; a missing key is an error", () => {
    const str = parseEwbResponseData(ok.replace("123456789012", '"123456789012"'));
    expect(str.ok).toBe(false);
    expect(str.issues[0]).toMatchObject({ code: "WRONG_TYPE", path: ["ewayBillNo"] });
    const missing = parseEwbResponseData('{"ewayBillNo":1}');
    expect(missing.ok).toBe(false);
    expect(missing.value).toBeUndefined();
    expect(missing.raw).toEqual({ ewayBillNo: "1" });
  });
  it("bad JSON, arrays and null do not throw", () => {
    expect(parseEwbResponseData("{").issues[0]).toMatchObject({ code: "BAD_JSON" });
    expect(parseEwbResponseData("[]").ok).toBe(false);
    expect(parseEwbResponseData("null").ok).toBe(false);
    expect(parseEwbResponseData("").ok).toBe(false);
  });
});

describe("parseEwbByIrnResponseData", () => {
  const ok =
    '{"EwbNo":111008683051,"EwbDt":"2020-04-24 11:28:00","EwbValidTill":"2020-04-26 23:59:00"}';
  it("parses; Remarks is optional", () => {
    const r = parseEwbByIrnResponseData(ok);
    expect(r.issues).toEqual([]);
    expect(r.value?.EwbNo).toBe("111008683051");
  });
  it("EwbValidTill null is accepted (a Part-A-only EWB has no validity)", () => {
    const r = parseEwbByIrnResponseData(ok.replace('"2020-04-26 23:59:00"', "null"));
    expect(r.ok).toBe(true);
    expect(r.value?.EwbValidTill).toBeNull();
  });
  it("a date in the wrong format is an error", () => {
    const r = parseEwbByIrnResponseData(ok.replace("2020-04-24 11:28:00", "24/04/2020 11:28:00"));
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatchObject({ path: ["EwbDt"], severity: "error" });
  });
  it("unknown keys are warnings", () => {
    const r = parseEwbByIrnResponseData(ok.replace("}", ',"Alert":"x"}'));
    expect(r.ok).toBe(true);
    expect(r.issues[0]).toMatchObject({
      code: "UNEXPECTED_KEY",
      path: ["Alert"],
      severity: "warning",
    });
  });
});
