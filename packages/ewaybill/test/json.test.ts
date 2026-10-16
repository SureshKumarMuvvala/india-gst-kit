import { describe, expect, it } from "vitest";
import {
  parseEwbByIrnRequestJson,
  parseEwbRequestJson,
  serializeEwbByIrnRequest,
  serializeEwbRequest,
  validateEwbRequest,
} from "../src/index.js";
import { edit, mapped, must } from "./helpers.js";

const base = () => mapped("intraInvoice");
const text = () => serializeEwbRequest(base());

describe("serializeEwbRequest", () => {
  it("writes compact JSON in the schema's key order, numbers as raw literals", () => {
    const t = text();
    expect(
      t.startsWith(
        '{"supplyType":"O","subSupplyType":"1","docType":"INV","docNo":"INV/2026-27/0001","docDate":"20/04/2026","fromGstin":"',
      ),
    ).toBe(true);
    expect(t).toContain('"actFromStateCode":29,"fromPincode":560001,"fromStateCode":29,');
    expect(t).toContain('"totalValue":1500.00,"cgstValue":135.00,');
    expect(t).toContain(
      '"itemList":[{"productDesc":"Test goods","hsnCode":8471,"quantity":10,"qtyUnit":"NOS","taxableAmount":1000.00,"sgstRate":9,"cgstRate":9,"igstRate":0,"cessRate":0,"cessNonadvol":0}',
    );
    expect(t).not.toContain('": ');
    expect(t).not.toContain(",\n");
  });
  it("transDistance is a JSON string, transMode and subSupplyType too", () => {
    const t = text();
    expect(t).toContain('"transMode":"1","transDistance":"150",');
    expect(t).toContain('"subSupplyType":"1"');
  });
  it("Distance (by IRN) is a JSON number", () => {
    const t = serializeEwbByIrnRequest({ Distance: "150", TransMode: "1" });
    expect(t).toBe('{"TransMode":"1","Distance":150}');
  });
  it("key order does not depend on the input object's key order", () => {
    const req = base();
    const shuffled = Object.fromEntries(Object.entries(req).reverse()) as typeof req;
    expect(serializeEwbRequest(shuffled)).toBe(serializeEwbRequest(req));
  });
  it("writes 99999999999999.99 byte-exact", () => {
    const req = edit(base(), [
      [["totInvValue"], "99999999999999.99"],
      [["totalValue"], "99999999999999.99"],
    ]) as ReturnType<typeof base>;
    const t = serializeEwbRequest(req);
    expect(t).toContain('"totalValue":99999999999999.99,');
    expect(t).toContain('"totInvValue":99999999999999.99,');
    const back = parseEwbRequestJson(t);
    expect(back.ok).toBe(true);
    expect(back.value?.totInvValue).toBe("99999999999999.99");
    expect(serializeEwbRequest(must(back.value))).toBe(t);
  });
  it("throws on a number string that is not a JSON number literal (programmer error)", () => {
    for (const bad of ["1e3", "+1", "007.00", "1."]) {
      const req = edit(base(), [[["totalValue"], bad]]) as ReturnType<typeof base>;
      expect(() => serializeEwbRequest(req), bad).toThrow(RangeError);
    }
  });
  it("escapes strings with JSON rules", () => {
    const req = edit(base(), [
      [["itemList", 0, "productDesc"], 'Tab\tand "quote" é'],
    ]) as ReturnType<typeof base>;
    const parsed = JSON.parse(serializeEwbRequest(req)) as { itemList: { productDesc: string }[] };
    expect(parsed.itemList[0]?.productDesc).toBe('Tab\tand "quote" é');
  });
});

