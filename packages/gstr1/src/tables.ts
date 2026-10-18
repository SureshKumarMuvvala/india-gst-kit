// Source: caller-supplied GSTR-1 tables (spec §17.4–§17.8, §17.21):
//   - Table 10 `b2csa`: FORM GSTR-1 Table 10 (sources/gstr1/form-gstr1-excerpt-18052021.txt; Notification 26/2022-CT
//     Ins. 12, sources/gstr1/notification-26-2022-ct-gstr1-excerpt.txt); S5 `b2csa` (`#txvalue` / `#nonEmptyNil`:
//     no minimum); D-A4 (revised and original rows are caller input).
//   - Table 8 `nil`: FORM GSTR-1 Table 8 (8A–8D; columns Nil rated, Exempted, Non-GST); S5 `nil` (`sply_ty` codes
//     INTRB2B / INTRAB2B / INTRB2C / INTRAB2C, matched to the rows by name — D-A5; `#nonEmptyNil`).
//   - Table 11 `at` / `txpd` / `ata` / `txpda`: FORM GSTR-1 Table 11 (11A(1)/11B(1) intra-State, 11A(2)/11B(2)
//     inter-State), Notification 26/2022-CT Ins. 13–15; S5 split by party (`at_b2b` / `at_b2c` / `at_exp`,
//     `#nonEmptyCostAT` ±); D-A6 (exports `INTER`, `RC` never emitted, `at_ecom` not built). `sply_ty` as T §4
//     `getSupplyType`: intra when POS = supplier state, SEZ always inter.
//   - Table 14 `supeco` (Notification 26/2022-CT Table 14, Ins. 18–21: (a) operator liable to collect TCS u/s 52 →
//     `clttx`, (b) liable to pay tax u/s 9(5) → `paytx`) and Table 15 `ecom` (Table 15/15A, Ins. 22–24: reported by
//     the operator; supplier × recipient registered/unregistered → b2b / b2c / urp2b / urp2c): caller rows only (D-A9).
// Retrieved: 2026-10-18
// Status: UNVERIFIED — needs CA
import type { z } from "zod";
import { D, fmt2, trimDecimal, type Dec } from "./decimal.js";
import {
  AdvancesInputSchema,
  B2csAmendmentInputSchema,
  EcomInputSchema,
  EcoMarkInputSchema,
  NilRowInputSchema,
  SupecoInputSchema,
  type AdvancePartyInput,
  type AdvanceRowInput,
} from "./inputs.js";
import { amendmentPeriodIssue } from "./amend.js";
import { GSTR1_RATES } from "./rates.js";
import { ETIN_PATTERN, isS5Ctin, POS_FOREIGN_PATTERN, POS_PATTERN } from "./recipient.js";
import type {
  AdvanceAmendment,
  AdvanceParty,
  AdvanceRow,
  Advances,
  B2csaRow,
  Ecom,
  EcomItem,
  Heads,
  NilRow,
  Supeco,
} from "./return-schema.js";
import { issue, type Gstr1Issue, type Gstr1IssueCode, type ReturnPeriod } from "./types.js";

type Path = (string | number)[];
const RATE_SET: ReadonlySet<string> = new Set(GSTR1_RATES);

/** "1000" → "1000.00"; "-5.5" → "-5.50". */
export const money = (s: string): string => fmt2(new D(s));
const optMoney = (s: string | undefined) => (s === undefined ? undefined : money(s));

