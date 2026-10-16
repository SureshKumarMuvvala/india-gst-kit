import { describe, expect, it } from "vitest";
import { parseApiSavePayloadJson, parseOfflineUploadJson } from "../src/index.js";
import { FILER, GSTINS, PERIOD, at, put, validateS4, validateS5 } from "./helpers.js";

// Derived at run time from the registered synthetic GSTINs (no extra GSTIN literals):
// a TCS-shaped value (13th... entity letter C at the 14th position) and a value failing every ctin pattern.
const TCS_GSTIN = `${FILER.slice(0, 13)}CY`;
const BAD_CTIN = `${GSTINS.recipientMh.slice(0, 13)}WN`;

type J = Record<string, unknown>;

const det = { txval: 1000, rt: 18, iamt: 180, csamt: 0 };
const item = { num: 1801, itm_det: det };
const apiBase = (): J =>
  structuredClone<J>({
    gstin: FILER,
    fp: PERIOD,
    b2b: [
      {
        ctin: GSTINS.recipientMh,
        inv: [
          {
            inum: "INV/1",
            idt: "05-10-2026",
            val: 1180,
            pos: "27",
            rchrg: "N",
            inv_typ: "R",
            itms: [item],
          },
        ],
      },
    ],
    b2cl: [
      {
        pos: "27",
        inv: [
          {
            inum: "INV/2",
            idt: "05-10-2026",
            val: 150000,
            itms: [{ num: 1, itm_det: { txval: 150000, rt: 0, iamt: 0, csamt: 0 } }],
          },
        ],
      },
    ],
    b2cs: [
      { sply_ty: "INTRA", typ: "OE", pos: "29", rt: 5, txval: 100, camt: 2.5, samt: 2.5, csamt: 0 },
    ],
    cdnr: [
      {
        ctin: GSTINS.recipientMh,
        nt: [
          {
            nt_num: "CN/1",
            nt_dt: "06-10-2026",
            ntty: "C",
            val: 1180,
            pos: "27",
            rchrg: "N",
            inv_typ: "R",
            itms: [item],
          },
        ],
      },
    ],
    cdnur: [
      {
        nt_num: "CN/2",
        nt_dt: "06-10-2026",
        ntty: "C",
        val: 100,
        typ: "B2CL",
        pos: "27",
        itms: [{ num: 1, itm_det: { txval: 100, rt: 0, iamt: 0, csamt: 0 } }],
      },
    ],
    exp: [{ exp_typ: "WPAY", inv: [{ inum: "EXP/1", idt: "07-10-2026", val: 1180, itms: [det] }] }],
    hsn: {
      hsn_b2b: [
        {
          num: 1,
          hsn_sc: "8471",
          uqc: "NOS",
          qty: 1,
          rt: 18,
          txval: 1000,
          iamt: 180,
          camt: 0,
          samt: 0,
          csamt: 0,
        },
      ],
    },
    doc_issue: {
      doc_det_new: [
        {
          doc_num: "1",
          doc_typ: "Invoices for outward supply",
          docs: [{ num: 1, from: "INV/1", to: "INV/2", totnum: 2, cancel: 0, net_issue: 2 }],
        },
      ],
    },
  });

const offBase = (): J => {
  const j = apiBase();
  const out: J = { gstin: j["gstin"], fp: j["fp"], version: "GST3.2.4", hash: "hash" };
  for (const k of ["b2b", "b2cl", "b2cs", "exp", "cdnr", "cdnur"]) out[k] = j[k];
  out["doc_issue"] = {
    doc_det: [
      {
        doc_num: 1,
        doc_typ: "Invoices for outward supply",
        docs: at(j, "doc_issue", "doc_det_new", 0, "docs"),
      },
    ],
  };
  out["hsn"] = j["hsn"];
  return out;
};

interface Case {
  name: string;
  mutate: (j: unknown) => void;
  valid: boolean;
}

