import { describe, expect, it } from "vitest";
import { toApiSavePayload, toOfflineUploadJson, serializeGstr1 } from "../src/index.js";
import {
  build,
  codes,
  first,
  list,
  mkDoc,
  parties,
  rec,
  ret,
  unregMh,
  validateS4,
  validateS5,
  type DocSpec,
} from "./helpers.js";
import { api, offline } from "./a2-helpers.js";

// Spec §17.3 / §17.13 "9A / 9C". Originals are reported in earlier periods; the return period is 102026.

const orig = (spec: DocSpec, period = "062025") => ({
  document: mkDoc({ date: "2025-06-10", ...spec }),
  period,
});
const amend = (o: ReturnType<typeof orig>, revised: DocSpec) => ({
  original: o,
  revised: mkDoc({ date: "2026-10-08", ...revised }),
});

describe("9A — b2ba", () => {
  it("revised inum/idt/val/items with the original oinum/oidt; validates against S5 and S4", () => {
    const a = amend(orig({ number: "INV/O1", recipient: parties.recipientMh }), {
      number: "INV/R1",
      recipient: parties.recipientMh,
      lines: [{ taxable: "1200.00" }],
    });
    const j = api([], { amendments: [a] });
    const g = rec(list(j, "b2ba")[0]);
    expect(g["ctin"]).toBe(parties.recipientMh["gstin"]);
    expect(list(g, "inv")[0]).toEqual({
      inum: "INV/R1",
      idt: "08-10-2026",
      oinum: "INV/O1",
      oidt: "10-06-2025",
      val: 1416,
      pos: "27",
      rchrg: "N",
      inv_typ: "R",
      itms: [{ num: 1801, itm_det: { txval: 1200, rt: 18, iamt: 216, csamt: 0 } }],
    });
    expect(validateS5(j) || JSON.stringify(validateS5.errors)).toBe(true);
    const b = offline([], { amendments: [a] });
    expect(validateS4(b) || JSON.stringify(validateS4.errors)).toBe(true);
    expect(b["b2ba"]).toEqual(j["b2ba"]);
  });

  it("an intra-state original and revision carry camt/samt", () => {
    const j = api([], {
      amendments: [
        amend(orig({ number: "A1" }), { number: "A1R", lines: [{ taxable: "500.00" }] }),
      ],
    });
    expect(rec(rec(list(rec(list(j, "b2ba")[0]), "inv")[0]), "itms", 0, "itm_det")).toEqual({
      txval: 500,
      rt: 18,
      camt: 45,
      samt: 45,
      csamt: 0,
    });
  });

  it("the revised number may equal the original's (C cdnra.csv sample)", () => {
    expect(
      codes([], { amendments: [amend(orig({ number: "SAME" }), { number: "SAME" })] }),
    ).toEqual([]);
  });
});

describe("9A — b2cla", () => {
  const big = [{ taxable: "100000.00" }];
  it("B2CL original → b2cla grouped by the original POS; no invoice-level pos", () => {
    const a = amend(orig({ number: "L1", recipient: unregMh, lines: big }, "092025"), {
      number: "L1R",
      recipient: unregMh,
      lines: [{ taxable: "110000.00" }],
    });
    const j = api([], { amendments: [a] });
    const g = rec(list(j, "b2cla")[0]);
    expect(g["pos"]).toBe("27");
    const inv = rec(list(g, "inv")[0]);
    expect(inv["oinum"]).toBe("L1");
    expect("pos" in inv).toBe(false);
    expect(validateS5(j) || JSON.stringify(validateS5.errors)).toBe(true);
  });

  it("a revised POS → AMENDMENT_POS_CHANGE", () => {
    const other = {
      ...unregMh,
      stateCode: "33",
      address: { ...(unregMh["address"] as object), stateCode: "33" },
    };
    const a = amend(orig({ number: "L2", recipient: unregMh, lines: big }, "092025"), {
      number: "L2R",
      recipient: other,
      lines: big,
    });
    expect(codes([], { amendments: [a] })).toEqual(["AMENDMENT_POS_CHANGE"]);
  });

  it("threshold: a ₹1.5 lakh inter-state original of 072024 was B2CS → AMENDMENT_USE_TABLE_10", () => {
    const lines = [{ taxable: "150000.00", rate: "0" }];
    const a = amend(
      orig({ number: "T1", date: "2024-07-10", recipient: unregMh, lines }, "072024"),
      {
        number: "T1R",
        recipient: unregMh,
        lines,
      },
    );
    expect(codes([], { amendments: [a] })).toEqual(["AMENDMENT_USE_TABLE_10"]);
  });

  it("the same original reported in 082024 → b2cla; revised to ₹90,000 → AMENDMENT_SECTION_CHANGE", () => {
    const lines = [{ taxable: "150000.00", rate: "0" }];
    const o = orig({ number: "T2", date: "2024-08-10", recipient: unregMh, lines }, "082024");
    const ok = amend(o, { number: "T2R", recipient: unregMh, lines });
    expect(list(api([], { amendments: [ok] }), "b2cla")).toHaveLength(1);
    const small = amend(o, {
      number: "T2S",
      recipient: unregMh,
      lines: [{ taxable: "90000.00", rate: "0" }],
    });
    expect(codes([], { amendments: [small] })).toEqual(["AMENDMENT_SECTION_CHANGE"]);
  });
});

