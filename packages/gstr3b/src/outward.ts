// Source: mapping G — FORM GSTR-1 (sources/gstr1/form-gstr1-excerpt-18052021.txt; Tables 4A, 4B, 5A, 6A–6C, 7A(1),
//         7B(1), 9B and Instructions 5, 7, 12, 13); mapping M — AC key names (src/ac-map.ts); credit-note sign —
//         FORM GSTR-3B Instruction 1 (sources/gstr3b/form-gstr3b-excerpt-18052021.txt). Spec §4, D-H6.
//         Track A2 (spec §22): G11 Table 8 → 3.1c/3.1e; G12/G13 9A/9C and G14 Table 10 as revised − original
//         (FORM GSTR-3B Instruction 3, D-A12); G15 advances only with `confirmAdvanceMapping` (D-A14). Tables 4C/5B
//         were omitted by Notification 26/2022-CT, so e-commerce-marked invoices stay in 4A/5A (gstr1 spec §17.21).
// Retrieved: 2026-10-18
// Status: UNVERIFIED — needs CA
import { z } from "zod";
import {
  Gstr1ReturnSchema,
  type AmendmentOriginal,
  type Gstr1Return,
  type Heads,
  type Item,
} from "@india-gst-kit/gstr1";
import { D, type Dec } from "./decimal.js";
import { AC_ADVANCE_MAP, AC_NOT_COVERED } from "./ac-map.js";
import { TrailEntrySchema, type AmountKey, type TrailEntry } from "./return-schema.js";
import { Gstr3bIssueSchema, issue, type BoxId, type Gstr3bIssue } from "./types.js";

export const RecipientTypeSchema = z.enum(["COMPOSITION", "UIN_HOLDER"]);
export type RecipientType = z.infer<typeof RecipientTypeSchema>;

export const OutwardDerivationSchema = z.strictObject({
  gstin: z.string(),
  period: z.string(),
  entries: z.array(TrailEntrySchema),
  unmapped: z.array(
    z.strictObject({
      section: z.string(),
      number: z.string().optional(),
      issue: Gstr3bIssueSchema,
    }),
  ),
  notCovered: z.array(z.string()),
  recipientTypes: z.record(z.string(), RecipientTypeSchema),
});
export type OutwardDerivation = z.infer<typeof OutwardDerivationSchema>;

export type OutwardResult =
  { ok: true; value: OutwardDerivation } | { ok: false; issues: Gstr3bIssue[] };

type Acc = {
  box: BoxId;
  pos: string | undefined;
  ref: string;
  amounts: Map<AmountKey, Dec>;
  docs: { section: string; number: string }[];
};

const BOX_ORDER: readonly BoxId[] = [
  "3.1a",
  "3.1b",
  "3.1c",
  "3.1e",
  "3.2unreg",
  "3.2comp",
  "3.2uin",
];
const TABLE_ORDER = [
  "tbl4a",
  "tbl4b",
  "tbl5a",
  "tbl6a",
  "tbl6b",
  "tbl6c",
  "tbl7a_1",
  "tbl7b_1",
  "tbl8",
  "tbl9a",
  "tbl9b",
  "tbl9c",
  "tbl10a",
  "tbl10b",
  "tbl11a_1_2_4",
  "tbl11a_3",
  "tbl11a_4_5",
  "tbl11a_1_5",
  "tbl11b_1_2_4",
  "tbl11b_3",
  "tbl11b_4_5",
  "tbl11b_1_5",
];

const isPos = (v: string | undefined) => v !== undefined && !new D(v).isZero();
const amt = (v: string | undefined) => new D(v ?? "0");

/**
 * Derives the parts of 3.1 (a), 3.1 (b) and 3.2 that AC attributes to GSTR-1 tables the `gstr1` package builds
 * (spec §4). Never throws on data problems; unmappable data is listed in `unmapped`.
 */