const common: Case[] = [
  { name: "baseline", mutate: () => undefined, valid: true },
  {
    name: "unknown top-level key",
    mutate: (j) => {
      put(j, ["extra"], 1);
    },
    valid: false,
  },
  {
    name: "unknown key in an item",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv", 0, "itms", 0, "itm_det", "zzz"], 1);
    },
    valid: false,
  },
  {
    name: "pos 96 in b2cs",
    mutate: (j) => {
      put(j, ["b2cs", 0, "pos"], "96");
    },
    valid: false,
  },
  {
    name: "pos 96 in b2b",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv", 0, "pos"], "96");
    },
    valid: true,
  },
  {
    name: "pos 99 in b2b",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv", 0, "pos"], "99");
    },
    valid: false,
  },
  {
    name: "pos 25 is a valid pattern",
    mutate: (j) => {
      put(j, ["b2cs", 0, "pos"], "25");
    },
    valid: true,
  },
  {
    name: "cdnur EXPWP with pos",
    mutate: (j) => {
      put(j, ["cdnur", 0, "typ"], "EXPWP");
    },
    valid: false,
  },
  {
    name: "cdnur EXPWP without pos",
    mutate: (j) => {
      put(j, ["cdnur", 0, "typ"], "EXPWP");
      put(j, ["cdnur", 0, "pos"], undefined);
    },
    valid: true,
  },
  {
    name: "cdnur B2CL without pos",
    mutate: (j) => {
      put(j, ["cdnur", 0, "pos"], undefined);
    },
    valid: false,
  },
  {
    name: "hsn row with val 5",
    mutate: (j) => {
      put(j, ["hsn", "hsn_b2b", 0, "val"], 5);
    },
    valid: false,
  },
  {
    name: "hsn qty 1.005",
    mutate: (j) => {
      put(j, ["hsn", "hsn_b2b", 0, "qty"], 1.005);
    },
    valid: false,
  },
  {
    name: "hsn qty negative",
    mutate: (j) => {
      put(j, ["hsn", "hsn_b2b", 0, "qty"], -2.5);
    },
    valid: true,
  },
  {
    name: "hsn txval negative",
    mutate: (j) => {
      put(j, ["hsn", "hsn_b2b", 0, "txval"], -10);
    },
    valid: true,
  },
  {
    name: "hsn_sc of 1 digit",
    mutate: (j) => {
      put(j, ["hsn", "hsn_b2b", 0, "hsn_sc"], "8");
    },
    valid: false,
  },
  {
    name: "hsn with neither array",
    mutate: (j) => {
      put(j, ["hsn"], {});
    },
    valid: false,
  },
  {
    name: "hsn_b2c only",
    mutate: (j) => {
      put(j, ["hsn"], { hsn_b2c: at(j, "hsn", "hsn_b2b") });
    },
    valid: true,
  },
  {
    name: "hsn uqc with a digit",
    mutate: (j) => {
      put(j, ["hsn", "hsn_b2b", 0, "uqc"], "N0S");
    },
    valid: false,
  },
  {
    name: "empty inv array",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv"], []);
    },
    valid: false,
  },
  {
    name: "missing rchrg",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv", 0, "rchrg"], undefined);
    },
    valid: false,
  },
  {
    name: "bad date 31-02-2026",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv", 0, "idt"], "31-02-2026");
    },
    valid: false,
  },
  {
    name: "ISO date",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv", 0, "idt"], "2026-10-05");
    },
    valid: false,
  },
  {
    name: "leap day 29-02-2028",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv", 0, "idt"], "29-02-2028");
    },
    valid: true,
  },
  {
    name: "negative val",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv", 0, "val"], -1);
    },
    valid: false,
  },
  {
    name: "val above range",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv", 0, "val"], 10000000000000);
    },
    valid: false,
  },
  {
    name: "item txval above range",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv", 0, "itms", 0, "itm_det", "txval"], 100000000000);
    },
    valid: false,
  },
  {
    name: "rt 1000",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv", 0, "itms", 0, "itm_det", "rt"], 1000);
    },
    valid: false,
  },
  {
    name: "rt 0.255",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv", 0, "itms", 0, "itm_det", "rt"], 0.255);
    },
    valid: false,
  },
  {
    name: "num 0 in b2b",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv", 0, "itms", 0, "num"], 0);
    },
    valid: false,
  },
  {
    name: "num 0 in cdnur",
    mutate: (j) => {
      put(j, ["cdnur", 0, "itms", 0, "num"], 0);
    },
    valid: true,
  },
  {
    name: "inv_typ CBW",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv", 0, "inv_typ"], "CBW");
    },
    valid: true,
  },
  {
    name: "inv_typ X",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv", 0, "inv_typ"], "X");
    },
    valid: false,
  },
  {
    name: "b2cs negative txval",
    mutate: (j) => {
      put(j, ["b2cs", 0, "txval"], -50);
    },
    valid: true,
  },
  {
    name: "cdnr negative txval",
    mutate: (j) => {
      put(j, ["cdnr", 0, "nt", 0, "itms", 0, "itm_det", "txval"], -1);
    },
    valid: false,
  },
  {
    name: "b2cs typ E",
    mutate: (j) => {
      put(j, ["b2cs", 0, "typ"], "E");
    },
    valid: true,
  },
  {
    name: "b2cs sply_ty X",
    mutate: (j) => {
      put(j, ["b2cs", 0, "sply_ty"], "X");
    },
    valid: false,
  },
  {
    name: "exp item with num",
    mutate: (j) => {
      put(j, ["exp", 0, "inv", 0, "itms", 0, "num"], 1);
    },
    valid: false,
  },
  {
    name: "exp_typ WOPAY",
    mutate: (j) => {
      put(j, ["exp", 0, "exp_typ"], "WOPAY");
    },
    valid: true,
  },
  {
    name: "string where a number belongs",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv", 0, "val"], "1180.00");
    },
    valid: false,
  },
  {
    name: "number where a string belongs",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv", 0, "pos"], 27);
    },
    valid: false,
  },
  {
    name: "ctin that fails every pattern",
    mutate: (j) => {
      put(j, ["b2b", 0, "ctin"], BAD_CTIN);
    },
    valid: false,
  },
  {
    name: "inum with a bad character",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv", 0, "inum"], "A B");
    },
    valid: false,
  },
  {
    name: "inum of 17 characters",
    mutate: (j) => {
      put(j, ["b2b", 0, "inv", 0, "inum"], "A".repeat(17));
    },
    valid: false,
  },
  {
    name: "fp 132025",
    mutate: (j) => {
      put(j, ["fp"], "132025");
    },
    valid: false,
  },
  {
    name: "filer GSTIN of the wrong length",
    mutate: (j) => {
      put(j, ["gstin"], "29AAAAA0000A1Z");
    },
    valid: false,
  },
];

