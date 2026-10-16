import { describe, expect, it } from "vitest";
import { parseIrnRequestJson, serializeIrnRequest } from "../src/index.js";
import { edit, mapped, mutate } from "./helpers.js";

const base = () => mapped("intraInvoice");
const text = () => serializeIrnRequest(base());

describe("serializeIrnRequest", () => {
  it("writes compact JSON in the schema's key order, numbers as raw literals", () => {
    const t = text();
    expect(
      t.startsWith(
        '{"Version":"1.1","TranDtls":{"TaxSch":"GST","SupTyp":"B2B","RegRev":"N","IgstOnIntra":"N"},"DocDtls":{"Typ":"INV","No":"INV/2026-27/0001","Dt":"20/04/2026"},"SellerDtls":{"Gstin":',
      ),
    ).toBe(true);
    expect(t).toContain('"Pin":560001,"Stcd":"29"');
    expect(t).toContain('"Qty":10,"Unit":"NOS","UnitPrice":100.00,"TotAmt":1000.00');
    expect(t).toContain('"ValDtls":{"AssVal":1500.00,"CgstVal":135.00');
    expect(t).not.toContain('": ');
    expect(t).not.toContain(",\n");
  });

  it("key order does not depend on the order of the input object's keys", () => {
    const req = base();
    const shuffled = Object.fromEntries(Object.entries(req).reverse()) as typeof req;
    expect(serializeIrnRequest(shuffled)).toBe(serializeIrnRequest(req));
  });

  it("writes 99999999999999.99 byte-exact (16 significant digits, no double)", () => {
    const req = edit(base(), [[["ValDtls", "AssVal"], "99999999999999.99"]]) as ReturnType<
      typeof base
    >;
    const t = serializeIrnRequest(req);
    expect(t).toContain('"AssVal":99999999999999.99,');
    expect(JSON.parse(t) as unknown).toBeTypeOf("object");
  });

  it("throws on a number string that is not a JSON number literal (programmer error)", () => {
    const req = edit(base(), [[["ValDtls", "AssVal"], "1e3"]]) as ReturnType<typeof base>;
    expect(() => serializeIrnRequest(req)).toThrow(RangeError);
    const lead = edit(base(), [[["ValDtls", "AssVal"], "007.00"]]) as ReturnType<typeof base>;
    expect(() => serializeIrnRequest(lead)).toThrow(RangeError);
  });

  it("escapes strings with JSON rules", () => {
    const req = edit(base(), [[["ItemList", 0, "PrdDesc"], "Tab\tand é and  "]]) as ReturnType<
      typeof base
    >;
    const parsed = JSON.parse(serializeIrnRequest(req)) as { ItemList: { PrdDesc: string }[] };
    expect(parsed.ItemList[0]?.PrdDesc).toBe("Tab\tand é and  ");
  });
});

describe("parseIrnRequestJson", () => {
  it("round-trips: parse → serialise is idempotent and keeps exact decimals", () => {
    const t = text();
    const r = parseIrnRequestJson(t);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.value).toEqual(base());
    expect(serializeIrnRequest(r.value as ReturnType<typeof base>)).toBe(t);
  });

  it("99999999999999.99 (the schema maximum, 16 significant digits) round-trips byte-exact", () => {
    const t = text().replace('"AssVal":1500.00', '"AssVal":99999999999999.99');
    const r = parseIrnRequestJson(t);
    expect(r.value?.ValDtls.AssVal).toBe("99999999999999.99");
    expect(serializeIrnRequest(r.value as ReturnType<typeof base>)).toBe(t);
  });

  it("a value above the source maximum is rejected, even by one unit in the 16th digit", () => {
    const t = text().replace('"AssVal":1500.00', '"AssVal":100000000000000.00');
    const r = parseIrnRequestJson(t);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.path.join("."))).toContain("ValDtls.AssVal");
  });

  it("keeps trailing zeros: 100.00 stays '100.00'", () => {
    const r = parseIrnRequestJson(text());
    expect(r.value?.ItemList[0]?.UnitPrice).toBe("100.00");
  });

  it("rejects an exponent literal in a number field", () => {
    const r = parseIrnRequestJson(text().replace('"AssVal":1500.00', '"AssVal":1e3'));
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.path.join("."))).toContain("ValDtls.AssVal");
  });

  it("rejects a leading + (not JSON) as BAD_JSON", () => {
    const r = parseIrnRequestJson(text().replace('"AssVal":1500.00', '"AssVal":+1'));
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.code).toBe("BAD_JSON");
    expect(r.value).toBeUndefined();
  });

  it("rejects a JSON string where the schema expects a number", () => {
    const r = parseIrnRequestJson(text().replace('"AssVal":1500.00', '"AssVal":"1500.00"'));
    expect(r.ok).toBe(false);
    const issue = r.issues.find((i) => i.path.join(".") === "ValDtls.AssVal");
    expect(issue?.code).toBe("WRONG_TYPE");
  });

  it("rejects a JSON number where the schema expects a string", () => {
    const r = parseIrnRequestJson(text().replace('"Stcd":"29"', '"Stcd":29'));
    expect(r.ok).toBe(false);
    const issue = r.issues.find((i) => i.path.join(".") === "SellerDtls.Stcd");
    expect(issue?.code).toBe("WRONG_TYPE");
  });

  it("rejects an unknown key, even one holding a number", () => {
    const t = text().replace('"Version":"1.1"', '"Version":"1.1","DocumentDiscount":5');
    const r = parseIrnRequestJson(t);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.path.join("."))).toContain("DocumentDiscount");
  });

  it("returns BAD_JSON for text that is not JSON, and an issue for a non-object", () => {
    expect(parseIrnRequestJson("{nope").issues[0]?.code).toBe("BAD_JSON");
    expect(parseIrnRequestJson("[]").ok).toBe(false);
    expect(parseIrnRequestJson("null").ok).toBe(false);
  });

  it("is case-insensitive for SupTyp/Typ and normalises to upper case", () => {
    const t = text()
      .replace('"SupTyp":"B2B"', '"SupTyp":"b2b"')
      .replace('"Typ":"INV"', '"Typ":"inv"');
    const r = parseIrnRequestJson(t);
    expect(r.ok).toBe(true);
    expect(r.value?.TranDtls.SupTyp).toBe("B2B");
    expect(r.value?.DocDtls.Typ).toBe("INV");
  });

  it("does not mutate or depend on the input object (mutate helper sanity)", () => {
    const a = base();
    const b = mutate(a, ["Version"], "9");
    expect(a.Version).toBe("1.1");
    expect((b as { Version: string }).Version).toBe("9");
  });
});
