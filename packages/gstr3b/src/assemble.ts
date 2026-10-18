// Source: spec §6 and D-H2 (trail), D-H7 (4C = 4A − 4B on request; FORM GSTR-3B 4(C) "Net ITC Available (A) – (B)",
//         sources/gstr3b/form-gstr3b-excerpt-18052021.txt)
// Retrieved: 2026-10-18
// Status: UNVERIFIED — needs CA
import { z } from "zod";
import { zodPath } from "@india-gst-kit/model";
import { BOX_FIELDS, boxObject, emptyReturn, isPosBox, posList } from "./boxes.js";
import { D, type Dec } from "./decimal.js";
import { Gstr2bTotalsSchema } from "./gstr2b.js";
import { OutwardDerivationSchema } from "./outward.js";
import { Signed3bSchema, codeOf } from "./primitives.js";
import {
  AmountsSchema,
  type AmountKey,
  type Gstr3bDraft,
  type Gstr3bReturn,
  type TrailEntry,
} from "./return-schema.js";
import { BOX_IDS, hasErrors, issue, type BoxId, type Gstr3bIssue } from "./types.js";
import { computeItcNet, sumTrail, trailKey, validateGstr3b } from "./validate.js";

/** Boxes a caller entry may fill: every box but 4C, which comes from `itcNet` (D-H7). */
export const CallerBoxSchema = z.enum(
  BOX_IDS.filter((b) => b !== "4C") as [Exclude<BoxId, "4C">, ...Exclude<BoxId, "4C">[]],
);
export const CallerEntrySchema = z.strictObject({
  box: CallerBoxSchema,
  label: z.string(),
  pos: z.string().optional(),
  amounts: AmountsSchema,
});
export type CallerEntry = z.infer<typeof CallerEntrySchema>;

export const Gstr2bBoxSchema = z.enum([
  "4A.IMPG",
  "4A.IMPS",
  "4A.ISRC",
  "4A.ISD",
  "4A.OTH",
  "3.1d",
]);
export const AssembleInputSchema = z.strictObject({
  gstin: z.string(),
  period: z.string(),
  outward: OutwardDerivationSchema.optional(),
  entries: z.array(CallerEntrySchema).optional(),
  fromGstr2b: z
    .array(
      z.strictObject({
        box: Gstr2bBoxSchema,
        sign: z.enum(["+", "-"]),
        totals: Gstr2bTotalsSchema,
        groupIndexes: z.array(z.number().int().nonnegative()),
      }),
    )
    .optional(),
  itcNet: z
    .union([
      z.literal("COMPUTE"),
      z.strictObject({
        label: z.string(),
        amounts: z.strictObject({
          igst: Signed3bSchema,
          cgst: Signed3bSchema,
          sgst: Signed3bSchema,
          cess: Signed3bSchema,
        }),
      }),
    ])
    .optional(),
});
export type AssembleInput = z.infer<typeof AssembleInputSchema>;

export type AssembleResult =
  { ok: true; value: Gstr3bDraft; issues: Gstr3bIssue[] } | { ok: false; issues: Gstr3bIssue[] };

const fmt = (d: Dec) => (d.isZero() ? "0.00" : d.toFixed(2));