describe("9A — expa", () => {
  it("export original → expa; exp_typ from the revised invoice; WOPAY items carry 0.00 tax", () => {
    const a = amend(
      orig({
        number: "E1",
        recipient: parties.overseas,
        pos: "96",
        category: "EXPORT_WITH_PAYMENT",
      }),
      {
        number: "E1R",
        recipient: parties.overseas,
        pos: "96",
        category: "EXPORT_WITHOUT_PAYMENT",
      },
    );
    const j = api([], { amendments: [a] });
    const g = rec(list(j, "expa")[0]);
    expect(g["exp_typ"]).toBe("WOPAY");
    const inv = rec(list(g, "inv")[0]);
    expect([inv["oinum"], inv["oidt"]]).toEqual(["E1", "10-06-2025"]);
    expect(list(inv, "itms")[0]).toEqual({ txval: 1000, rt: 18, iamt: 0, csamt: 0 });
    expect(validateS5(j) || JSON.stringify(validateS5.errors)).toBe(true);
  });
});

describe("9C — cdnra / cdnura", () => {
  const invMh = mkDoc({ number: "INV/X", date: "2025-05-05", recipient: parties.recipientMh });
  const originals = { options: { originalInvoices: [{ document: invMh, period: "052025" }] } };
  const note = (number: string, taxable: string, date: string): DocSpec => ({
    kind: "CREDIT_NOTE",
    number,
    date,
    recipient: parties.recipientMh,
    original: { number: "INV/X", date: "2025-05-05" },
    lines: [{ taxable }],
  });

  it("cdnr original → cdnra with ont_num/ont_dt; positive amounts; ntty C", () => {
    const a = amend(
      orig(note("CN/1", "500.00", "2025-06-10")),
      note("CN/1R", "400.00", "2026-10-08"),
    );
    const j = api([], { amendments: [a], ...originals });
    const nt = rec(list(rec(list(j, "cdnra")[0]), "nt")[0]);
    expect([nt["nt_num"], nt["ont_num"], nt["ont_dt"], nt["ntty"], nt["val"]]).toEqual([
      "CN/1R",
      "CN/1",
      "10-06-2025",
      "C",
      472,
    ]);
    expect(validateS5(j) || JSON.stringify(validateS5.errors)).toBe(true);
    expect(validateS4(offline([], { amendments: [a], ...originals }))).toBe(true);
  });

  it("cdnur EXPWOP original → cdnura without pos; cdnur B2CL original → cdnura with pos", () => {
    const expInv = mkDoc({
      number: "EXP/X",
      date: "2025-05-05",
      recipient: parties.overseas,
      pos: "96",
      category: "EXPORT_WITHOUT_PAYMENT",
    });
    const bigInv = mkDoc({
      number: "B2CL/X",
      date: "2025-05-05",
      recipient: unregMh,
      lines: [{ taxable: "200000.00" }],
    });
    const opts = {
      options: {
        originalInvoices: [
          { document: expInv, period: "052025" },
          { document: bigInv, period: "052025" },
        ],
      },
    };
    const expNote = (number: string, date: string) =>
      ({
        kind: "CREDIT_NOTE",
        number,
        date,
        recipient: parties.overseas,
        pos: "96",
        category: "EXPORT_WITHOUT_PAYMENT",
        original: { number: "EXP/X", date: "2025-05-05" },
      }) as const;
    const clNote = (number: string, date: string) =>
      ({
        kind: "DEBIT_NOTE",
        number,
        date,
        recipient: unregMh,
        original: { number: "B2CL/X", date: "2025-05-05" },
      }) as const;
    const j = api([], {
      amendments: [
        amend(orig(expNote("EN/1", "2025-06-10")), expNote("EN/1R", "2026-10-08")),
        amend(orig(clNote("DN/1", "2025-06-10")), clNote("DN/1R", "2026-10-08")),
      ],
      ...opts,
    });
    const [e, c] = list(j, "cdnura").map((x) => rec(x));
    expect(e?.["typ"]).toBe("EXPWOP");
    expect(e !== undefined && "pos" in e).toBe(false);
    expect([c?.["typ"], c?.["pos"], c?.["ntty"]]).toEqual(["B2CL", "27", "D"]);
    expect(validateS5(j) || JSON.stringify(validateS5.errors)).toBe(true);
  });

  it("a note on a B2CS original (netted, N4) → AMENDMENT_USE_TABLE_10", () => {
    const smallInv = mkDoc({ number: "S/X", date: "2025-05-05", recipient: parties.unregistered });
    const n = (number: string, date: string) =>
      ({
        kind: "CREDIT_NOTE",
        number,
        date,
        recipient: parties.unregistered,
        original: { number: "S/X", date: "2025-05-05" },
      }) as const;
    expect(
      codes([], {
        amendments: [amend(orig(n("SN/1", "2025-06-10")), n("SN/1R", "2026-10-08"))],
        options: { originalInvoices: [{ document: smallInv, period: "052025" }] },
      }),
    ).toEqual(["AMENDMENT_USE_TABLE_10"]);
  });
});

