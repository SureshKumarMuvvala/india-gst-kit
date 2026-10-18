import { D } from "./decimal.js";
import { DOC_ISSUE_TYPES } from "./doc-issue.js";
import type { Gstr1Return, Item } from "./return-schema.js";

// Pure mapping from the internal Gstr1Return to the wire shapes. Shared by both outputs: they differ only in the
// doc_issue container and the header (api-payload.ts, offline-upload.ts). Objects are built in wire key order;
// absent optional keys are omitted, never null.

type Obj = Record<string, unknown>;

const wireDate = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const yn = (b: boolean) => (b ? "Y" : "N");
/** `num = rt × 100 + 1` (T §3 b2b): 18 → 1801, 0.25 → 26, 0 → 1. */
const itemNum = (rate: string) => new D(rate).mul(100).plus(1).toNumber();

const det = (it: Item): Obj => ({
  txval: it.taxableValue,
  rt: it.rate,
  ...(it.igst === undefined ? {} : { iamt: it.igst }),
  ...(it.cgst === undefined ? {} : { camt: it.cgst }),
  ...(it.sgst === undefined ? {} : { samt: it.sgst }),
  csamt: it.cess,
});
const items = (list: readonly Item[]) =>
  list.map((it) => ({ num: itemNum(it.rate), itm_det: det(it) }));
const igstDet = (it: Item): Obj => ({
  txval: it.taxableValue,
  rt: it.rate,
  iamt: it.igst ?? "0.00",
  csamt: it.cess,
});

/** `withEtin`: output (b) writes the e-commerce operator GSTIN of marked invoices (spec §17.7, O8). */
export function mapSections(ret: Gstr1Return, withEtin = false): Obj {
  const etin = (v: { etin?: string | undefined }): Obj =>
    withEtin && v.etin !== undefined ? { etin: v.etin } : {};
  const out: Obj = {};
  if (ret.b2b.length > 0) {
    out["b2b"] = ret.b2b.map((g) => ({
      ctin: g.ctin,
      inv: g.invoices.map((v) => ({
        inum: v.number,
        idt: wireDate(v.date),
        val: v.value,
        pos: v.pos,
        rchrg: yn(v.reverseCharge),
        inv_typ: v.invoiceType,
        ...etin(v),
        itms: items(v.items),
      })),
    }));
  }
  if (ret.b2cl.length > 0) {
    out["b2cl"] = ret.b2cl.map((g) => ({
      pos: g.pos,
      inv: g.invoices.map((v) => ({
        inum: v.number,
        idt: wireDate(v.date),
        val: v.value,
        ...etin(v),
        itms: v.items.map((it) => ({ num: itemNum(it.rate), itm_det: igstDet(it) })),
      })),
    }));
  }
  if (ret.b2cs.length > 0) {
    out["b2cs"] = ret.b2cs.map((r) => ({
      sply_ty: r.supplyType,
      typ: "OE",
      pos: r.pos,
      rt: r.rate,
      txval: r.taxableValue,
      ...(r.igst === undefined ? {} : { iamt: r.igst }),
      ...(r.cgst === undefined ? {} : { camt: r.cgst }),
      ...(r.sgst === undefined ? {} : { samt: r.sgst }),
      csamt: r.cess,
    }));
  }
  if (ret.cdnr.length > 0) {
    out["cdnr"] = ret.cdnr.map((g) => ({
      ctin: g.ctin,
      nt: g.notes.map((n) => ({
        nt_num: n.number,
        nt_dt: wireDate(n.date),
        ntty: n.noteType,
        val: n.value,
        pos: n.pos,
        rchrg: yn(n.reverseCharge),
        inv_typ: n.invoiceType,
        itms: items(n.items),
      })),
    }));
  }
  if (ret.cdnur.length > 0) {
    out["cdnur"] = ret.cdnur.map((n) => ({
      nt_num: n.number,
      nt_dt: wireDate(n.date),
      ntty: n.noteType,
      val: n.value,
      typ: n.type,
      ...(n.pos === undefined ? {} : { pos: n.pos }),
      itms: n.items.map((it) => ({ num: itemNum(it.rate), itm_det: igstDet(it) })),
    }));
  }
  if (ret.exp.length > 0) {
    out["exp"] = ret.exp.map((g) => ({
      exp_typ: g.exportType,
      inv: g.invoices.map((v) => ({
        inum: v.number,
        idt: wireDate(v.date),
        val: v.value,
        itms: v.items.map((it) => ({
          txval: it.taxableValue,
          rt: it.rate,
          iamt: it.igst,
          csamt: it.cess,
        })),
      })),
    }));
  }
  const hsnRows = (rows: Gstr1Return["hsn"]["b2b"]) =>
    rows.map((r, i) => {
      const q = new D(r.quantity);
      return {
        num: i + 1,
        hsn_sc: r.code,
        uqc: r.uqc,
        qty: q.decimalPlaces() <= 2 ? q.toFixed(2) : q.toFixed(),
        rt: r.rate,
        txval: r.taxableValue,
        iamt: r.igst,
        camt: r.cgst,
        samt: r.sgst,
        csamt: r.cess,
      };
    });
  if (ret.hsn.b2b.length > 0 || ret.hsn.b2c.length > 0) {
    out["hsn"] = {
      ...(ret.hsn.b2b.length > 0 ? { hsn_b2b: hsnRows(ret.hsn.b2b) } : {}),
      ...(ret.hsn.b2c.length > 0 ? { hsn_b2c: hsnRows(ret.hsn.b2c) } : {}),
    };
  }
  return out;
}

/** doc_issue entries; `docNum` renders the code as a string (S5) or an integer (S4 / the tool). */
export function mapDocIssue(ret: Gstr1Return, docNum: (code: number) => string | number): Obj[] {
  return ret.docIssue.map((e) => ({
    doc_num: docNum(DOC_ISSUE_TYPES[e.type].code),
    doc_typ: DOC_ISSUE_TYPES[e.type].name,
    docs: e.series.map((s) => ({
      num: s.num,
      from: s.from,
      to: s.to,
      totnum: s.total,
      cancel: s.cancelled,
      net_issue: s.netIssued,
    })),
  }));
}