describe("ApiSavePayloadSchema and S5 agree", () => {
  const cases: Case[] = [
    ...common,
    {
      name: "doc_issue cancel above range",
      mutate: (j) => {
        put(j, ["doc_issue", "doc_det_new", 0, "docs", 0, "cancel"], 10000000000);
      },
      valid: false,
    },
    {
      name: "doc_issue docs missing net_issue",
      mutate: (j) => {
        put(j, ["doc_issue", "doc_det_new", 0, "docs", 0, "net_issue"], undefined);
      },
      valid: false,
    },
    {
      name: "doc_num 1 as an integer",
      mutate: (j) => {
        put(j, ["doc_issue", "doc_det_new", 0, "doc_num"], 1);
      },
      valid: false,
    },
    {
      name: 'doc_num "1A"',
      mutate: (j) => {
        put(j, ["doc_issue", "doc_det_new", 0, "doc_num"], "1A");
      },
      valid: true,
    },
    {
      name: 'doc_num "13"',
      mutate: (j) => {
        put(j, ["doc_issue", "doc_det_new", 0, "doc_num"], "13");
      },
      valid: false,
    },
    {
      name: "doc_det instead of doc_det_new",
      mutate: (j) => {
        put(j, ["doc_issue"], { doc_det: at(j, "doc_issue", "doc_det_new") });
      },
      valid: false,
    },
    {
      name: "etin in b2b",
      mutate: (j) => {
        put(j, ["b2b", 0, "inv", 0, "etin"], TCS_GSTIN);
      },
      valid: false,
    },
    {
      name: "ntty R",
      mutate: (j) => {
        put(j, ["cdnr", 0, "nt", 0, "ntty"], "R");
      },
      valid: true,
    },
    {
      name: "version and hash",
      mutate: (j) => {
        put(j, ["version"], "v");
        put(j, ["hash"], "h");
      },
      valid: true,
    },
    {
      name: "no sections",
      mutate: (j) => {
        for (const k of ["b2b", "b2cl", "b2cs", "cdnr", "cdnur", "exp", "hsn", "doc_issue"])
          put(j, [k], undefined);
      },
      valid: true,
    },
  ];
  it.each(cases)("$name", ({ mutate, valid }) => {
    const j = apiBase();
    mutate(j);
    expect(validateS5(j)).toBe(valid);
    const parsed = parseApiSavePayloadJson(JSON.stringify(j));
    expect(parsed.success).toBe(valid);
  });
});

