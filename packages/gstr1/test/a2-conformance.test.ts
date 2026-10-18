import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildGstr1,
  parseApiSavePayloadJson,
  parseOfflineUploadJson,
  serializeGstr1,
  toApiSavePayload,
  toOfflineUploadJson,
  type Gstr1Input,
  type Gstr1Return,
} from "../src/index.js";
import {
  FILER,
  GSTINS,
  mkDoc,
  parties,
  PERIOD,
  put,
  unregMh,
  validateS4,
  validateS5,
} from "./helpers.js";
import { goldenDocs } from "./scenarios.js";

// Spec §17.9 / §17.13: schema conformance, the DEC-7 normalisation extended by O8 / O10, golden (a) and (b).

type Json = Record<string, unknown>;

/** A mixed synthetic period with every Track A2 section that output (b) can express. */
export function a2Golden(): {
  documents: ReturnType<typeof goldenDocs>;
  extra: Partial<Gstr1Input>;
} {
  const documents = goldenDocs();
  const invMh = mkDoc({ number: "A2/I1", date: "2025-05-05", recipient: parties.recipientMh });
  const bigInv = mkDoc({
    number: "A2/I2",
    date: "2025-05-05",
    recipient: unregMh,
    lines: [{ taxable: "200000.00" }],
  });
  const o = (spec: Parameters<typeof mkDoc>[0], period = "062025") => ({
    document: mkDoc({ date: "2025-06-10", ...spec }),
    period,
  });
  const rev = (spec: Parameters<typeof mkDoc>[0]) => mkDoc({ date: "2026-10-08", ...spec });
  const cn = (
    number: string,
    original: string,
    recipient: Record<string, unknown> = parties.recipientMh,
  ) =>
    ({
      kind: "CREDIT_NOTE",
      number,
      recipient,
      original: { number: original, date: "2025-05-05" },
    }) as const;
  return {
    documents,
    extra: {
      options: {
        originalInvoices: [
          { document: invMh, period: "052025" },
          { document: bigInv, period: "052025" },
        ],
      },
      ecoMarks: [{ kind: "TAX_INVOICE", number: "INV/G1", etin: GSTINS.ecoOperatorKa }],
      amendments: [
        {
          original: o({ number: "A2/O1", recipient: parties.recipientMh }),
          revised: rev({
            number: "A2/R1",
            recipient: parties.recipientMh,
            lines: [{ taxable: "1200.00" }],
          }),
        },
        {
          original: o({ number: "A2/O2", recipient: unregMh, lines: [{ taxable: "150000.00" }] }),
          revised: rev({ number: "A2/R2", recipient: unregMh, lines: [{ taxable: "160000.00" }] }),
        },
        {
          original: o({
            number: "A2/O3",
            recipient: parties.overseas,
            pos: "96",
            category: "EXPORT_WITH_PAYMENT",
          }),
          revised: rev({
            number: "A2/R3",
            recipient: parties.overseas,
            pos: "96",
            category: "EXPORT_WITH_PAYMENT",
            lines: [{ taxable: "900.00" }],
          }),
        },
        {
          original: o({ ...cn("A2/CN1", "A2/I1"), lines: [{ taxable: "100.00" }] }),
          revised: rev({ ...cn("A2/CN1R", "A2/I1"), lines: [{ taxable: "80.00" }] }),
        },
        {
          original: o({ ...cn("A2/CN2", "A2/I2", unregMh), lines: [{ taxable: "100.00" }] }),
          revised: rev({ ...cn("A2/CN2R", "A2/I2", unregMh), lines: [{ taxable: "150.00" }] }),
        },
      ],
      b2csAmendments: [
        {
          originalPeriod: "062025",
          pos: "29",
          rate: "18",
          revised: { taxableValue: "1000", cgst: "90", sgst: "90", cess: "0" },
          original: { taxableValue: "800", cgst: "72", sgst: "72", cess: "0" },
        },
        {
          originalPeriod: "062025",
          pos: "27",
          rate: "5",
          revised: { taxableValue: "-100", igst: "-5", cess: "0" },
          original: { taxableValue: "0", igst: "0", cess: "0" },
        },
      ],
      nil: [
        { supply: "INTER_REGISTERED", nilRated: "10", exempted: "20", nonGst: "30" },
        { supply: "INTRA_UNREGISTERED", nilRated: "1", exempted: "0", nonGst: "0" },
      ],
      advances: {
        received: [
          {
            party: {
              kind: "B2B",
              recipientGstin: GSTINS.recipientMh,
              pos: "27",
              invoiceType: "R",
              reverseCharge: false,
            },
            items: [{ rate: "18", amount: "1000", igst: "180" }],
          },
          {
            party: { kind: "B2C", pos: "27" },
            items: [
              { rate: "18", amount: "500", igst: "90" },
              { rate: "5", amount: "100", igst: "5" },
            ],
          },
          {
            party: { kind: "B2C", pos: "29" },
            items: [{ rate: "18", amount: "200", cgst: "18", sgst: "18" }],
          },
        ],
        adjusted: [
          {
            party: { kind: "B2C", pos: "29" },
            items: [{ rate: "18", amount: "100", cgst: "9", sgst: "9" }],
          },
        ],
        receivedAmendments: [
          {
            originalPeriod: "062025",
            original: { kind: "B2C", pos: "27" },
            revised: {
              party: { kind: "B2C", pos: "27" },
              items: [{ rate: "18", amount: "300", igst: "54" }],
            },
          },
        ],
        adjustedAmendments: [
          {
            originalPeriod: "062025",
            original: { kind: "B2C", pos: "29" },
            revised: {
              party: { kind: "B2C", pos: "29" },
              items: [{ rate: "18", amount: "50", cgst: "4.5", sgst: "4.5" }],
            },
          },
        ],
      },
      supeco: {
        collectsTcs: [
          {
            etin: GSTINS.ecoOperatorKa,
            netValue: "5000",
            igst: "0",
            cgst: "450",
            sgst: "450",
            cess: "0",
            flag: "N",
          },
        ],
        paysTax95Amendments: [
          {
            etin: GSTINS.ecoOperatorKa,
            originalEtin: GSTINS.ecoOperatorMh,
            originalPeriod: "062025",
            netValue: "100",
            igst: "18",
            cgst: "0",
            sgst: "0",
            flag: "N",
          },
        ],
      },
      ecom: {
        b2b: [
          {
            supplierGstin: GSTINS.recipientKa,
            recipientGstin: GSTINS.recipientMh,
            number: "E/1",
            date: "2026-10-03",
            value: "1180",
            pos: "27",
            supplyType: "INTER",
            invoiceType: "R",
            flag: "N",
            items: [{ rate: "18", taxableValue: "1000", igst: "180", cess: "0" }],
          },
        ],
        urp2c: [
          { pos: "27", supplyType: "INTER", flag: "N", rate: "5", taxableValue: "200", igst: "10" },
        ],
      },
    },
  };
}

