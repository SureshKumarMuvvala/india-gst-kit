import { describe, expect, it } from "vitest";
import { parseGstr2bJson, type Gstr2bRecord } from "@india-gst-kit/recon";
import { GSTINS, gstr2bFixtureText } from "@india-gst-kit/fixtures";
import { sumGstr2bRecords } from "../src/index.js";
import { codes, draftOf, first } from "./helpers.js";

function records(): Gstr2bRecord[] {
  const r = parseGstr2bJson(gstr2bFixtureText);
  if (r.value === undefined) throw new Error("2B fixture does not parse");
  return r.value.records;
}
const withItc = (r: Gstr2bRecord, itcavl: "Y" | "N" | "T"): Gstr2bRecord => ({
  ...r,
  itc: { ...r.itc, itcavl },
});

describe("sumGstr2bRecords (spec §5.2, D-H11)", () => {
  it("groups by document type × itcavl × reverse charge × origin × period and never nets credit notes", () => {
    const recs = records();
    const t = sumGstr2bRecords(recs, { label: "Oct" });
    expect(t.label).toBe("Oct");
    const types = t.groups.map((g) => g.key.documentType);
    expect(types).toContain("INVOICE");
    expect(types).toContain("CREDIT_NOTE");
    // Credit-note totals stay positive, as 2B reports them.
    const cn = t.groups.find((g) => g.key.documentType === "CREDIT_NOTE");
    expect(cn?.totals.taxableValue.startsWith("-")).toBe(false);
    expect(t.groups.reduce((n, g) => n + g.count, 0)).toBe(recs.length);
  });

  it("does not filter: itcavl N records are totalled like Y ones, in their own group", () => {
    const r = first(records());
    const t = sumGstr2bRecords([withItc(r, "Y"), withItc(r, "N")]);
    expect(t.groups.map((g) => [g.key.itcavl, g.count])).toEqual([
      ["Y", 1],
      ["N", 1],
    ]);
    expect(t.groups[1]?.totals).toEqual(t.groups[0]?.totals);
  });

  it("totals are exact decimal sums (0.10 + 0.20 = 0.30)", () => {
    const r = first(records());
    const a = { ...r, amounts: { ...r.amounts, igst: "0.10" } };
    const b = { ...r, amounts: { ...r.amounts, igst: "0.20" } };
    expect(first(sumGstr2bRecords([a, b]).groups).totals.igst).toBe("0.30");
  });

  it("warns on a mixed period and a foreign recipient, and still totals the records", () => {
    const r = first(records());
    const t = sumGstr2bRecords(
      [r, { ...r, returnPeriod: "092026", recipientGstin: GSTINS.spareKa }],
      {
        filerGstin: r.recipientGstin,
        period: r.returnPeriod,
      },
    );
    expect(codes(t.issues)).toEqual(["RECIPIENT_MISMATCH", "PERIOD_MIXED"]);
    expect(t.issues.every((i) => i.severity === "warning")).toBe(true);
    expect(t.groups.reduce((n, g) => n + g.count, 0)).toBe(2);
  });

  it("only the selected groups reach the box, with the given sign, as GSTR2B_SUM trail entries", () => {
    const r = first(records());
    const totals = sumGstr2bRecords([withItc(r, "Y"), withItc(r, "N")], { label: "sel" });
    const d = draftOf({
      fromGstr2b: [{ box: "4A.OTH", sign: "+", totals, groupIndexes: [0] }],
      itcNet: "COMPUTE",
    });
    expect(d.return.t4.available.OTH.igst).toBe(first(totals.groups).totals.igst);
    const e = d.trail.find((x) => x.source === "GSTR2B_SUM");
    expect(e?.ref).toContain("sel #0 INVOICE/itcavl=Y");
    const neg = draftOf({
      fromGstr2b: [{ box: "3.1d", sign: "-", totals, groupIndexes: [1] }],
      itcNet: "COMPUTE",
    });
    expect(neg.return.t31.d.taxableValue).toBe(`-${first(totals.groups).totals.taxableValue}`);
  });
});
