import { D, fmt2 } from "./decimal.js";
import { NIL_ORDER } from "./tables.js";
import type {
  AdvanceAmendment,
  AdvanceItem,
  AdvanceRow,
  EcomItem,
  Gstr1Return,
  Heads,
  Item,
} from "./return-schema.js";
import { issue, type Gstr1Issue } from "./types.js";

// Pure mapping of the Track A2 sections (spec §17.3–§17.9) to the wire. Shared by both outputs, except advances,
// which S5 splits by party and S4 keeps flat (O10), and the e-commerce operator GSTIN, written to (b) only (O8).

type Obj = Record<string, unknown>;

const wireDate = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const yn = (b: boolean) => (b ? "Y" : "N");
const itemNum = (rate: string) => new D(rate).mul(100).plus(1).toNumber();
const opt = (k: string, v: string | undefined): Obj => (v === undefined ? {} : { [k]: v });

const det = (it: Item): Obj => ({
  txval: it.taxableValue,
  rt: it.rate,
  ...opt("iamt", it.igst),
  ...opt("camt", it.cgst),
  ...opt("samt", it.sgst),
  csamt: it.cess,
});
const igstDet = (it: Item): Obj => ({
  txval: it.taxableValue,
  rt: it.rate,
  iamt: it.igst ?? "0.00",
  csamt: it.cess,
});
const items = (list: readonly Item[]) =>
  list.map((it) => ({ num: itemNum(it.rate), itm_det: det(it) }));
const igstItems = (list: readonly Item[]) =>
  list.map((it) => ({ num: itemNum(it.rate), itm_det: igstDet(it) }));
const heads = (h: Heads): Obj => ({
  txval: h.taxableValue,
  ...opt("iamt", h.igst),
  ...opt("camt", h.cgst),
  ...opt("samt", h.sgst),
  csamt: h.cess,
});
const ecomHeads = (it: EcomItem): Obj => ({
  txval: it.taxableValue,
  ...opt("iamt", it.igst),
  ...opt("camt", it.cgst),
  ...opt("samt", it.sgst),
  ...opt("csamt", it.cess),
});

/** S5 `nil` codes ↔ FORM GSTR-1 8A–8D, matched by name (D-A5). */
const NIL_CODE: Record<(typeof NIL_ORDER)[number], string> = {
  INTER_REGISTERED: "INTRB2B",
  INTRA_REGISTERED: "INTRAB2B",
  INTER_UNREGISTERED: "INTRB2C",
  INTRA_UNREGISTERED: "INTRAB2C",
};

/** `b2ba`, `b2cla`, `b2csa`, `cdnra`, `cdnura`, `nil`, `expa`, `ecom`, `ecoma`, `supeco`, `supecoa` — same in both outputs. */
export function mapA2Sections(ret: Gstr1Return): Obj {
  const out: Obj = {};
  const b2ba = ret.b2ba ?? [];
  if (b2ba.length > 0) {
    out["b2ba"] = b2ba.map((g) => ({
      ctin: g.ctin,
      inv: g.invoices.map((v) => ({
        inum: v.number,
        idt: wireDate(v.date),
        oinum: v.original.number,
        oidt: wireDate(v.original.date),
        val: v.value,
        pos: v.pos,
        rchrg: yn(v.reverseCharge),
        inv_typ: v.invoiceType,
        itms: items(v.items),
      })),
    }));
  }
  const b2cla = ret.b2cla ?? [];
  if (b2cla.length > 0) {
    out["b2cla"] = b2cla.map((g) => ({
      pos: g.pos,
      inv: g.invoices.map((v) => ({
        inum: v.number,
        idt: wireDate(v.date),
        oinum: v.original.number,
        oidt: wireDate(v.original.date),
        val: v.value,
        itms: igstItems(v.items),
      })),
    }));
  }
  const b2csa = ret.b2csa ?? [];
  if (b2csa.length > 0) {
    const groups = new Map<string, Obj & { itms: Obj[] }>();
    for (const r of b2csa) {
      const key = `${r.originalPeriod}|${r.pos}|${r.supplyType}`;
      let g = groups.get(key);
      if (g === undefined) {
        g = { typ: "OE", sply_ty: r.supplyType, pos: r.pos, omon: r.originalPeriod, itms: [] };
        groups.set(key, g);
      }
      g.itms.push({ rt: r.rate, ...heads(r.revised) });
    }
    out["b2csa"] = [...groups.values()];
  }
  const cdnra = ret.cdnra ?? [];
  if (cdnra.length > 0) {
    out["cdnra"] = cdnra.map((g) => ({
      ctin: g.ctin,
      nt: g.notes.map((n) => ({
        nt_num: n.number,
        nt_dt: wireDate(n.date),
        ont_num: n.original.number,
        ont_dt: wireDate(n.original.date),
        ntty: n.noteType,
        val: n.value,
        pos: n.pos,
        rchrg: yn(n.reverseCharge),
        inv_typ: n.invoiceType,
        itms: items(n.items),
      })),
    }));
  }
  const cdnura = ret.cdnura ?? [];
  if (cdnura.length > 0) {
    out["cdnura"] = cdnura.map((n) => ({
      nt_num: n.number,
      nt_dt: wireDate(n.date),
      ont_num: n.original.number,
      ont_dt: wireDate(n.original.date),
      ntty: n.noteType,
      val: n.value,
      typ: n.type,
      ...opt("pos", n.pos),
      itms: igstItems(n.items),
    }));
  }
  const nil = ret.nil ?? [];
  if (nil.length > 0) {
    out["nil"] = {
      inv: nil.map((r) => ({
        sply_ty: NIL_CODE[r.supply],
        nil_amt: r.nilRated,
        expt_amt: r.exempted,
        ngsup_amt: r.nonGst,
      })),
    };
  }
  const expa = ret.expa ?? [];
  if (expa.length > 0) {
    out["expa"] = expa.map((g) => ({
      exp_typ: g.exportType,
      inv: g.invoices.map((v) => ({
        inum: v.number,
        idt: wireDate(v.date),
        val: v.value,
        oinum: v.original.number,
        oidt: wireDate(v.original.date),
        itms: v.items.map((it) => ({
          txval: it.taxableValue,
          rt: it.rate,
          iamt: it.igst,
          csamt: it.cess,
        })),
      })),
    }));
  }
  Object.assign(out, mapEcom(ret), mapSupeco(ret));
  return out;
}

