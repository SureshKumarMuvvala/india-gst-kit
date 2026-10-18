// Source: spec §9.2 and D-H8 (box ↔ AC subtotal per §3.2; ITC pairing opt-in; never auto-corrects)
// Retrieved: 2026-10-18
// Status: UNVERIFIED — needs CA
import { z } from "zod";
import { getAt } from "@india-gst-kit/model";
import { AC_BOX_PATH, AC_GSTR1_MAP, AC_ITC_PAIRING, AC_ITC_UNPAIRED } from "./ac-map.js";
import { AutoCalcParsedSchema, type AutoCalc } from "./autocalc.js";
import { BOX_FIELDS, boxObject, isPosBox, posList } from "./boxes.js";
import { D } from "./decimal.js";
import { STATE_CD_PATTERN } from "./primitives.js";
import type { AmountKey, Gstr3bReturn, TrailEntry } from "./return-schema.js";
import {
  BOX_IDS,
  BoxIdSchema,
  Gstr3bIssueSchema,
  issue,
  type BoxId,
  type Gstr3bIssue,
} from "./types.js";

export const AcBlockSchema = z.enum(["liabitc", "liabitcr1", "liabitcr1a"]);
export type AcBlock = z.infer<typeof AcBlockSchema>;

export const CompareResultSchema = z.strictObject({
  block: AcBlockSchema,
  tolerance: z.string(),
  meta: AutoCalcParsedSchema.shape.meta,
  boxes: z.array(
    z.strictObject({
      box: BoxIdSchema,
      pos: z.string().optional(),
      field: z.string(),
      ours: z.string(),
      portal: z.string().nullable(),
      difference: z.string().nullable(),
      withinTolerance: z.boolean().nullable(),
    }),
  ),
  uncompared: z.array(
    z.strictObject({
      box: BoxIdSchema.optional(),
      reason: z.enum(["NOT_AUTO_CALCULATED", "MAPPING_UNCONFIRMED"]),
      portalPath: z.string().optional(),
      portal: z.record(z.string(), z.string()).optional(),
    }),
  ),
  detail: z
    .array(
      z.strictObject({
        box: BoxIdSchema,
        acTable: z.string(),
        pos: z.string().optional(),
        ours: z.record(z.string(), z.string()),
        portal: z.record(z.string(), z.string()).nullable(),
      }),
    )
    .optional(),
  issues: z.array(Gstr3bIssueSchema),
});
export type CompareResult = z.infer<typeof CompareResultSchema>;

export type CompareOptions = {
  block?: AcBlock;
  /** Absolute, per field, inclusive; default "0.00" (D-H8). */
  tolerance?: string;
  /** Compare 4A IMPG/ISRC/ISD/OTH against AC itc4a1/3/4/5 (D-H8; needs CA). */
  confirmItcMapping?: boolean;
  /** Our per-GSTR-1-table trail entries against AC det nodes. */
  detail?: boolean;
  /** Needed for `detail`: the draft's trail. */
  trail?: readonly TrailEntry[];
};