/** Collects issues against one input path. */
class Issues {
  readonly list: Gstr1Issue[] = [];
  add(code: Gstr1IssueCode, message: string, path: Path, documentNumber?: string): void {
    this.list.push(
      issue(code, message, { path, ...(documentNumber === undefined ? {} : { documentNumber }) }),
    );
  }
  /** Zod failures of a caller input become SCHEMA issues with their path. */
  zod(error: z.ZodError, base: Path): void {
    for (const i of error.issues) {
      this.add("SCHEMA", i.message, [
        ...base,
        ...i.path.map((p) => (typeof p === "number" ? p : String(p))),
      ]);
    }
  }
  rate(r: string, path: Path, n?: string): string {
    const t = trimDecimal(r);
    if (!RATE_SET.has(t))
      this.add("RATE_NOT_ACCEPTED", `rate ${r} is not in the GSTR-1 rate list`, path, n);
    return t;
  }
  pos(p: string, foreign: boolean, path: Path, n?: string): void {
    if (!(foreign ? POS_FOREIGN_PATTERN : POS_PATTERN).test(p)) {
      this.add("POS_NOT_ACCEPTED", `place of supply ${p} is not accepted in this section`, path, n);
    }
  }
  ctin(g: string, path: Path, n?: string): void {
    if (!isS5Ctin(g)) {
      this.add("RECIPIENT_GSTIN_FORMAT", `GSTIN ${g} does not match the portal's pattern`, path, n);
    }
  }
  range(v: string | undefined, o: { min?: string; max: string }, path: Path, n?: string): void {
    if (v === undefined) return;
    const d = new D(v);
    if (d.gt(o.max) || (o.min !== undefined && d.lt(o.min))) {
      this.add("AMOUNT_OUT_OF_RANGE", `${v} is outside the portal's range`, path, n);
    }
  }
}

/** S5 `#nonEmptyCostAT`: ±99 999 999 999.99. */
const AT = { min: "-99999999999.99", max: "99999999999.99" };
/** S5 `#txvalue` / `#nonEmptyNil`: ≤ 99 999 999 999.99, no minimum. */
const NIL = { max: "99999999999.99" };
/** S5 `#txval` / `#nonEmptyCost`: 0 … 99 999 999 999.99. */
const COST = { min: "0", max: "99999999999.99" };
/** S5 `#totalValue`. */
const VALUE = { min: "0", max: "9999999999999.99" };

const isPositive = (v: string | undefined) => v !== undefined && !new D(v).isZero();

/** Head split per supply type: INTRA carries no IGST; INTER no CGST/SGST. */
function splitWrong(
  t: "INTRA" | "INTER",
  h: { igst?: string | undefined; cgst?: string | undefined; sgst?: string | undefined },
): boolean {
  return t === "INTRA" ? isPositive(h.igst) : isPositive(h.cgst) || isPositive(h.sgst);
}

const supplyTypeOf = (pos: string, supplierState: string): "INTRA" | "INTER" =>
  pos === supplierState ? "INTRA" : "INTER";

// ---------------------------------------------------------------- Table 10