function mapEcom(ret: Gstr1Return): Obj {
  const e = ret.ecom;
  if (e === undefined) return {};
  type Doc = (typeof e.urp2b)[number];
  const inv = (d: Doc, amend?: { originalNumber: string; originalDate: string }): Obj => ({
    inum: d.number,
    idt: wireDate(d.date),
    ...(amend === undefined
      ? {}
      : { oinum: amend.originalNumber, oidt: wireDate(amend.originalDate) }),
    val: d.value,
    pos: d.pos,
    sply_ty: d.supplyType,
    inv_typ: d.invoiceType,
    flag: d.flag,
    itms: d.items.map((it) => ({
      num: itemNum(it.rate),
      itm_det: { rt: it.rate, ...ecomHeads(it) },
    })),
  });
  /** Invoices grouped by (supplier, recipient), in order of first appearance. */
  const byParties = <T extends Doc & { supplierGstin?: string }>(
    list: readonly T[],
    toInv: (d: T) => Obj,
  ) => {
    const m = new Map<string, Obj & { inv: Obj[] }>();
    for (const d of list) {
      const key = `${d.supplierGstin ?? ""}|${d.recipientGstin}`;
      let g = m.get(key);
      if (g === undefined) {
        g = {
          ...(d.supplierGstin === undefined ? {} : { stin: d.supplierGstin }),
          rtin: d.recipientGstin,
          inv: [],
        };
        m.set(key, g);
      }
      g.inv.push(toInv(d));
    }
    return [...m.values()];
  };
  const out: Obj = {};
  const ecom: Obj = {};
  if (e.b2b.length > 0) ecom["b2b"] = byParties(e.b2b, (d) => inv(d));
  if (e.urp2b.length > 0) ecom["urp2b"] = byParties(e.urp2b, (d) => inv(d));
  if (e.b2c.length > 0) {
    ecom["b2c"] = e.b2c.map((r) => ({
      stin: r.supplierGstin,
      pos: r.pos,
      sply_ty: r.supplyType,
      flag: r.flag,
      rt: r.rate,
      ...ecomHeads(r),
    }));
  }
  if (e.urp2c.length > 0) {
    ecom["urp2c"] = e.urp2c.map((r) => ({
      pos: r.pos,
      sply_ty: r.supplyType,
      flag: r.flag,
      rt: r.rate,
      ...ecomHeads(r),
    }));
  }
  if (Object.keys(ecom).length > 0) out["ecom"] = ecom;
  const ecoma: Obj = {};
  if (e.b2ba.length > 0) ecoma["b2ba"] = byParties(e.b2ba, (d) => inv(d, d));
  if (e.urp2ba.length > 0) ecoma["urp2ba"] = byParties(e.urp2ba, (d) => inv(d, d));
  if (e.b2ca.length > 0) {
    const byPos = new Map<string, Obj[]>();
    for (const r of e.b2ca) {
      const l = byPos.get(r.pos) ?? [];
      l.push({
        stin: r.supplierGstin,
        ostin: r.originalSupplierGstin,
        omon: r.originalPeriod,
        sply_ty: r.supplyType,
        flag: r.flag,
        itms: r.items.map((it) => ({ rt: it.rate, ...ecomHeads(it) })),
      });
      byPos.set(r.pos, l);
    }
    ecoma["b2ca"] = [...byPos].map(([pos, posItms]) => ({ pos, posItms }));
  }
  if (e.urp2ca.length > 0) {
    ecoma["urp2ca"] = e.urp2ca.map((r) => ({
      pos: r.pos,
      omon: r.originalPeriod,
      sply_ty: r.supplyType,
      flag: r.flag,
      itms: r.items.map((it) => ({ rt: it.rate, ...ecomHeads(it) })),
    }));
  }
  if (Object.keys(ecoma).length > 0) out["ecoma"] = ecoma;
  return out;
}

