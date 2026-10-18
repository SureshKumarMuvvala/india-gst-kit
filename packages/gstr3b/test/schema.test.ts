import { describe, expect, it } from "vitest";
import { Gstr3bReturnSchema, codeOfIssue, emptyFor } from "./schema-helpers.js";

describe("Gstr3bReturnSchema (spec §3, §12 model / schema)", () => {
  it("accepts an all-zero return", () => {
    expect(Gstr3bReturnSchema.safeParse(emptyFor()).success).toBe(true);
  });

  it("rejects unknown keys at every level", () => {
    const paths: ((r: Record<string, unknown>) => void)[] = [
      (r) => (r["extra"] = 1),
      (r) => ((r["t31"] as Record<string, unknown>)["f"] = { taxableValue: "0.00" }),
      (r) =>
        (((r["t31"] as Record<string, Record<string, unknown>>)["a"] as Record<string, unknown>)[
          "val"
        ] = "0.00"),
      (r) =>
        ((
          (r["t4"] as Record<string, Record<string, unknown>>)["available"] as Record<
            string,
            unknown
          >
        )["XYZ"] = {}),
      (r) => ((r["t51"] as Record<string, unknown>)["lateFee"] = {}),
    ];
    for (const mutate of paths) {
      const r = emptyFor() as unknown as Record<string, unknown>;
      mutate(r);
      expect(Gstr3bReturnSchema.safeParse(r).success).toBe(false);
    }
  });

  it.each(["1.5", "-0.00", "10000000000000.00", "1e3", "01.00", "1,000.00", ""])(
    "rejects %j as money (AMOUNT_OUT_OF_RANGE)",
    (v) => {
      const r = emptyFor();
      r.t31.a.taxableValue = v;
      const p = Gstr3bReturnSchema.safeParse(r);
      expect(p.success).toBe(false);
      if (!p.success) expect(codeOfIssue(p.error.issues[0])).toBe("AMOUNT_OUT_OF_RANGE");
    },
  );

  it("accepts the extremes ±9999999999999.99", () => {
    const r = emptyFor();
    r.t31.a.taxableValue = "9999999999999.99";
    r.t31.a.igst = "-9999999999999.99";
    expect(Gstr3bReturnSchema.safeParse(r).success).toBe(true);
  });

  it("rejects negatives in unsigned fields: 4B.RUL, 4B.OTH, 4D.RUL, 5, 5.1 (NEGATIVE_NOT_ALLOWED)", () => {
    const setters: ((r: ReturnType<typeof emptyFor>) => void)[] = [
      (r) => (r.t4.reversed.RUL.igst = "-1.00"),
      (r) => (r.t4.reversed.OTH.cess = "-1.00"),
      (r) => (r.t4.ineligible.RUL.cgst = "-1.00"),
      (r) => (r.t5.GST.inter = "-1.00"),
      (r) => (r.t5.NONGST.intra = "-1.00"),
      (r) => (r.t51.interest.sgst = "-1.00"),
    ];
    for (const set of setters) {
      const r = emptyFor();
      set(r);
      const p = Gstr3bReturnSchema.safeParse(r);
      expect(p.success).toBe(false);
      if (!p.success) expect(codeOfIssue(p.error.issues[0])).toBe("NEGATIVE_NOT_ALLOWED");
    }
  });

  it("accepts negatives in 3.1, 3.2, 4A, 4C and 4D.OTH", () => {
    const r = emptyFor();
    r.t31.a.taxableValue = "-1.00";
    r.t31.b.igst = "-1.00";
    r.t31.c.taxableValue = "-1.00";
    r.t31.d.cess = "-1.00";
    r.t31.e.taxableValue = "-1.00";
    r.t311.i.igst = "-1.00";
    r.t32.unregistered.push({ pos: "27", taxableValue: "-1.00", igst: "-0.18" });
    r.t4.available.OTH.igst = "-1.00";
    r.t4.net.cgst = "-1.00";
    r.t4.ineligible.OTH.sgst = "-1.00";
    expect(Gstr3bReturnSchema.safeParse(r).success).toBe(true);
  });
});