export function buildB2csa(
  input: readonly unknown[],
  ctx: { period: ReturnPeriod; supplierState: string },
): { rows: B2csaRow[]; issues: Gstr1Issue[] } {
  const is = new Issues();
  const rows: B2csaRow[] = [];
  const seen = new Set<string>();
  input.forEach((raw, i) => {
    const path: Path = ["b2csAmendments", i];
    const p = B2csAmendmentInputSchema.safeParse(raw);
    if (!p.success) {
      is.zod(p.error, path);
      return;
    }
    const a = p.data;
    const before = is.list.length;
    const pi = amendmentPeriodIssue(a.originalPeriod, ctx.period, [...path, "originalPeriod"]);
    if (pi !== undefined) is.list.push(pi);
    is.pos(a.pos, false, [...path, "pos"]);
    const rate = is.rate(a.rate, [...path, "rate"]);
    const supplyType = supplyTypeOf(a.pos, ctx.supplierState);
    for (const side of ["revised", "original"] as const) {
      if (splitWrong(supplyType, a[side])) {
        is.add(
          "B2CS_TAX_SPLIT",
          `${supplyType} row carries ${supplyType === "INTRA" ? "IGST" : "CGST/SGST"}`,
          [...path, side],
        );
      }
    }
    for (const k of ["taxableValue", "igst", "cgst", "sgst", "cess"] as const) {
      is.range(a.revised[k], NIL, [...path, "revised", k]);
    }
    const key = `${a.originalPeriod}|${a.pos}|${rate}`;
    if (seen.has(key)) {
      is.add(
        "DUPLICATE_B2CS_AMENDMENT",
        `Table 7 row ${a.pos} @ ${rate} of ${a.originalPeriod} is amended twice`,
        path,
      );
    }
    seen.add(key);
    if (is.list.length > before) return;
    const heads = (h: typeof a.revised): Heads => {
      const out: Heads = { taxableValue: money(h.taxableValue), cess: money(h.cess) };
      if (supplyType === "INTER") out.igst = money(h.igst ?? "0");
      else {
        out.cgst = money(h.cgst ?? "0");
        out.sgst = money(h.sgst ?? "0");
      }
      return out;
    };
    rows.push({
      originalPeriod: a.originalPeriod,
      supplyType,
      pos: a.pos,
      rate,
      revised: heads(a.revised),
      original: heads(a.original),
    });
  });
  const pk = (fp: string) => fp.slice(2) + fp.slice(0, 2);
  rows.sort(
    (x, y) =>
      pk(x.originalPeriod).localeCompare(pk(y.originalPeriod)) ||
      x.pos.localeCompare(y.pos) ||
      new D(x.rate).comparedTo(y.rate),
  );
  return { rows, issues: is.list };
}

// ---------------------------------------------------------------- Table 8

/** FORM GSTR-1 8A–8D order. */
export const NIL_ORDER = [
  "INTER_REGISTERED",
  "INTRA_REGISTERED",
  "INTER_UNREGISTERED",
  "INTRA_UNREGISTERED",
] as const;

export function buildNil(input: readonly unknown[]): { rows: NilRow[]; issues: Gstr1Issue[] } {
  const is = new Issues();
  const rows: NilRow[] = [];
  const seen = new Set<string>();
  input.forEach((raw, i) => {
    const path: Path = ["nil", i];
    const p = NilRowInputSchema.safeParse(raw);
    if (!p.success) {
      is.zod(p.error, path);
      return;
    }
    const r = p.data;
    if (seen.has(r.supply)) {
      is.add("DUPLICATE_NIL_ROW", `Table 8 row ${r.supply} is given twice`, [...path, "supply"]);
      return;
    }
    seen.add(r.supply);
    for (const k of ["nilRated", "exempted", "nonGst"] as const) is.range(r[k], NIL, [...path, k]);
    rows.push({
      supply: r.supply,
      nilRated: money(r.nilRated),
      exempted: money(r.exempted),
      nonGst: money(r.nonGst),
    });
  });
  rows.sort((a, b) => NIL_ORDER.indexOf(a.supply) - NIL_ORDER.indexOf(b.supply));
  return { rows, issues: is.list };
}

// ---------------------------------------------------------------- Table 11

function partyKey(p: AdvanceParty): string {
  switch (p.kind) {
    case "B2B":
      return `B2B|${p.recipientGstin}|${p.pos}|${p.invoiceType}|${p.reverseCharge ? "Y" : "N"}`;
    case "B2C":
      return `B2C|${p.pos}`;
    case "EXPORT":
      return `EXPORT|${p.exportType}`;
  }
}

function advanceSupplyType(p: AdvancePartyInput, supplierState: string): "INTRA" | "INTER" {
  switch (p.kind) {
    case "B2B":
      return p.invoiceType === "SEWP" || p.invoiceType === "SEWOP"
        ? "INTER"
        : supplyTypeOf(p.pos, supplierState);
    case "B2C":
      return supplyTypeOf(p.pos, supplierState);
    case "EXPORT":
      return "INTER";
  }
}