function mapSupeco(ret: Gstr1Return): Obj {
  const s = ret.supeco;
  if (s === undefined) return {};
  type Row = (typeof s.collectsTcs)[number];
  const row = (r: Row): Obj => ({
    etin: r.etin,
    suppval: r.netValue,
    igst: r.igst,
    cgst: r.cgst,
    sgst: r.sgst,
    ...opt("cess", r.cess),
    ...opt("flag", r.flag),
  });
  const out: Obj = {};
  const supeco: Obj = {};
  if (s.collectsTcs.length > 0) supeco["clttx"] = s.collectsTcs.map(row);
  if (s.paysTax95.length > 0) supeco["paytx"] = s.paysTax95.map(row);
  if (Object.keys(supeco).length > 0) out["supeco"] = supeco;
  const supecoa: Obj = {};
  const arow = (r: (typeof s.collectsTcsAmendments)[number]): Obj => ({
    oetin: r.originalEtin,
    omon: r.originalPeriod,
    ...row(r),
  });
  if (s.collectsTcsAmendments.length > 0) supecoa["clttxa"] = s.collectsTcsAmendments.map(arow);
  if (s.paysTax95Amendments.length > 0) supecoa["paytxa"] = s.paysTax95Amendments.map(arow);
  if (Object.keys(supecoa).length > 0) out["supecoa"] = supecoa;
  return out;
}

/** Table 14 rows without `flag` cannot be written in S4 (O13). */
export function supecoOfflineIssues(ret: Gstr1Return): Gstr1Issue[] {
  const s = ret.supeco;
  if (s === undefined) return [];
  const out: Gstr1Issue[] = [];
  for (const k of [
    "collectsTcs",
    "paysTax95",
    "collectsTcsAmendments",
    "paysTax95Amendments",
  ] as const) {
    s[k].forEach((r, i) => {
      if (r.flag === undefined) {
        out.push(
          issue("NOT_IN_OFFLINE_SHAPE", "a Table 14 row needs a flag in the offline (v4.1) shape", {
            path: ["supeco", k, i, "flag"],
          }),
        );
      }
    });
  }
  return out;
}

// ---------------------------------------------------------------- advances

const advItm = (it: AdvanceItem): Obj => ({
  ad_amt: it.amount,
  ...opt("iamt", it.igst),
  ...opt("camt", it.cgst),
  ...opt("samt", it.sgst),
  csamt: it.cess,
  rt: it.rate,
});

const ADV_NAMES = [
  ["received", "at"],
  ["adjusted", "txpd"],
  ["receivedAmendments", "ata"],
  ["adjustedAmendments", "txpda"],
] as const;

/** S5: `at` / `txpd` / `ata` / `txpda` objects with `<prefix>_b2b` / `_b2c` / `_exp` arrays. */
export function mapAdvancesApi(ret: Gstr1Return): Obj {
  const a = ret.advances;
  if (a === undefined) return {};
  const out: Obj = {};
  const rowObj = (r: AdvanceRow, m: AdvanceAmendment | undefined): [string, Obj] => {
    const p = r.party;
    const o = m?.original;
    switch (p.kind) {
      case "B2B":
        return [
          "b2b",
          {
            rtin: p.recipientGstin,
            pos: p.pos,
            sply_ty: r.supplyType,
            inv_typ: p.invoiceType,
            rchrg: yn(p.reverseCharge),
            ...(m !== undefined && o?.kind === "B2B"
              ? {
                  omon: m.originalPeriod,
                  opos: o.pos,
                  oinv_typ: o.invoiceType,
                  ortin: o.recipientGstin,
                  orchrg: yn(o.reverseCharge),
                }
              : {}),
            itms: r.items.map(advItm),
          },
        ];
      case "B2C":
        return [
          "b2c",
          {
            pos: p.pos,
            sply_ty: r.supplyType,
            ...(m !== undefined && o?.kind === "B2C"
              ? { omon: m.originalPeriod, opos: o.pos }
              : {}),
            itms: r.items.map(advItm),
          },
        ];
      case "EXPORT":
        return [
          "exp",
          {
            exp_typ: p.exportType,
            sply_ty: r.supplyType,
            ...(m !== undefined && o?.kind === "EXPORT"
              ? { omon: m.originalPeriod, oexp_typ: o.exportType }
              : {}),
            itms: r.items.map(advItm),
          },
        ];
    }
  };
  for (const [key, prefix] of ADV_NAMES) {
    const parts: Record<string, Obj[]> = {};
    const add = (r: AdvanceRow, m?: AdvanceAmendment) => {
      const [kind, obj] = rowObj(r, m);
      (parts[kind] ??= []).push(obj);
    };
    if (key === "received" || key === "adjusted") for (const r of a[key]) add(r);
    else for (const m of a[key]) add(m.row, m);
    const obj: Obj = {};
    for (const kind of ["b2b", "b2c", "exp"]) {
      const l = parts[kind];
      if (l !== undefined && l.length > 0) obj[`${prefix}_${kind}`] = l;
    }
    if (Object.keys(obj).length > 0) out[prefix] = obj;
  }
  return out;
}