/** AC wire name → our field name. */
const AC_FIELD: Readonly<Record<string, AmountKey>> = {
  txval: "taxableValue",
  iamt: "igst",
  camt: "cgst",
  samt: "sgst",
  csamt: "cess",
  igst: "igst",
  cgst: "cgst",
  sgst: "sgst",
  cess: "cess",
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const at = (root: unknown, dotted: string) => getAt(root, dotted.split("."));

/** Our field values of an AC row (only the money fields it carries). */
function acAmounts(node: unknown): Record<string, string> | null {
  if (!isObj(node)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(node)) {
    const f = AC_FIELD[k];
    if (f !== undefined && typeof v === "string") out[f] = v;
  }
  return out;
}

const fmt = (d: InstanceType<typeof D>) => (d.isZero() ? "0.00" : d.toFixed(2));

/**
 * Diffs our return against the portal's Auto Calc figures, box by box (spec §9.2). Read-only: nothing is ever written
 * back into `ours`.
 */
export function compareWithAutoCalc(
  ours: Gstr3bReturn,
  portal: AutoCalc,
  options: CompareOptions = {},
): CompareResult {
  const block = AcBlockSchema.parse(options.block ?? "liabitc");
  const tolerance = options.tolerance ?? "0.00";
  if (!/^\d+(\.\d{1,2})?$/.test(tolerance))
    throw new RangeError(`tolerance "${tolerance}" must be a non-negative decimal`);
  const tol = new D(tolerance);
  const data = portal.data[block];
  const issues: Gstr3bIssue[] = [];
  const boxes: CompareResult["boxes"] = [];
  const uncompared: CompareResult["uncompared"] = [];

  const diff = (
    box: BoxId,
    field: AmountKey,
    mine: string,
    theirs: string | undefined,
    pos?: string,
  ) => {
    const row: CompareResult["boxes"][number] = {
      box,
      field,
      ours: mine,
      portal: theirs ?? null,
      difference: null,
      withinTolerance: null,
    };
    if (pos !== undefined) row.pos = pos;
    if (theirs !== undefined) {
      const d = new D(mine).minus(theirs);
      row.difference = fmt(d);
      row.withinTolerance = d.abs().lte(tol);
    }
    boxes.push(row);
  };

  for (const box of BOX_IDS) {
    const acPath = AC_BOX_PATH[box] ?? AC_ITC_PAIRING[box];
    if (acPath === undefined) {
      uncompared.push({ box, reason: "NOT_AUTO_CALCULATED" });
      continue;
    }
    const subtotal = at(data, `${acPath}.subtotal`);
    if (box in AC_ITC_PAIRING && options.confirmItcMapping !== true) {
      const p = acAmounts(subtotal);
      uncompared.push({
        box,
        reason: "MAPPING_UNCONFIRMED",
        portalPath: acPath,
        ...(p === null ? {} : { portal: p }),
      });
      continue;
    }
    if (isPosBox(box)) {
      const theirs = new Map<string, Record<string, string>>();
      for (const r of Array.isArray(subtotal) ? (subtotal as unknown[]) : []) {
        if (!isObj(r) || typeof r["pos"] !== "string") continue;
        if (!STATE_CD_PATTERN.test(r["pos"])) {
          issues.push(
            issue(
              "POS_NOT_ACCEPTED",
              `portal ${box} row with POS "${r["pos"]}" is not savable (SV #state_cd); not compared`,
              { box, pos: r["pos"] },
            ),
          );
          continue;
        }
        theirs.set(r["pos"], acAmounts(r) ?? {});
      }
      const mine = new Map(posList(ours, box).map((r) => [r.pos, r]));
      for (const pos of [...new Set([...mine.keys(), ...theirs.keys()])].sort()) {
        for (const f of BOX_FIELDS[box]) {
          const m = mine.get(pos)?.[f as "taxableValue" | "igst"] ?? "0.00";
          const t = subtotal === undefined ? undefined : (theirs.get(pos)?.[f] ?? "0.00");
          diff(box, f, m, t, pos);
        }
      }
      continue;
    }
    const mine = boxObject(ours, box);
    const theirs = acAmounts(subtotal);
    for (const f of BOX_FIELDS[box]) diff(box, f, mine[f] ?? "0.00", theirs?.[f]);
  }
  for (const p of AC_ITC_UNPAIRED) {
    const amounts = acAmounts(at(data, `${p}.subtotal`));
    uncompared.push({
      reason: "MAPPING_UNCONFIRMED",
      portalPath: p,
      ...(amounts === null ? {} : { portal: amounts }),
    });
  }

  const result: CompareResult = {
    block,
    tolerance,
    meta: { ...portal.meta },
    boxes,
    uncompared,
    issues,
  };
  if (options.detail === true) result.detail = detailRows(options.trail ?? [], data);
  return result;
}

/** Our GSTR-1-sourced contribution per (box, table[, pos]) against AC `det.<table>` (spec §9.2 `detail`). */
function detailRows(
  trail: readonly TrailEntry[],
  data: unknown,
): NonNullable<CompareResult["detail"]> {
  const out: NonNullable<CompareResult["detail"]> = [];
  for (const e of trail) {
    if (e.source !== "GSTR1") continue;
    const row = AC_GSTR1_MAP.find((r) => r.box === e.box && r.table === e.ref);
    if (row === undefined) continue;
    const node = at(data, row.acPath);
    let portal: Record<string, string> | null;
    if (Array.isArray(node)) {
      const hit = (node as unknown[]).find((r) => isObj(r) && r["pos"] === e.pos);
      portal = acAmounts(hit);
    } else {
      portal = acAmounts(node);
    }
    const ours: Record<string, string> = {};
    for (const [k, v] of Object.entries(e.amounts)) ours[k] = v;
    out.push({
      box: e.box,
      acTable: e.ref,
      ...(e.pos === undefined ? {} : { pos: e.pos }),
      ours,
      portal,
    });
  }
  return out;
}