function built(): Gstr1Return {
  const g = a2Golden();
  const r = buildGstr1({ gstin: FILER, period: PERIOD, documents: g.documents, ...g.extra });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
function apiJson(r: Gstr1Return): Json {
  const a = toApiSavePayload(r);
  if (!a.ok) throw new Error(JSON.stringify(a.issues));
  return JSON.parse(serializeGstr1(a.value)) as Json;
}
function offJson(r: Gstr1Return): Json {
  const b = toOfflineUploadJson(r);
  if (!b.ok) throw new Error(JSON.stringify(b.issues));
  return JSON.parse(serializeGstr1(b.value)) as Json;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Step 4: (a)'s split advances → S4 flat rows (O10); rows and items sorted. */
function flattenAdvances(j: Json): void {
  for (const prefix of ["at", "txpd", "ata", "txpda"]) {
    const obj = j[prefix] as Json | undefined;
    if (obj === undefined) continue;
    const groups = new Map<
      string,
      { pos: unknown; sply_ty: unknown; omon?: unknown; itms: Map<number, Json> }
    >();
    for (const kind of ["b2b", "b2c"]) {
      for (const r of (obj[`${prefix}_${kind}`] as Json[] | undefined) ?? []) {
        const key = JSON.stringify([r["omon"], r["pos"], r["sply_ty"]]);
        const g: { pos: unknown; sply_ty: unknown; omon?: unknown; itms: Map<number, Json> } =
          groups.get(key) ?? {
            pos: r["pos"],
            sply_ty: r["sply_ty"],
            ...(r["omon"] === undefined ? {} : { omon: r["omon"] }),
            itms: new Map<number, Json>(),
          };
        for (const it of r["itms"] as Json[]) {
          const rt = it["rt"] as number;
          const prev = g.itms.get(rt);
          if (prev === undefined) g.itms.set(rt, { ...it });
          else
            for (const f of ["ad_amt", "iamt", "camt", "samt", "csamt"])
              if (it[f] !== undefined) prev[f] = round2((prev[f] as number) + (it[f] as number));
        }
        groups.set(key, g);
      }
    }
    j[prefix] = [...groups.values()].map((g) => ({ ...g, itms: [...g.itms.values()] }));
  }
}
function sortAdvances(j: Json): void {
  for (const prefix of ["at", "txpd", "ata", "txpda"]) {
    const rows = j[prefix] as Json[] | undefined;
    if (rows === undefined) continue;
    for (const r of rows)
      (r["itms"] as Json[]).sort((x, y) => (x["rt"] as number) - (y["rt"] as number));
    rows.sort((x, y) =>
      JSON.stringify([x["omon"], x["pos"], x["sply_ty"]]).localeCompare(
        JSON.stringify([y["omon"], y["pos"], y["sply_ty"]]),
      ),
    );
  }
}
/** §9 steps 1–3 plus §17.9 steps 4 (advances) and 5 (drop etin). */
function normalise(j: Json, from: "api" | "offline"): Json {
  const out = structuredClone(j);
  delete out["version"];
  delete out["hash"];
  const di = out["doc_issue"] as Json | undefined;
  if (di !== undefined) {
    const l = (from === "api" ? di["doc_det_new"] : di["doc_det"]) as Json[];
    out["doc_issue"] = { doc_det: l.map((e) => ({ ...e, doc_num: String(e["doc_num"]) })) };
  }
  if (from === "api") flattenAdvances(out);
  sortAdvances(out);
  for (const k of ["b2b", "b2cl"])
    for (const g of (out[k] as Json[] | undefined) ?? [])
      for (const v of g["inv"] as Json[]) delete v["etin"];
  return out;
}

describe("Track A2 golden period", () => {
  const r = built();
  const a = apiJson(r);
  const b = offJson(r);

  it("(a) validates against S5; (b) validates against S4", () => {
    expect(validateS5(a) || JSON.stringify(validateS5.errors)).toBe(true);
    expect(validateS4(b) || JSON.stringify(validateS4.errors)).toBe(true);
  });
  it("(a) and (b) differ only by §4.2 / §4.4 / §17.9 (normalisation steps 1–5)", () => {
    expect(normalise(b, "offline")).toEqual(normalise(a, "api"));
  });
  it("(a) key order is S5's; (b) key order is the tool's with the inferred A2 placement (O9)", () => {
    expect(Object.keys(a)).toEqual([
      "gstin",
      "fp",
      "b2b",
      "b2ba",
      "b2cl",
      "b2cla",
      "b2cs",
      "b2csa",
      "cdnr",
      "cdnra",
      "cdnur",
      "cdnura",
      "nil",
      "exp",
      "expa",
      "at",
      "txpd",
      "ata",
      "txpda",
      "ecom",
      "supeco",
      "supecoa",
      "hsn",
      "doc_issue",
    ]);
    expect(Object.keys(b)).toEqual([
      "gstin",
      "fp",
      "version",
      "hash",
      "b2b",
      "b2ba",
      "b2cl",
      "b2cla",
      "b2cs",
      "b2csa",
      "exp",
      "expa",
      "cdnr",
      "cdnra",
      "cdnur",
      "cdnura",
      "nil",
      "at",
      "ata",
      "txpd",
      "txpda",
      "supeco",
      "supecoa",
      "ecom",
      "doc_issue",
      "hsn",
    ]);
  });
  it("round-trips byte-exact through both parsers", () => {
    const ta = toApiSavePayload(r);
    const tb = toOfflineUploadJson(r);
    if (!ta.ok || !tb.ok) throw new Error("render failed");
    const pa = parseApiSavePayloadJson(serializeGstr1(ta.value));
    const pb = parseOfflineUploadJson(serializeGstr1(tb.value));
    expect(pa.success && serializeGstr1(pa.data)).toBe(serializeGstr1(ta.value));
    expect(pb.success && serializeGstr1(pb.data)).toBe(serializeGstr1(tb.value));
  });
  it("HSN and doc_issue are identical with and without the A2 tables (§17.10)", () => {
    const plain = buildGstr1({ gstin: FILER, period: PERIOD, documents: goldenDocs() });
    if (!plain.ok) throw new Error("build failed");
    expect(r.hsn).toEqual(plain.value.hsn);
    expect(r.docIssue).toEqual(plain.value.docIssue);
  });
  for (const [name, json] of [
    ["api-a2.json", a],
    ["offline-a2.json", b],
  ] as const) {
    it(`golden ${name} equals the committed expected JSON`, () => {
      const url = new URL(`./golden/${name}`, import.meta.url);
      const text = JSON.stringify(json, null, 2) + "\n";
      if (process.env["UPDATE_GOLDEN"] === "1") writeFileSync(url, text);
      expect(text).toBe(readFileSync(url, "utf8"));
    });
  }
});

describe("Track A2: the Zod transcriptions and Ajv agree (§17.13)", () => {
  type Case = { name: string; mutate: (j: Json) => void; s5: boolean; s4: boolean };
  const cases: Case[] = [
    { name: "unchanged", mutate: () => undefined, s5: true, s4: true },
    {
      name: "b2ba without oinum",
      mutate: (j) => {
        put(j, ["b2ba", 0, "inv", 0, "oinum"], undefined);
      },
      s5: false,
      s4: false,
    },
    {
      name: "b2cla with an invoice-level pos",
      mutate: (j) => {
        put(j, ["b2cla", 0, "inv", 0, "pos"], "27");
      },
      s5: false,
      s4: false,
    },
    {
      name: "cdnura EXPWP with pos",
      mutate: (j) => {
        put(j, ["cdnura", 0, "typ"], "EXPWP");
      },
      s5: false,
      s4: false,
    },
    {
      name: "nil row missing ngsup_amt",
      mutate: (j) => {
        put(j, ["nil", "inv", 0, "ngsup_amt"], undefined);
      },
      s5: false,
      s4: false,
    },
    {
      name: "ecom.b2b invoice without flag",
      mutate: (j) => {
        put(j, ["ecom", "b2b", 0, "inv", 0, "flag"], undefined);
      },
      s5: false,
      s4: false,
    },
    {
      name: "supeco row without flag",
      mutate: (j) => {
        put(j, ["supeco", "clttx", 0, "flag"], undefined);
      },
      s5: true,
      s4: false,
    },
  ];
  const r = built();
  it.each(cases)("$name", ({ mutate, s5, s4 }) => {
    const a = apiJson(r);
    mutate(a);
    expect(validateS5(a)).toBe(s5);
    expect(parseApiSavePayloadJson(JSON.stringify(a)).success).toBe(s5);
    const b = offJson(r);
    mutate(b);
    expect(validateS4(b)).toBe(s4);
    expect(parseOfflineUploadJson(JSON.stringify(b)).success).toBe(s4);
  });
  it("advances: `at` as an array is invalid in (a); as an object is invalid in (b)", () => {
    const a = apiJson(r);
    const b = offJson(r);
    const aBad = { ...a, at: b["at"] };
    const bBad = { ...b, at: a["at"] };
    expect([validateS5(aBad), parseApiSavePayloadJson(JSON.stringify(aBad)).success]).toEqual([
      false,
      false,
    ]);
    expect([validateS4(bBad), parseOfflineUploadJson(JSON.stringify(bBad)).success]).toEqual([
      false,
      false,
    ]);
  });
  it("txpd with a negative ad_amt: valid S5, invalid S4", () => {
    const a = apiJson(r);
    put(a, ["txpd", "txpd_b2c", 0, "itms", 0, "ad_amt"], -100);
    expect([validateS5(a), parseApiSavePayloadJson(JSON.stringify(a)).success]).toEqual([
      true,
      true,
    ]);
    const b = offJson(r);
    put(b, ["txpd", 0, "itms", 0, "ad_amt"], -100);
    expect([validateS4(b), parseOfflineUploadJson(JSON.stringify(b)).success]).toEqual([
      false,
      false,
    ]);
  });
  it('at_b2b inv_typ "RC": valid S5 (never emitted by us)', () => {
    const a = apiJson(r);
    put(a, ["at", "at_b2b", 0, "inv_typ"], "RC");
    expect([validateS5(a), parseApiSavePayloadJson(JSON.stringify(a)).success]).toEqual([
      true,
      true,
    ]);
  });
  it("an ecom.b2b second item: Ajv checks only the first (tuple form, X9); Zod checks every item", () => {
    const a = apiJson(r);
    const itms = (((a["ecom"] as Json)["b2b"] as Json[])[0]?.["inv"] as Json[])[0]?.[
      "itms"
    ] as Json[];
    itms.push({ num: 1801, itm_det: { rt: 18, txval: -5 } });
    expect(validateS5(a)).toBe(true);
    expect(parseApiSavePayloadJson(JSON.stringify(a)).success).toBe(false);
  });
});