describe("parseEwbRequestJson", () => {
  it("round-trips: parse → serialise is idempotent and equals the input", () => {
    const t = text();
    const r = parseEwbRequestJson(t);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.value).toEqual(base());
    expect(serializeEwbRequest(must(r.value))).toBe(t);
    expect(
      serializeEwbRequest(must(parseEwbRequestJson(serializeEwbRequest(must(r.value))).value)),
    ).toBe(t);
  });
  it("accepts keys in any order and writes them in the schema's order", () => {
    const obj = JSON.parse(text()) as Record<string, unknown>;
    const shuffled = `{${Object.entries(obj)
      .reverse()
      .map(([k]) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`)
      .join(",")}}`;
    // JSON.stringify turns 1500.00 into 1500: compare structure, not text.
    const r = parseEwbRequestJson(shuffled);
    expect(r.ok).toBe(true);
    expect(Object.keys(JSON.parse(serializeEwbRequest(must(r.value))) as object)[0]).toBe(
      "supplyType",
    );
  });
  it('a string where the schema expects a number is a type error ("otherValue": "-100")', () => {
    const t = text().replace('"otherValue":0.00', '"otherValue":"-100"');
    const r = parseEwbRequestJson(t);
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([
      expect.objectContaining({ code: "WRONG_TYPE", path: ["otherValue"], rule: "S-TYPE" }),
    ]);
  });
  it("and so is the reverse: a number where the schema expects a string (transDistance)", () => {
    const r = parseEwbRequestJson(text().replace('"transDistance":"150"', '"transDistance":150'));
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatchObject({ code: "WRONG_TYPE", path: ["transDistance"] });
    const irn = parseEwbByIrnRequestJson('{"Distance":"150"}');
    expect(irn.issues[0]).toMatchObject({ code: "WRONG_TYPE", path: ["Distance"] });
    expect(parseEwbByIrnRequestJson('{"TransMode":1,"Distance":150}').issues[0]).toMatchObject({
      code: "WRONG_TYPE",
      path: ["TransMode"],
    });
  });
  it("rejects 1e3 as a number literal; +1 and 01 are not JSON at all", () => {
    const exp = parseEwbRequestJson(text().replace('"fromPincode":560001', '"fromPincode":1e3'));
    expect(exp.ok).toBe(false);
    expect(exp.issues.some((i) => i.path.join(".") === "fromPincode")).toBe(true);
    for (const bad of ['"fromPincode":+1', '"fromPincode":01']) {
      const r = parseEwbRequestJson(text().replace('"fromPincode":560001', bad));
      expect(r.ok, bad).toBe(false);
      expect(r.issues[0]).toMatchObject({ code: "BAD_JSON", rule: "S-JSON" });
    }
  });
  it("in-memory strings 1e3, +1 and 01 fail the schema too", () => {
    for (const bad of ["1e3", "+1", "01", "1.", ".5", "0x10", " 1"]) {
      const r = validateEwbRequest(edit(base(), [[["totalValue"], bad]]));
      expect(r.ok, bad).toBe(false);
      expect(
        r.issues.some((i) => i.path.join(".") === "totalValue"),
        bad,
      ).toBe(true);
    }
  });
  it("treats empty optional strings as absent (D-M4)", () => {
    const t = text().replace(
      '"transMode":"1"',
      '"transporterName":"","transDocNo":"","subSupplyDesc":"","transMode":"1"',
    );
    const r = parseEwbRequestJson(t);
    expect(r.ok).toBe(true);
    for (const k of ["transporterName", "transDocNo", "subSupplyDesc"])
      expect(k in must(r.value)).toBe(false);
  });
  it("empty strings elsewhere are still errors (an empty docNo is not absent)", () => {
    const r = parseEwbRequestJson(text().replace('"docNo":"INV/2026-27/0001"', '"docNo":""'));
    expect(r.ok).toBe(true);
    expect(validateEwbRequest(r.value).issues.find((i) => i.rule === "V-G4")?.path).toEqual([
      "docNo",
    ]);
  });
  it("rejects unknown keys, bad JSON and non-objects without throwing", () => {
    expect(
      parseEwbRequestJson(text().replace('"supplyType"', '"shipToGSTIN":"x","supplyType"'))
        .issues[0],
    ).toMatchObject({
      code: "UNEXPECTED_KEY",
      path: ["shipToGSTIN"],
      rule: "S-UNKNOWN-KEY",
    });
    expect(parseEwbRequestJson("{").issues[0]?.code).toBe("BAD_JSON");
    expect(parseEwbRequestJson("[]").ok).toBe(false);
    expect(parseEwbRequestJson("null").ok).toBe(false);
    expect(parseEwbByIrnRequestJson("").ok).toBe(false);
  });
});

describe("parseEwbByIrnRequestJson", () => {
  it("round-trips a mapped by-IRN request", () => {
    const t =
      '{"Irn":"' +
      "a".repeat(64) +
      '","TransMode":"1","Distance":150,"VehNo":"KA01AB1234","VehType":"R","ExpShipDtls":{"Addr1":"Port Road","Loc":"Chennai","Pin":600001,"Stcd":"33"}}';
    const r = parseEwbByIrnRequestJson(t);
    expect(r.issues).toEqual([]);
    expect(serializeEwbByIrnRequest(must(r.value))).toBe(t);
  });
  it("accepts the smallest valid request (Distance is the only required key)", () => {
    const r = parseEwbByIrnRequestJson('{"Distance":0}');
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ Distance: "0" });
  });
});