function checkParty(is: Issues, p: AdvancePartyInput, path: Path): void {
  if (p.kind === "B2B") {
    is.ctin(p.recipientGstin, [...path, "recipientGstin"]);
    is.pos(p.pos, true, [...path, "pos"]);
  } else if (p.kind === "B2C") {
    is.pos(p.pos, false, [...path, "pos"]);
  }
}

/** Checks one advance row and returns it aggregated per rate (undefined when it has errors). */
function advanceRow(
  is: Issues,
  r: AdvanceRowInput,
  path: Path,
  supplierState: string,
): AdvanceRow | undefined {
  const before = is.list.length;
  checkParty(is, r.party, [...path, "party"]);
  const supplyType = advanceSupplyType(r.party, supplierState);
  const byRate = new Map<string, Record<"amount" | "igst" | "cgst" | "sgst" | "cess", Dec>>();
  r.items.forEach((it, j) => {
    const ip: Path = [...path, "items", j];
    const rate = is.rate(it.rate, [...ip, "rate"]);
    if (splitWrong(supplyType, it)) {
      is.add(
        "ADVANCE_TAX_SPLIT",
        `${supplyType} advance carries ${supplyType === "INTRA" ? "IGST" : "CGST/SGST"}`,
        ip,
      );
    }
    for (const k of ["amount", "igst", "cgst", "sgst", "cess"] as const)
      is.range(it[k], AT, [...ip, k]);
    const z = new D(0);
    const acc = byRate.get(rate) ?? { amount: z, igst: z, cgst: z, sgst: z, cess: z };
    for (const k of ["amount", "igst", "cgst", "sgst", "cess"] as const) {
      acc[k] = acc[k].plus(new D(it[k] ?? "0"));
    }
    byRate.set(rate, acc);
  });
  if (is.list.length > before) return undefined;
  const party: AdvanceParty =
    r.party.kind === "B2B"
      ? { ...r.party }
      : r.party.kind === "B2C"
        ? { kind: "B2C", pos: r.party.pos }
        : { kind: "EXPORT", exportType: r.party.exportType };
  return {
    party,
    supplyType,
    items: [...byRate].map(([rate, a]) => ({
      rate,
      amount: fmt2(a.amount),
      ...(supplyType === "INTER"
        ? { igst: fmt2(a.igst) }
        : { cgst: fmt2(a.cgst), sgst: fmt2(a.sgst) }),
      cess: fmt2(a.cess),
    })),
  };
}

/** Merges rows with the same key (and, for amendments, the same original); items sum per rate. */
function mergeRows<T extends { row: AdvanceRow }>(list: T[], key: (t: T) => string): T[] {
  const out = new Map<string, T>();
  for (const t of list) {
    const k = key(t);
    const prev = out.get(k);
    if (prev === undefined) {
      out.set(k, structuredClone(t));
      continue;
    }
    for (const it of t.row.items) {
      const same = prev.row.items.find((x) => x.rate === it.rate);
      if (same === undefined) {
        prev.row.items.push({ ...it });
        continue;
      }
      for (const f of ["amount", "igst", "cgst", "sgst", "cess"] as const) {
        const a = same[f];
        const b = it[f];
        if (a !== undefined && b !== undefined) same[f] = fmt2(new D(a).plus(b));
      }
    }
  }
  return [...out.values()];
}