describe("OfflineUploadJsonSchema and S4 agree", () => {
  const cases: Case[] = [
    ...common,
    {
      name: "doc_issue cancel above range",
      mutate: (j) => {
        put(j, ["doc_issue", "doc_det", 0, "docs", 0, "cancel"], 10000000000);
      },
      valid: false,
    },
    {
      name: "doc_issue docs missing net_issue",
      mutate: (j) => {
        put(j, ["doc_issue", "doc_det", 0, "docs", 0, "net_issue"], undefined);
      },
      valid: false,
    },
    {
      name: 'doc_num "1" as a string',
      mutate: (j) => {
        put(j, ["doc_issue", "doc_det", 0, "doc_num"], "1");
      },
      valid: false,
    },
    {
      name: "doc_num 13",
      mutate: (j) => {
        put(j, ["doc_issue", "doc_det", 0, "doc_num"], 13);
      },
      valid: false,
    },
    {
      name: "doc_num 12",
      mutate: (j) => {
        put(j, ["doc_issue", "doc_det", 0, "doc_num"], 12);
      },
      valid: true,
    },
    {
      name: "doc_num 0",
      mutate: (j) => {
        put(j, ["doc_issue", "doc_det", 0, "doc_num"], 0);
      },
      valid: false,
    },
    {
      name: "doc_det_new",
      mutate: (j) => {
        put(j, ["doc_issue"], { doc_det_new: at(j, "doc_issue", "doc_det") });
      },
      valid: false,
    },
    {
      name: "etin with a TCS-pattern GSTIN (b2b)",
      mutate: (j) => {
        put(j, ["b2b", 0, "inv", 0, "etin"], TCS_GSTIN);
      },
      valid: true,
    },
    {
      name: "etin with a TCS-pattern GSTIN (b2cl, b2cs, cdnr)",
      mutate: (j) => {
        put(j, ["b2cl", 0, "inv", 0, "etin"], TCS_GSTIN);
        put(j, ["b2cs", 0, "etin"], TCS_GSTIN);
        put(j, ["cdnr", 0, "nt", 0, "etin"], TCS_GSTIN);
      },
      valid: true,
    },
    {
      name: "an empty etin",
      mutate: (j) => {
        put(j, ["b2b", 0, "inv", 0, "etin"], "");
      },
      valid: true,
    },
    {
      name: "etin that is not a TCS GSTIN",
      mutate: (j) => {
        put(j, ["b2b", 0, "inv", 0, "etin"], FILER);
      },
      valid: false,
    },
    {
      name: "diff_percent",
      mutate: (j) => {
        put(j, ["b2b", 0, "inv", 0, "diff_percent"], 0.65);
      },
      valid: false,
    },
    {
      name: "ntty R",
      mutate: (j) => {
        put(j, ["cdnr", 0, "nt", 0, "ntty"], "R");
      },
      valid: false,
    },
    {
      name: "ntty D",
      mutate: (j) => {
        put(j, ["cdnr", 0, "nt", 0, "ntty"], "D");
      },
      valid: true,
    },
    {
      name: "sez_auth",
      mutate: (j) => {
        put(j, ["b2b", 0, "inv", 0, "sez_auth"], "SEZAO");
      },
      valid: false,
    },
    {
      name: "no sections",
      mutate: (j) => {
        for (const k of ["b2b", "b2cl", "b2cs", "cdnr", "cdnur", "exp", "hsn", "doc_issue"])
          put(j, [k], undefined);
      },
      valid: true,
    },
  ];
  it.each(cases)("$name", ({ mutate, valid }) => {
    const j = offBase();
    mutate(j);
    expect(validateS4(j)).toBe(valid);
    const parsed = parseOfflineUploadJson(JSON.stringify(j));
    expect(parsed.success).toBe(valid);
  });
});
