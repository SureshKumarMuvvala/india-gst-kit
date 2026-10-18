import { zodPath } from "@india-gst-kit/model";
import { BOX_FIELDS, POS_BOXES, boxObject, isPosBox, posList } from "./boxes.js";
import { D, type Dec } from "./decimal.js";
import { codeOf } from "./primitives.js";
import {
  Gstr3bReturnSchema,
  type AmountKey,
  type Gstr3bReturn,
  type TrailEntry,
} from "./return-schema.js";
import { BOX_IDS, issue, type BoxId, type Gstr3bIssue } from "./types.js";

const HEADS = ["igst", "cgst", "sgst", "cess"] as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The amounts recorded by a trail, per box, POS and field (spec §3.3). */
export function sumTrail(trail: readonly TrailEntry[]): Map<string, Dec> {
  const out = new Map<string, Dec>();
  for (const e of trail) {
    for (const [field, v] of Object.entries(e.amounts)) {
      const k = trailKey(e.box, e.pos, field as AmountKey);
      out.set(k, (out.get(k) ?? new D(0)).plus(v));
    }
  }
  return out;
}
export function trailKey(box: BoxId, pos: string | undefined, field: AmountKey): string {
  return `${box}|${pos ?? ""}|${field}`;
}

/**
 * Checks a return, or a draft (return + trail), against spec §7 (V1–V11). Never throws on data problems.
 * Errors: V1–V7, V9 (labels are checked at assembly), V10 (rendering). Warnings: V8, V11.
 */
export function validateGstr3b(input: unknown): Gstr3bIssue[] {
  const isDraft = isObj(input) && "trail" in input && "return" in input;
  const ret: unknown = isDraft ? input["return"] : input;
  const issues: Gstr3bIssue[] = [];
  const r = Gstr3bReturnSchema.safeParse(ret);
  if (!r.success) {
    for (const zi of r.error.issues) {
      const path = zodPath(zi.path);
      const code = codeOf(zi) ?? "SCHEMA";
      issues.push(issue(code, zi.message, { path }));
    }
    return issues;
  }
  const value = r.data;
  issues.push(...duplicatePos(value), ...itcNetCheck(value), ...t32Check(value));
  if (isDraft && Array.isArray(input["trail"])) {
    issues.push(...trailCheck(value, input["trail"] as TrailEntry[]));
  }
  return issues;
}

/** V7: one row per POS in each 3.2 list. */
function duplicatePos(ret: Gstr3bReturn): Gstr3bIssue[] {
  const out: Gstr3bIssue[] = [];
  for (const box of POS_BOXES) {
    const seen = new Set<string>();
    for (const row of posList(ret, box)) {
      if (seen.has(row.pos))
        out.push(
          issue("DUPLICATE_POS", `${box}: POS ${row.pos} appears twice`, { box, pos: row.pos }),
        );
      seen.add(row.pos);
    }
  }
  return out;
}

/** V8: 4C vs 4A − 4B per head (FG-3B "Net ITC Available (A) – (B)"); a warning (D-H7). */
function itcNetCheck(ret: Gstr3bReturn): Gstr3bIssue[] {
  const out: Gstr3bIssue[] = [];
  const net = computeItcNet(ret);
  for (const h of HEADS) {
    if (!new D(ret.t4.net[h]).eq(net[h])) {
      out.push(
        issue("ITC_NET_DIFFERS", `4C ${h} is ${ret.t4.net[h]}; Σ4A − Σ4B is ${net[h]}`, {
          box: "4C",
        }),
      );
    }
  }
  return out;
}

/** Σ4A − Σ4B per head, as 2-dp strings. */
export function computeItcNet(ret: Gstr3bReturn): Record<(typeof HEADS)[number], string> {
  const { available: a, reversed: b } = ret.t4;
  const out = { igst: "0.00", cgst: "0.00", sgst: "0.00", cess: "0.00" };
  for (const h of HEADS) {
    const v = new D(a.IMPG[h])
      .plus(a.IMPS[h])
      .plus(a.ISRC[h])
      .plus(a.ISD[h])
      .plus(a.OTH[h])
      .minus(b.RUL[h])
      .minus(b.OTH[h]);
    out[h] = v.isZero() ? "0.00" : v.toFixed(2);
  }
  return out;
}

/** V11: 3.2 is "of the supplies shown in 3.1 (a)" (FG-3B); a warning. */
function t32Check(ret: Gstr3bReturn): Gstr3bIssue[] {
  const out: Gstr3bIssue[] = [];
  for (const field of ["taxableValue", "igst"] as const) {
    let sum = new D(0);
    for (const box of POS_BOXES) for (const row of posList(ret, box)) sum = sum.plus(row[field]);
    if (sum.gt(ret.t31.a[field])) {
      out.push(
        issue(
          "T32_EXCEEDS_31A",
          `Σ3.2 ${field} ${sum.toFixed(2)} exceeds 3.1(a) ${ret.t31.a[field]}`,
          {
            box: "3.1a",
          },
        ),
      );
    }
  }
  return out;
}

/** V1: every box, field and 3.2 POS equals the sum of its trail entries. */
function trailCheck(ret: Gstr3bReturn, trail: readonly TrailEntry[]): Gstr3bIssue[] {
  const sums = sumTrail(trail);
  const out: Gstr3bIssue[] = [];
  const expect = (box: BoxId, pos: string | undefined, field: AmountKey, actual: string) => {
    const want = sums.get(trailKey(box, pos, field)) ?? new D(0);
    if (!want.eq(actual)) {
      out.push(
        issue(
          "TRAIL_MISMATCH",
          `${box}${pos === undefined ? "" : ` POS ${pos}`} ${field}: ${actual} ≠ Σ trail ${want.toFixed(2)}`,
          {
            box,
            ...(pos === undefined ? {} : { pos }),
          },
        ),
      );
    }
  };
  for (const box of BOX_IDS) {
    if (isPosBox(box)) {
      const poses = new Set<string>(posList(ret, box).map((r) => r.pos));
      for (const e of trail) if (e.box === box && e.pos !== undefined) poses.add(e.pos);
      for (const pos of [...poses].sort()) {
        const row = posList(ret, box).find((r) => r.pos === pos);
        for (const f of BOX_FIELDS[box])
          expect(box, pos, f, row?.[f as "taxableValue" | "igst"] ?? "0.00");
      }
    } else {
      const obj = boxObject(ret, box);
      for (const f of BOX_FIELDS[box]) expect(box, undefined, f, obj[f] ?? "0.00");
    }
  }
  return out;
}