export function buildAdvances(
  raw: unknown,
  ctx: { period: ReturnPeriod; supplierState: string },
): { advances: Advances | undefined; issues: Gstr1Issue[] } {
  const is = new Issues();
  const p = AdvancesInputSchema.safeParse(raw);
  if (!p.success) {
    is.zod(p.error, ["advances"]);
    return { advances: undefined, issues: is.list };
  }
  const a = p.data;
  const rows = (list: readonly AdvanceRowInput[] | undefined, name: string): AdvanceRow[] => {
    const out: { row: AdvanceRow }[] = [];
    (list ?? []).forEach((r, i) => {
      const row = advanceRow(is, r, ["advances", name, i], ctx.supplierState);
      if (row !== undefined) out.push({ row });
    });
    return mergeRows(out, (t) => partyKey(t.row.party)).map((t) => t.row);
  };
  const amendments = (list: typeof a.receivedAmendments, name: string): AdvanceAmendment[] => {
    const out: AdvanceAmendment[] = [];
    (list ?? []).forEach((m, i) => {
      const path: Path = ["advances", name, i];
      const before = is.list.length;
      const pi = amendmentPeriodIssue(m.originalPeriod, ctx.period, [...path, "originalPeriod"]);
      if (pi !== undefined) is.list.push(pi);
      if (m.original.kind !== m.revised.party.kind) {
        is.add(
          "ADVANCE_PARTY_CHANGE",
          `a ${m.original.kind} advance cannot be amended into a ${m.revised.party.kind} one`,
          [...path, "revised", "party", "kind"],
        );
      }
      checkParty(is, m.original, [...path, "original"]);
      const row = advanceRow(is, m.revised, [...path, "revised"], ctx.supplierState);
      if (row === undefined || is.list.length > before) return;
      const original: AdvanceParty =
        m.original.kind === "B2B"
          ? { ...m.original }
          : m.original.kind === "B2C"
            ? { kind: "B2C", pos: m.original.pos }
            : { kind: "EXPORT", exportType: m.original.exportType };
      out.push({ originalPeriod: m.originalPeriod, original, row });
    });
    return mergeRows(
      out,
      (t) => `${t.originalPeriod}|${partyKey(t.original)}|${partyKey(t.row.party)}`,
    );
  };
  const advances: Advances = {
    received: rows(a.received, "received"),
    adjusted: rows(a.adjusted, "adjusted"),
    receivedAmendments: amendments(a.receivedAmendments, "receivedAmendments"),
    adjustedAmendments: amendments(a.adjustedAmendments, "adjustedAmendments"),
  };
  return { advances, issues: is.list };
}

// ---------------------------------------------------------------- 4C / 5B marks

export function parseEcoMarks(input: readonly unknown[]): {
  marks: { kind: string; number: string; etin: string; path: Path }[];
  issues: Gstr1Issue[];
} {
  const is = new Issues();
  const marks: { kind: string; number: string; etin: string; path: Path }[] = [];
  const seen = new Set<string>();
  input.forEach((raw, i) => {
    const path: Path = ["ecoMarks", i];
    const p = EcoMarkInputSchema.safeParse(raw);
    if (!p.success) {
      is.zod(p.error, path);
      return;
    }
    const m = p.data;
    if (!ETIN_PATTERN.test(m.etin)) {
      is.add(
        "ECO_GSTIN_FORMAT",
        `e-commerce operator GSTIN ${m.etin} does not match the TCS pattern (C in position 14)`,
        [...path, "etin"],
        m.number,
      );
      return;
    }
    const key = `${m.kind}|${m.number}`;
    if (seen.has(key)) {
      is.add("DUPLICATE_DOCUMENT", `document ${m.number} is marked more than once`, path, m.number);
      return;
    }
    seen.add(key);
    marks.push({ ...m, path });
  });
  return { marks, issues: is.list };
}

// ---------------------------------------------------------------- Table 14