/** S4 / tool: flat rows per (pos, sply_ty[, omon]); B2B and B2C rows merged, items summed per rate (O10, O11). */
export function mapAdvancesOffline(ret: Gstr1Return): { value: Obj; issues: Gstr1Issue[] } {
  const a = ret.advances;
  if (a === undefined) return { value: {}, issues: [] };
  const issues: Gstr1Issue[] = [];
  const out: Obj = {};
  const no = (path: (string | number)[], why: string) =>
    issues.push(
      issue("NOT_IN_OFFLINE_SHAPE", `not expressible in the offline (v4.1) shape: ${why}`, {
        path,
      }),
    );
  for (const [key, prefix] of ADV_NAMES) {
    const amend = key === "receivedAmendments" || key === "adjustedAmendments";
    const nonNegative = key === "adjusted" || key === "adjustedAmendments";
    const rows: { row: AdvanceRow; omon?: string; opos?: string }[] =
      key === "received" || key === "adjusted"
        ? a[key].map((row) => ({ row }))
        : a[key].map((m) => ({
            row: m.row,
            omon: m.originalPeriod,
            ...(m.original.kind === "EXPORT" ? {} : { opos: m.original.pos }),
          }));
    const groups = new Map<
      string,
      { pos: string; sply_ty: string; omon?: string; items: Map<string, AdvanceItem> }
    >();
    rows.forEach((x, i) => {
      const path = ["advances", key, i];
      const p = x.row.party;
      if (p.kind === "EXPORT") {
        no(path, "an export advance has no place of supply in v4.1");
        return;
      }
      if (p.pos === "96") {
        no(path, "place of supply 96 is not a v4.1 advance place of supply");
        return;
      }
      if (amend && x.opos !== p.pos) {
        no(path, "v4.1 has one place of supply per amended advance (the original's)");
        return;
      }
      if (
        nonNegative &&
        x.row.items.some((it) =>
          [it.amount, it.igst, it.cgst, it.sgst, it.cess].some(
            (v) => v !== undefined && new D(v).isNeg() && !new D(v).isZero(),
          ),
        )
      ) {
        no(path, "v4.1 adjusted-advance amounts cannot be negative");
        return;
      }
      const k = `${x.omon ?? ""}|${p.pos}|${x.row.supplyType}`;
      let g = groups.get(k);
      if (g === undefined) {
        g = {
          pos: p.pos,
          sply_ty: x.row.supplyType,
          ...(x.omon === undefined ? {} : { omon: x.omon }),
          items: new Map(),
        };
        groups.set(k, g);
      }
      for (const it of x.row.items) {
        const prev = g.items.get(it.rate);
        if (prev === undefined) {
          g.items.set(it.rate, { ...it });
          continue;
        }
        const add = (u: string | undefined, v: string | undefined) =>
          u === undefined || v === undefined ? (u ?? v) : fmt2(new D(u).plus(v));
        g.items.set(it.rate, {
          rate: it.rate,
          amount: add(prev.amount, it.amount) ?? "0.00",
          ...opt("igst", add(prev.igst, it.igst)),
          ...opt("cgst", add(prev.cgst, it.cgst)),
          ...opt("sgst", add(prev.sgst, it.sgst)),
          cess: add(prev.cess, it.cess) ?? "0.00",
        });
      }
    });
    if (groups.size > 0) {
      out[prefix] = [...groups.values()].map((g) => ({
        pos: g.pos,
        sply_ty: g.sply_ty,
        ...(g.omon === undefined ? {} : { omon: g.omon }),
        itms: [...g.items.values()].map(advItm),
      }));
    }
  }
  return { value: out, issues };
}