describe("9A / 9C — errors", () => {
  const o = orig({ number: "O1" });
  it("original period = current, or 062017 → AMENDMENT_PERIOD", () => {
    expect(codes([], { amendments: [amend({ ...o, period: "102026" }, { number: "R" })] })).toEqual(
      ["AMENDMENT_PERIOD"],
    );
    expect(codes([], { amendments: [amend({ ...o, period: "062017" }, { number: "R" })] })).toEqual(
      ["AMENDMENT_PERIOD"],
    );
  });
  it("kind changed → AMENDMENT_KIND_MISMATCH", () => {
    expect(
      codes([], {
        amendments: [
          amend(o, {
            number: "R",
            kind: "DEBIT_NOTE",
            original: { number: "O1", date: "2025-06-10" },
          }),
        ],
      }),
    ).toContain("AMENDMENT_KIND_MISMATCH");
  });
  it("recipient changed → AMENDMENT_RECIPIENT_CHANGE", () => {
    expect(
      codes([], { amendments: [amend(o, { number: "R", recipient: parties.recipientMh })] }),
    ).toEqual(["AMENDMENT_RECIPIENT_CHANGE"]);
  });
  it("registered → unregistered → AMENDMENT_SECTION_CHANGE", () => {
    expect(
      codes([], { amendments: [amend(o, { number: "R", recipient: parties.unregistered })] }),
    ).toEqual(["AMENDMENT_SECTION_CHANGE"]);
  });
  it("two amendments of one original, or one revised number twice → DUPLICATE_AMENDMENT", () => {
    expect(
      codes([], { amendments: [amend(o, { number: "R1" }), amend(o, { number: "R2" })] }),
    ).toEqual(["DUPLICATE_AMENDMENT"]);
    expect(
      codes([], {
        amendments: [amend(o, { number: "R1" }), amend(orig({ number: "O2" }), { number: "R1" })],
      }),
    ).toEqual(["DUPLICATE_AMENDMENT"]);
  });
  it("original also in documents → AMENDMENT_ORIGINAL_IN_PERIOD", () => {
    expect(codes([o.document], { amendments: [amend(o, { number: "R" })] })).toContain(
      "AMENDMENT_ORIGINAL_IN_PERIOD",
    );
  });
  it("revised date after the period end → DATE_OUT_OF_RANGE; revised rate 0.5 → RATE_NOT_ACCEPTED", () => {
    expect(codes([], { amendments: [amend(o, { number: "R", date: "2026-11-01" })] })).toEqual([
      "DATE_OUT_OF_RANGE",
    ]);
    expect(
      codes([], {
        amendments: [amend(o, { number: "R", lines: [{ taxable: "100.00", rate: "0.5" }] })],
      }),
    ).toEqual(["RATE_NOT_ACCEPTED"]);
  });
  it("issues are collected across amendments, with paths", () => {
    const r = build([], {
      amendments: [
        amend({ ...o, period: "102026" }, { number: "R" }),
        amend(orig({ number: "O3" }), { number: "S", recipient: parties.recipientMh }),
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.map((i) => [i.code, i.path?.[1]])).toEqual([
      ["AMENDMENT_PERIOD", 0],
      ["AMENDMENT_RECIPIENT_CHANGE", 1],
    ]);
  });
});

describe("9A / 9C — originals are internal only", () => {
  it("Gstr1Return holds the original items; neither output contains them", () => {
    const a = amend(orig({ number: "O9", lines: [{ taxable: "777.77" }] }), {
      number: "R9",
      lines: [{ taxable: "1000.00" }],
    });
    const r = ret([], { amendments: [a] });
    const inv = first(first(r.b2ba).invoices);
    expect(inv.original.items).toEqual([
      { rate: "18", taxableValue: "777.77", cgst: "70.00", sgst: "70.00", cess: "0.00" },
    ]);
    expect(inv.original.period).toBe("062025");
    const ta = toApiSavePayload(r);
    const tb = toOfflineUploadJson(r);
    if (!ta.ok || !tb.ok) throw new Error("render failed");
    expect(serializeGstr1(ta.value)).not.toContain("777.77");
    expect(serializeGstr1(tb.value)).not.toContain("777.77");
  });
});