export function buildSupeco(
  raw: unknown,
  ctx: { period: ReturnPeriod },
): { supeco: Supeco | undefined; issues: Gstr1Issue[] } {
  const is = new Issues();
  const p = SupecoInputSchema.safeParse(raw);
  if (!p.success) {
    is.zod(p.error, ["supeco"]);
    return { supeco: undefined, issues: is.list };
  }
  const s = p.data;
  type RowIn = NonNullable<typeof s.collectsTcs>[number];
  const row = (r: RowIn, path: Path) => {
    is.ctin(r.etin, [...path, "etin"]);
    for (const k of ["netValue", "igst", "cgst", "sgst", "cess"] as const)
      is.range(r[k], AT, [...path, k]);
    const out: Supeco["collectsTcs"][number] = {
      etin: r.etin,
      netValue: money(r.netValue),
      igst: money(r.igst),
      cgst: money(r.cgst),
      sgst: money(r.sgst),
    };
    const cess = optMoney(r.cess);
    if (cess !== undefined) out.cess = cess;
    if (r.flag !== undefined) out.flag = r.flag;
    return out;
  };
  const rows = (list: readonly RowIn[] | undefined, name: string) =>
    (list ?? []).map((r, i) => row(r, ["supeco", name, i]));
  const arows = (list: typeof s.collectsTcsAmendments, name: string) =>
    (list ?? []).map((r, i) => {
      const path: Path = ["supeco", name, i];
      const pi = amendmentPeriodIssue(r.originalPeriod, ctx.period, [...path, "originalPeriod"]);
      if (pi !== undefined) is.list.push(pi);
      is.ctin(r.originalEtin, [...path, "originalEtin"]);
      return { ...row(r, path), originalEtin: r.originalEtin, originalPeriod: r.originalPeriod };
    });
  const supeco: Supeco = {
    collectsTcs: rows(s.collectsTcs, "collectsTcs"),
    paysTax95: rows(s.paysTax95, "paysTax95"),
    collectsTcsAmendments: arows(s.collectsTcsAmendments, "collectsTcsAmendments"),
    paysTax95Amendments: arows(s.paysTax95Amendments, "paysTax95Amendments"),
  };
  return { supeco, issues: is.list };
}

// ---------------------------------------------------------------- Table 15

