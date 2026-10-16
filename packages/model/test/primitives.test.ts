import { describe, expect, it } from "vitest";
import {
  GstRateSchema,
  HsnSacSchema,
  IsoDateSchema,
  MoneySchema,
  QuantitySchema,
  SignedMoneySchema,
  UnitPriceSchema,
} from "../src/index.js";

const ok = (s: { safeParse: (x: unknown) => { success: boolean } }, x: unknown) =>
  s.safeParse(x).success;

describe("Money", () => {
  it.each(["0.00", "12.50", "999999999999999.99"])("accepts %s", (x) => {
    expect(ok(MoneySchema, x)).toBe(true);
  });
  it.each(["12.5", "12", "-1.00", "1e3", "1.000", "", " 1.00", "1,000.00", "1234567890123456.00"])(
    "rejects %j",
    (x) => {
      expect(ok(MoneySchema, x)).toBe(false);
    },
  );
  it("rejects JS numbers", () => {
    expect(ok(MoneySchema, 12.5)).toBe(false);
    expect(ok(MoneySchema, 0)).toBe(false);
  });
});

describe("SignedMoney", () => {
  it.each(["0.00", "-0.50", "0.99"])("accepts %s", (x) => {
    expect(ok(SignedMoneySchema, x)).toBe(true);
  });
  it.each(["-1", "+1.00", "1.5"])("rejects %s", (x) => {
    expect(ok(SignedMoneySchema, x)).toBe(false);
  });
});

describe("IsoDate", () => {
  it.each(["2028-02-29", "2026-04-20", "2026-12-31"])("accepts %s", (x) => {
    expect(ok(IsoDateSchema, x)).toBe(true);
  });
  it.each(["2026-02-29", "2026-13-01", "26-01-01", "2026-1-1", "2026-04-31", "20/04/2026", ""])(
    "rejects %j",
    (x) => {
      expect(ok(IsoDateSchema, x)).toBe(false);
    },
  );
  it("rejects Date objects", () => {
    expect(ok(IsoDateSchema, new Date())).toBe(false);
  });
});

describe("Quantity / UnitPrice precision (source C)", () => {
  it("Quantity: up to 10 integer digits and 3 decimals, > 0", () => {
    for (const x of ["1", "0.001", "9999999999.999", "10.5"])
      expect(ok(QuantitySchema, x)).toBe(true);
    for (const x of ["0", "0.000", "10000000000", "1.0001", "-1", "1e2", ""]) {
      expect(ok(QuantitySchema, x)).toBe(false);
    }
  });
  it("UnitPrice: up to 12 integer digits and 3 decimals, zero allowed", () => {
    for (const x of ["0", "0.00", "999999999999.999", "12.345"])
      expect(ok(UnitPriceSchema, x)).toBe(true);
    for (const x of ["1000000000000", "1.0001", "-1", ""])
      expect(ok(UnitPriceSchema, x)).toBe(false);
  });
});

describe("GstRate (source C: 0–999.999, 3 dp; no rate list)", () => {
  it.each(["0", "5", "2.5", "0.25", "1.5", "18", "28", "999.999"])("accepts %s", (x) => {
    expect(ok(GstRateSchema, x)).toBe(true);
  });
  it.each(["-1", "1000", "5.0000", "05", "abc", "", "5.", ".5", "1e1"])("rejects %j", (x) => {
    expect(ok(GstRateSchema, x)).toBe(false);
  });
  it("accepts a rate the portal says is withdrawn (0.5): the model decides no taxability", () => {
    expect(ok(GstRateSchema, "0.5")).toBe(true);
  });
});

describe("HsnSac", () => {
  it.each(["8471", "847130", "84713010", "998313"])("accepts %s", (x) => {
    expect(ok(HsnSacSchema, x)).toBe(true);
  });
  it.each(["847", "84713", "8471301", "847130100", "0000", "000000", "00000000", "84A1", ""])(
    "rejects %j",
    (x) => {
      expect(ok(HsnSacSchema, x)).toBe(false);
    },
  );
});