export function outwardFromGstr1(
  gstr1: Gstr1Return,
  ctx: {
    recipientTypes?: Readonly<Record<string, RecipientType>>;
    /** Map GSTR-1 Table 11 advances into 3.1 / 3.2 (G15, spec §22.2, D-A14); default false. */
    confirmAdvanceMapping?: boolean;
  } = {},
): OutwardResult {
  const parsed = Gstr1ReturnSchema.safeParse(gstr1);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) =>
        issue("GSTR1_INVALID", `gstr1 return: ${i.message}`, {
          path: i.path.map((p) => (typeof p === "number" ? p : String(p))),
        }),
      ),
    };
  }
  const g = parsed.data;
  const types = ctx.recipientTypes ?? {};
  const acc = new Map<string, Acc>();
  const unmapped: OutwardDerivation["unmapped"] = [];

  const add = (
    box: BoxId,
    table: string,
    pos: string | undefined,
    values: Partial<Record<AmountKey, Dec>>,
    doc: { section: string; number: string },
  ) => {
    const key = `${box}|${table}|${pos ?? ""}`;
    let a = acc.get(key);
    if (a === undefined) {
      a = { box, pos, ref: table, amounts: new Map(), docs: [] };
      acc.set(key, a);
    }
    for (const [f, v] of Object.entries(values) as [AmountKey, Dec][])
      a.amounts.set(f, (a.amounts.get(f) ?? new D(0)).plus(v));
    if (!a.docs.some((d) => d.section === doc.section && d.number === doc.number)) a.docs.push(doc);
  };
  const flag = (section: string, number: string, i: Gstr3bIssue) =>
    unmapped.push({ section, number, issue: i });

  /** Adds items to a box with only the fields AC's det node carries (spec §4.2). */
  const items = (
    box: BoxId,
    table: string,
    pos: string | undefined,
    list: readonly Item[],
    fields: readonly AmountKey[],
    sign: 1 | -1,
    doc: { section: string; number: string },
  ) => {
    for (const it of list) {
      const v: Partial<Record<AmountKey, Dec>> = {};
      for (const f of fields) {
        const raw =
          f === "taxableValue"
            ? it.taxableValue
            : f === "igst"
              ? it.igst
              : f === "cgst"
                ? it.cgst
                : f === "sgst"
                  ? it.sgst
                  : f === "cess"
                    ? it.cess
                    : undefined;
        v[f] = amt(raw).times(sign);
      }
      add(box, table, pos, v, doc);
    }
  };
  /** 3.2: inter-State items only (IGST); intra-State items are left out with an info issue (FG-3B 3.2). */
  const items32 = (
    box: BoxId,
    table: string,
    pos: string,
    list: readonly Item[],
    sign: 1 | -1,
    doc: { section: string; number: string },
  ) => {
    for (const it of list) {
      if (isPos(it.cgst) || isPos(it.sgst)) {
        flag(
          doc.section,
          doc.number,
          issue(
            "INTRA_ITEM_IN_32",
            `${doc.number}: intra-State item not placed in ${box} (3.2 is inter-State only)`,
            { box, pos },
          ),
        );
        continue;
      }
      add(
        box,
        table,
        pos,
        { taxableValue: amt(it.taxableValue).times(sign), igst: amt(it.igst).times(sign) },
        doc,
      );
    }
  };
  const zeroRated = (
    table: string,
    list: readonly Item[],
    sign: 1 | -1,
    doc: { section: string; number: string },
  ) => {
    if (list.some((it) => isPos(it.cgst) || isPos(it.sgst))) {
      flag(
        doc.section,
        doc.number,
        issue(
          "INTRA_ITEM_IN_31B",
          `${doc.number}: item with CGST/SGST in 3.1(b) (SV osup_zero has no camt/samt)`,
          { box: "3.1b" },
        ),
      );
    }
    items("3.1b", table, undefined, list, ["taxableValue", "igst", "cess"], sign, doc);
  };
  const box32 = (ctin: string): BoxId | undefined =>
    types[ctin] === "COMPOSITION" ? "3.2comp" : types[ctin] === "UIN_HOLDER" ? "3.2uin" : undefined;

  for (const grp of g.b2b) {
    for (const inv of grp.invoices) {
      const doc = { section: "b2b", number: inv.number };
      if (inv.reverseCharge) {
        if (inv.invoiceType === "R") {
          items("3.1a", "tbl4b", undefined, inv.items, ["taxableValue"], 1, doc); // G2
        } else {
          flag(
            "b2b",
            inv.number,
            issue(
              "RCM_NOT_MAPPED",
              `${inv.number}: reverse-charge ${inv.invoiceType} invoice has no GSTR-1 table (G5, Q-H4)`,
            ),
          );
        }
        continue;
      }
      if (inv.invoiceType === "R") {
        items(
          "3.1a",
          "tbl4a",
          undefined,
          inv.items,
          ["taxableValue", "igst", "cgst", "sgst", "cess"],
          1,
          doc,
        ); // G1
        const b = box32(grp.ctin);
        if (b !== undefined) items32(b, "tbl4a", inv.pos, inv.items, 1, doc);
      } else if (inv.invoiceType === "DE") {
        items(
          "3.1a",
          "tbl6c",
          undefined,
          inv.items,
          ["taxableValue", "igst", "cgst", "sgst", "cess"],
          1,
          doc,
        ); // G4
      } else {
        zeroRated("tbl6b", inv.items, 1, doc); // G3
      }
    }
  }
  for (const grp of g.b2cl) {
    for (const inv of grp.invoices) {
      const doc = { section: "b2cl", number: inv.number };
      items("3.1a", "tbl5a", undefined, inv.items, ["taxableValue", "igst", "cess"], 1, doc); // G6
      items32("3.2unreg", "tbl5a", grp.pos, inv.items, 1, doc);
    }
  }
  for (const grp of g.exp) {
    for (const inv of grp.invoices) {
      const doc = { section: "exp", number: inv.number };
      items("3.1b", "tbl6a", undefined, inv.items, ["taxableValue", "igst", "cess"], 1, doc); // G7
    }
  }
  for (const row of g.b2cs) {
    const doc = { section: "b2cs", number: `${row.supplyType}/${row.pos}/${row.rate}` };
    if (row.supplyType === "INTRA") {
      items("3.1a", "tbl7a_1", undefined, [row], ["taxableValue", "cgst", "sgst", "cess"], 1, doc); // G8
    } else {
      items("3.1a", "tbl7b_1", undefined, [row], ["taxableValue", "igst", "cess"], 1, doc); // G9
      items32("3.2unreg", "tbl7b_1", row.pos, [row], 1, doc);
    }
  }
  for (const grp of g.cdnr) {
    for (const note of grp.notes) {
      const doc = { section: "cdnr", number: note.number };
      const sign = note.noteType === "C" ? -1 : 1;
      if (note.reverseCharge) {
        flag(
          "cdnr",
          note.number,
          issue(
            "RCM_NOT_MAPPED",
            `${note.number}: reverse-charge note; where Table 9B carries it is not stated (Q-H4)`,
          ),
        );
        continue;
      }
      if (note.invoiceType === "R" || note.invoiceType === "DE") {
        items(
          "3.1a",
          "tbl9b",
          undefined,
          note.items,
          ["taxableValue", "igst", "cgst", "sgst", "cess"],
          sign,
          doc,
        );
        const b = note.invoiceType === "R" ? box32(grp.ctin) : undefined;
        if (b !== undefined) items32(b, "tbl9b", note.pos, note.items, sign, doc);
      } else {
        zeroRated("tbl9b", note.items, sign, doc);
      }
    }
  }
  for (const note of g.cdnur) {
    const doc = { section: "cdnur", number: note.number };
    const sign = note.noteType === "C" ? -1 : 1;
    if (note.type === "B2CL") {
      items(
        "3.1a",
        "tbl9b",
        undefined,
        note.items,
        ["taxableValue", "igst", "cgst", "sgst", "cess"],
        sign,
        doc,
      );
      if (note.pos === undefined) {
        flag(
          "cdnur",
          note.number,
          issue("NOTE_POS_MISSING", `${note.number}: B2CL note without POS is not placed in 3.2`, {
            box: "3.2unreg",
          }),
        );
      } else {
        items32("3.2unreg", "tbl9b", note.pos, note.items, sign, doc);
      }
    } else {
      zeroRated("tbl9b", note.items, sign, doc);
    }
  }

  // ---- Track A2 (spec §22.2) ----
  const H5: readonly AmendmentKeys[] = ["taxableValue", "igst", "cgst", "sgst", "cess"];
  const ZR: readonly AmendmentKeys[] = ["taxableValue", "igst", "cess"];
  type AmendmentKeys = AmountKey;

  // G11: Table 8 → 3.1c (nil rated + exempted) and 3.1e (non-GST).
  for (const r of g.nil ?? []) {
    const doc = { section: "nil", number: r.supply };
    add("3.1c", "tbl8", undefined, { taxableValue: amt(r.nilRated).plus(amt(r.exempted)) }, doc);
    add("3.1e", "tbl8", undefined, { taxableValue: amt(r.nonGst) }, doc);
  }

  /** One side of a 9A / 9C amendment, routed like its 9B / Table 4–6 counterpart, with `sign`. */
  const routeInvoice = (
    table: "tbl9a" | "tbl9c",
    o: {
      section: "b2ba" | "b2cla" | "expa" | "cdnra" | "cdnura";
      ctin?: string;
      groupPos?: string;
      pos?: string | undefined;
      invoiceType?: string | undefined;
      type?: string | undefined;
      list: readonly Item[];
    },
    sign: 1 | -1,
    doc: { section: string; number: string },
  ) => {
    switch (o.section) {
      case "b2ba":
      case "cdnra":
        if (o.invoiceType === "R" || o.invoiceType === "DE") {
          items("3.1a", table, undefined, o.list, H5, sign, doc);
          const b = o.invoiceType === "R" && o.ctin !== undefined ? box32(o.ctin) : undefined;
          if (b !== undefined && o.pos !== undefined) items32(b, table, o.pos, o.list, sign, doc);
        } else {
          zeroRated(table, o.list, sign, doc);
        }
        break;
      case "b2cla":
        items("3.1a", table, undefined, o.list, H5, sign, doc);
        if (o.groupPos !== undefined) items32("3.2unreg", table, o.groupPos, o.list, sign, doc);
        break;
      case "cdnura":
        if (o.type === "B2CL") {
          items("3.1a", table, undefined, o.list, H5, sign, doc);
          if (o.pos !== undefined) items32("3.2unreg", table, o.pos, o.list, sign, doc);
        } else {
          zeroRated(table, o.list, sign, doc);
        }
        break;
      case "expa":
        zeroRated(table, o.list, sign, doc);
        break;
    }
  };
  const noteSign = (t: string | undefined): 1 | -1 => (t === "C" ? -1 : 1);
  /** G12 / G13: revised − original (D-A12); RCM on either side is unmapped (Q-H4). */
  const amendment = (
    section: "b2ba" | "b2cla" | "expa" | "cdnra" | "cdnura",
    rev: {
      number: string;
      pos?: string | undefined;
      reverseCharge?: boolean | undefined;
      invoiceType?: string | undefined;
      noteType?: string | undefined;
      type?: string | undefined;
      items: readonly Item[];
    },
    orig: AmendmentOriginal,
    group: { ctin?: string; pos?: string },
  ) => {
    const table = section === "cdnra" || section === "cdnura" ? "tbl9c" : "tbl9a";
    const doc = { section, number: rev.number };
    if (rev.reverseCharge === true || orig.reverseCharge === true) {
      flag(
        section,
        rev.number,
        issue(
          "RCM_NOT_MAPPED",
          `${rev.number}: reverse-charge amendment; where Table ${table === "tbl9a" ? "9A" : "9C"} carries it is not stated (Q-H4)`,
        ),
      );
      return;
    }
    const base = {
      section,
      ...(group.ctin === undefined ? {} : { ctin: group.ctin }),
      ...(group.pos === undefined ? {} : { groupPos: group.pos }),
    };
    const isNote = section === "cdnra" || section === "cdnura";
    routeInvoice(
      table,
      { ...base, pos: rev.pos, invoiceType: rev.invoiceType, type: rev.type, list: rev.items },
      isNote ? noteSign(rev.noteType) : 1,
      doc,
    );
    routeInvoice(
      table,
      { ...base, pos: orig.pos, invoiceType: orig.invoiceType, type: orig.type, list: orig.items },
      isNote ? (noteSign(orig.noteType) === 1 ? -1 : 1) : -1,
      doc,
    );
  };
  for (const grp of g.b2ba ?? [])
    for (const inv of grp.invoices) amendment("b2ba", inv, inv.original, { ctin: grp.ctin });
  for (const grp of g.b2cla ?? [])
    for (const inv of grp.invoices) amendment("b2cla", inv, inv.original, { pos: grp.pos });
  for (const grp of g.expa ?? [])
    for (const inv of grp.invoices) amendment("expa", inv, inv.original, {});
  for (const grp of g.cdnra ?? [])
    for (const n of grp.notes) amendment("cdnra", n, n.original, { ctin: grp.ctin });
  for (const n of g.cdnura ?? []) amendment("cdnura", n, n.original, {});

  // G14: Table 10, revised − original.
  for (const r of g.b2csa ?? []) {
    const doc = {
      section: "b2csa",
      number: `${r.originalPeriod}/${r.supplyType}/${r.pos}/${r.rate}`,
    };
    const item = (h: Heads): Item => ({ rate: r.rate, ...h });
    for (const [h, sign] of [
      [r.revised, 1],
      [r.original, -1],
    ] as const) {
      if (r.supplyType === "INTRA") {
        items(
          "3.1a",
          "tbl10a",
          undefined,
          [item(h)],
          ["taxableValue", "cgst", "sgst", "cess"],
          sign,
          doc,
        );
      } else {
        items("3.1a", "tbl10b", undefined, [item(h)], ZR, sign, doc);
        items32("3.2unreg", "tbl10b", r.pos, [item(h)], sign, doc);
      }
    }
  }

  // G15: advances, only on request (D-A14).
  const advances = g.advances;
  if (ctx.confirmAdvanceMapping === true && advances !== undefined) {
    for (const [list, ab, sign] of [
      [advances.received, "a", 1],
      [advances.adjusted, "b", -1],
    ] as const) {
      for (const row of list) {
        const p = row.party;
        const number =
          p.kind === "B2B"
            ? `${p.recipientGstin}/${p.pos}`
            : p.kind === "B2C"
              ? `B2C/${p.pos}`
              : `EXPORT/${p.exportType}`;
        const doc = { section: ab === "a" ? "at" : "txpd", number };
        const its: Item[] = row.items.map((it) => ({
          rate: it.rate,
          taxableValue: it.amount,
          ...(it.igst === undefined ? {} : { igst: it.igst }),
          ...(it.cgst === undefined ? {} : { cgst: it.cgst }),
          ...(it.sgst === undefined ? {} : { sgst: it.sgst }),
          cess: it.cess,
        }));
        if (p.kind === "EXPORT") {
          zeroRated(`tbl11${ab}_3`, its, sign, doc);
          continue;
        }
        if (p.kind === "B2B" && p.reverseCharge) {
          flag(
            doc.section,
            number,
            issue("RCM_NOT_MAPPED", `${number}: reverse-charge advance is not mapped (Q-H4)`),
          );
          continue;
        }
        items("3.1a", `tbl11${ab}_1_2_4`, undefined, its, H5, sign, doc);
        if (row.supplyType !== "INTER") continue;
        if (p.kind === "B2C") items32("3.2unreg", `tbl11${ab}_4_5`, p.pos, its, sign, doc);
        else {
          const b = box32(p.recipientGstin);
          if (b !== undefined) items32(b, `tbl11${ab}_1_5`, p.pos, its, sign, doc);
        }
      }
    }
  }

  const entries: TrailEntry[] = [...acc.values()]
    .sort(
      (x, y) =>
        BOX_ORDER.indexOf(x.box) - BOX_ORDER.indexOf(y.box) ||
        TABLE_ORDER.indexOf(x.ref) - TABLE_ORDER.indexOf(y.ref) ||
        (x.pos ?? "").localeCompare(y.pos ?? ""),
    )
    .map((a) => {
      const amounts: Partial<Record<AmountKey, string>> = {};
      for (const [f, v] of a.amounts) amounts[f] = v.isZero() ? "0.00" : v.toFixed(2);
      const e: TrailEntry = { box: a.box, source: "GSTR1", ref: a.ref, amounts, documents: a.docs };
      if (a.pos !== undefined) e.pos = a.pos;
      return e;
    });
  const advanceKeys = new Set(AC_ADVANCE_MAP.map((r) => `${r.box}:${r.table}`));
  const notCovered = Object.entries(AC_NOT_COVERED)
    .flatMap(([box, keys]) => keys.map((k) => `${box}:${k}`))
    .filter((k) => ctx.confirmAdvanceMapping !== true || !advanceKeys.has(k));
  return {
    ok: true,
    value: {
      gstin: g.gstin,
      period: g.period,
      entries,
      unmapped,
      notCovered,
      recipientTypes: { ...types },
    },
  };
}