export function buildEcom(
  raw: unknown,
  ctx: { period: ReturnPeriod; periodEnd: string },
): { ecom: Ecom | undefined; issues: Gstr1Issue[] } {
  const is = new Issues();
  const p = EcomInputSchema.safeParse(raw);
  if (!p.success) {
    is.zod(p.error, ["ecom"]);
    return { ecom: undefined, issues: is.list };
  }
  const e = p.data;
  type ItemIn = {
    rate: string;
    taxableValue: string;
    igst?: string | undefined;
    cgst?: string | undefined;
    sgst?: string | undefined;
    cess?: string | undefined;
  };
  const item = (
    it: ItemIn,
    t: "INTRA" | "INTER",
    path: Path,
    range: { min?: string; max: string },
    n?: string,
  ): EcomItem => {
    const rate = is.rate(it.rate, [...path, "rate"], n);
    if (splitWrong(t, it)) {
      is.add("TAX_SPLIT", `${t} row carries ${t === "INTRA" ? "IGST" : "CGST/SGST"}`, path, n);
    }
    for (const k of ["taxableValue", "igst", "cgst", "sgst", "cess"] as const) {
      is.range(it[k], range, [...path, k], n);
    }
    const out: EcomItem = { rate, taxableValue: money(it.taxableValue) };
    for (const k of ["igst", "cgst", "sgst", "cess"] as const) {
      const v = optMoney(it[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  };
  type DocIn = NonNullable<typeof e.urp2b>[number];
  const seenDocs = new Set<string>();
  const doc = (d: DocIn, supplier: string, path: Path) => {
    is.ctin(d.recipientGstin, [...path, "recipientGstin"], d.number);
    is.pos(d.pos, true, [...path, "pos"], d.number);
    if (d.date < "2017-07-01" || d.date > ctx.periodEnd) {
      is.add(
        "DATE_OUT_OF_RANGE",
        `date ${d.date} is outside 2017-07-01 … ${ctx.periodEnd}`,
        [...path, "date"],
        d.number,
      );
    }
    is.range(d.value, VALUE, [...path, "value"], d.number);
    const key = `${path[1] ?? ""}|${supplier}|${d.number}`;
    if (seenDocs.has(key)) {
      is.add(
        "DUPLICATE_DOCUMENT",
        `document number ${d.number} is used more than once`,
        path,
        d.number,
      );
    }
    seenDocs.add(key);
    return {
      recipientGstin: d.recipientGstin,
      number: d.number,
      date: d.date,
      value: money(d.value),
      pos: d.pos,
      supplyType: d.supplyType,
      invoiceType: d.invoiceType,
      flag: d.flag,
      items: d.items.map((it, j) => item(it, d.supplyType, [...path, "items", j], COST, d.number)),
    };
  };
  const amend = (o: { originalNumber: string; originalDate: string }) => ({
    originalNumber: o.originalNumber,
    originalDate: o.originalDate,
  });
  const ecom: Ecom = {
    b2b: (e.b2b ?? []).map((d, i) => {
      const path: Path = ["ecom", "b2b", i];
      is.ctin(d.supplierGstin, [...path, "supplierGstin"], d.number);
      return { supplierGstin: d.supplierGstin, ...doc(d, d.supplierGstin, path) };
    }),
    urp2b: (e.urp2b ?? []).map((d, i) => doc(d, "", ["ecom", "urp2b", i])),
    b2c: (e.b2c ?? []).map((r, i) => {
      const path: Path = ["ecom", "b2c", i];
      is.ctin(r.supplierGstin, [...path, "supplierGstin"]);
      is.pos(r.pos, false, [...path, "pos"]);
      const { supplierGstin, pos, supplyType, flag, ...it } = r;
      return { supplierGstin, pos, supplyType, flag, ...item(it, supplyType, path, AT) };
    }),
    urp2c: (e.urp2c ?? []).map((r, i) => {
      const path: Path = ["ecom", "urp2c", i];
      is.pos(r.pos, false, [...path, "pos"]);
      const { pos, supplyType, flag, ...it } = r;
      return { pos, supplyType, flag, ...item(it, supplyType, path, AT) };
    }),
    b2ba: (e.b2ba ?? []).map((d, i) => {
      const path: Path = ["ecom", "b2ba", i];
      is.ctin(d.supplierGstin, [...path, "supplierGstin"], d.number);
      return { supplierGstin: d.supplierGstin, ...doc(d, d.supplierGstin, path), ...amend(d) };
    }),
    urp2ba: (e.urp2ba ?? []).map((d, i) => ({ ...doc(d, "", ["ecom", "urp2ba", i]), ...amend(d) })),
    b2ca: (e.b2ca ?? []).map((r, i) => {
      const path: Path = ["ecom", "b2ca", i];
      is.ctin(r.supplierGstin, [...path, "supplierGstin"]);
      is.ctin(r.originalSupplierGstin, [...path, "originalSupplierGstin"]);
      is.pos(r.pos, false, [...path, "pos"]);
      const pi = amendmentPeriodIssue(r.originalPeriod, ctx.period, [...path, "originalPeriod"]);
      if (pi !== undefined) is.list.push(pi);
      return {
        pos: r.pos,
        supplierGstin: r.supplierGstin,
        originalSupplierGstin: r.originalSupplierGstin,
        originalPeriod: r.originalPeriod,
        supplyType: r.supplyType,
        flag: r.flag,
        items: r.items.map((it, j) => item(it, r.supplyType, [...path, "items", j], AT)),
      };
    }),
    urp2ca: (e.urp2ca ?? []).map((r, i) => {
      const path: Path = ["ecom", "urp2ca", i];
      is.pos(r.pos, false, [...path, "pos"]);
      const pi = amendmentPeriodIssue(r.originalPeriod, ctx.period, [...path, "originalPeriod"]);
      if (pi !== undefined) is.list.push(pi);
      return {
        pos: r.pos,
        originalPeriod: r.originalPeriod,
        supplyType: r.supplyType,
        flag: r.flag,
        items: r.items.map((it, j) => item(it, r.supplyType, [...path, "items", j], AT)),
      };
    }),
  };
  return { ecom, issues: is.list };
}