/** Builds the return from derived parts and caller inputs, with the provenance trail (spec §6). */
export function assembleGstr3b(input: AssembleInput): AssembleResult {
  const parsed = AssembleInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) =>
        issue(codeOf(i) ?? "SCHEMA", i.message, { path: zodPath(i.path) }),
      ),
    };
  }
  const inp = parsed.data;
  const issues: Gstr3bIssue[] = [];
  const trail: TrailEntry[] = [];

  if (inp.outward !== undefined) {
    if (inp.outward.gstin !== inp.gstin) {
      issues.push(issue("GSTR1_GSTIN_MISMATCH", `gstr1 GSTIN ${inp.outward.gstin} ≠ ${inp.gstin}`));
    }
    if (inp.outward.period !== inp.period) {
      issues.push(
        issue("GSTR1_PERIOD_MISMATCH", `gstr1 period ${inp.outward.period} ≠ ${inp.period}`),
      );
    }
    trail.push(...inp.outward.entries);
    issues.push(...inp.outward.unmapped.map((u) => u.issue));
  }

  (inp.entries ?? []).forEach((e, i) => {
    const path = ["entries", i];
    if (e.label.trim() === "")
      issues.push(
        issue("CALLER_LABEL_MISSING", `entry ${i} (${e.box}) has no label`, { box: e.box, path }),
      );
    for (const f of Object.keys(e.amounts) as AmountKey[]) {
      if (!BOX_FIELDS[e.box].includes(f)) {
        issues.push(
          issue("FIELD_NOT_IN_BOX", `${e.box} has no field ${f}`, {
            box: e.box,
            path: [...path, "amounts", f],
          }),
        );
      }
    }
    if (isPosBox(e.box) !== (e.pos !== undefined)) {
      issues.push(
        issue(
          "SCHEMA",
          isPosBox(e.box) ? `${e.box} entries need a pos` : `${e.box} entries take no pos`,
          { box: e.box, path },
        ),
      );
    }
    const t: TrailEntry = { box: e.box, source: "CALLER", ref: e.label, amounts: e.amounts };
    if (e.pos !== undefined) t.pos = e.pos;
    trail.push(t);
  });

  (inp.fromGstr2b ?? []).forEach((s, i) => {
    const sign = s.sign === "-" ? -1 : 1;
    for (const gi of s.groupIndexes) {
      const g = s.totals.groups[gi];
      if (g === undefined) {
        issues.push(
          issue("SCHEMA", `fromGstr2b[${i}]: no group ${gi}`, {
            box: s.box,
            path: ["fromGstr2b", i, "groupIndexes"],
          }),
        );
        continue;
      }
      const amounts: Partial<Record<AmountKey, string>> = {};
      for (const f of BOX_FIELDS[s.box]) {
        const v = g.totals[f as "taxableValue" | "igst" | "cgst" | "sgst" | "cess"];
        amounts[f] = fmt(new D(v).times(sign));
      }
      const k = g.key;
      trail.push({
        box: s.box,
        source: "GSTR2B_SUM",
        ref: `${s.totals.label} #${gi} ${k.documentType}/itcavl=${k.itcavl}/rev=${k.reverseCharge}/${k.origin}/${k.returnPeriod} (${s.sign})`,
        amounts,
      });
    }
  });

  if (inp.itcNet !== undefined && inp.itcNet !== "COMPUTE") {
    if (inp.itcNet.label.trim() === "")
      issues.push(issue("CALLER_LABEL_MISSING", "itcNet has no label", { box: "4C" }));
    trail.push({
      box: "4C",
      source: "CALLER",
      ref: inp.itcNet.label,
      amounts: { ...inp.itcNet.amounts },
    });
  }

  // Structural errors in the inputs stop here: the sums would not mean anything.
  if (hasErrors(issues)) return { ok: false, issues };

  const ret = build(inp.gstin, inp.period, trail);
  if (inp.itcNet === "COMPUTE") {
    const net = computeItcNet(ret);
    trail.push({
      box: "4C",
      source: "COMPUTED",
      ref: "4C = Σ4A − Σ4B (FG-3B 4(C); D-H7)",
      amounts: { ...net },
    });
    ret.t4.net = net;
  }
  const draft: Gstr3bDraft = { return: ret, trail };
  issues.push(...validateGstr3b(draft));
  if (hasErrors(issues)) return { ok: false, issues };
  return { ok: true, value: draft, issues };
}

/** Sums the trail into a return; 3.2 rows aggregated per POS, sorted, zero rows dropped. */
function build(gstin: string, period: string, trail: readonly TrailEntry[]): Gstr3bReturn {
  const ret = emptyReturn(gstin, period);
  const sums = sumTrail(trail);
  for (const box of BOX_IDS) {
    if (isPosBox(box)) {
      const poses = [
        ...new Set(
          trail.filter((e) => e.box === box && e.pos !== undefined).map((e) => e.pos ?? ""),
        ),
      ].sort();
      const list = posList(ret, box);
      for (const pos of poses) {
        const taxableValue = sums.get(trailKey(box, pos, "taxableValue")) ?? new D(0);
        const igst = sums.get(trailKey(box, pos, "igst")) ?? new D(0);
        if (taxableValue.isZero() && igst.isZero()) continue;
        list.push({ pos, taxableValue: fmt(taxableValue), igst: fmt(igst) });
      }
    } else {
      const obj = boxObject(ret, box);
      for (const f of BOX_FIELDS[box]) {
        const v = sums.get(trailKey(box, undefined, f));
        if (v !== undefined) obj[f] = fmt(v);
      }
    }
  }
  return ret;
}
