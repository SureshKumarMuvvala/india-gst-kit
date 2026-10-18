import { zodPath } from "@india-gst-kit/model";
import { convertWire, readJson, writeJson } from "./numbers.js";
import type { Gstr3bReturn, PosRow } from "./return-schema.js";
import { SavePayloadSchema, type SavePayload } from "./save-payload.js";
import { issue, type Gstr3bIssue, type RenderResult } from "./types.js";
import { validateGstr3b } from "./validate.js";

const rows = (xs: readonly PosRow[]) =>
  [...xs]
    .sort((a, b) => a.pos.localeCompare(b.pos))
    .map((r) => ({ iamt: r.igst, pos: r.pos, txval: r.taxableValue }));

type H4 = { igst: string; cgst: string; sgst: string; cess: string };
const avl = (ty: "IMPG" | "IMPS" | "ISRC" | "ISD" | "OTH", h: H4) => ({
  camt: h.cgst,
  samt: h.sgst,
  csamt: h.cess,
  iamt: h.igst,
  ty,
});
const rev = (ty: "RUL" | "OTH", h: H4) => ({
  camt: h.cgst,
  csamt: h.cess,
  iamt: h.igst,
  samt: h.sgst,
  ty,
});

/**
 * The SV v7.1 Save payload: every section and every fixed row, zeros where empty, SV key order (D-H3). The return is
 * validated first (§7) and the payload against SavePayloadSchema after (V10).
 */
export function toSavePayload(ret: Gstr3bReturn): RenderResult<SavePayload> {
  const errors = validateGstr3b(ret).filter((i) => i.severity === "error");
  if (errors.length > 0) return { ok: false, issues: errors };
  const { t31, t311, t32, t4, t5, t51 } = ret;
  const h5 = (h: {
    taxableValue: string;
    igst: string;
    cgst: string;
    sgst: string;
    cess: string;
  }) => ({
    txval: h.taxableValue,
    iamt: h.igst,
    camt: h.cgst,
    samt: h.sgst,
    csamt: h.cess,
  });
  const payload = {
    gstin: ret.gstin,
    ret_period: ret.period,
    sup_details: {
      osup_det: h5(t31.a),
      osup_zero: { txval: t31.b.taxableValue, iamt: t31.b.igst, csamt: t31.b.cess },
      osup_nil_exmp: { txval: t31.c.taxableValue },
      isup_rev: h5(t31.d),
      osup_nongst: { txval: t31.e.taxableValue },
    },
    inter_sup: {
      comp_details: rows(t32.composition),
      uin_details: rows(t32.uinHolders),
      unreg_details: rows(t32.unregistered),
    },
    eco_dtls: { eco_sup: h5(t311.i), eco_reg_sup: { txval: t311.ii.taxableValue } },
    itc_elg: {
      itc_avl: [
        avl("IMPG", t4.available.IMPG),
        avl("IMPS", t4.available.IMPS),
        avl("ISRC", t4.available.ISRC),
        avl("ISD", t4.available.ISD),
        avl("OTH", t4.available.OTH),
      ],
      itc_rev: [rev("RUL", t4.reversed.RUL), rev("OTH", t4.reversed.OTH)],
      itc_net: { camt: t4.net.cgst, csamt: t4.net.cess, iamt: t4.net.igst, samt: t4.net.sgst },
      itc_inelg: [
        {
          ty: "RUL" as const,
          camt: t4.ineligible.RUL.cgst,
          csamt: t4.ineligible.RUL.cess,
          iamt: t4.ineligible.RUL.igst,
          samt: t4.ineligible.RUL.sgst,
        },
        {
          ty: "OTH" as const,
          camt: t4.ineligible.OTH.cgst,
          csamt: t4.ineligible.OTH.cess,
          iamt: t4.ineligible.OTH.igst,
          samt: t4.ineligible.OTH.sgst,
        },
      ],
    },
    inward_sup: {
      isup_details: [
        { inter: t5.GST.inter, intra: t5.GST.intra, ty: "GST" as const },
        { inter: t5.NONGST.inter, intra: t5.NONGST.intra, ty: "NONGST" as const },
      ],
    },
    intr_ltfee: {
      intr_details: {
        camt: t51.interest.cgst,
        csamt: t51.interest.cess,
        iamt: t51.interest.igst,
        samt: t51.interest.sgst,
      },
    },
  };
  const r = SavePayloadSchema.safeParse(payload);
  if (!r.success) {
    return {
      ok: false,
      issues: r.error.issues.map((i) =>
        issue("SCHEMA", `own output fails SavePayloadSchema: ${i.message}`, {
          path: zodPath(i.path),
        }),
      ),
    };
  }
  return { ok: true, value: payload };
}

/** Compact JSON in SV key order; money written as raw 2-dp number literals (lossless, spec §2). */
export function serializeGstr3b(payload: SavePayload): string {
  return writeJson(payload, SavePayloadSchema);
}

export type ParseResult<T> =
  { ok: true; value: T; issues: Gstr3bIssue[] } | { ok: false; issues: Gstr3bIssue[] };

/** Lossless parse of a Save payload; numbers with more than 2 dp, exponents and wrong JSON types are errors. */
export function parseSavePayloadJson(text: string): ParseResult<SavePayload> {
  if (typeof text !== "string") throw new TypeError("parseSavePayloadJson: text must be a string");
  const j = readJson(text);
  if (!j.ok) return { ok: false, issues: [issue("SCHEMA", j.message)] };
  const wrong: (string | number)[][] = [];
  const converted = convertWire(j.value, SavePayloadSchema, wrong);
  const r = SavePayloadSchema.safeParse(converted);
  const issues = wrongTypeIssues(wrong);
  if (r.success && issues.length === 0) return { ok: true, value: r.data, issues: [] };
  if (!r.success) issues.push(...zodIssues(r.error.issues, wrong));
  return { ok: false, issues };
}

export function wrongTypeIssues(wrong: readonly (string | number)[][]): Gstr3bIssue[] {
  return wrong.map((p) =>
    issue("WRONG_TYPE", "wrong JSON type (number vs string)", { path: [...p] }),
  );
}

/** Zod issues as SCHEMA issues, leaving out those already reported as WRONG_TYPE. */
export function zodIssues(
  zi: readonly { path: readonly PropertyKey[]; message: string }[],
  wrong: readonly (string | number)[][],
): Gstr3bIssue[] {
  const seen = new Set(wrong.map((p) => JSON.stringify(p)));
  return zi
    .filter((i) => !seen.has(JSON.stringify(zodPath(i.path))))
    .map((i) => issue("SCHEMA", i.message, { path: zodPath(i.path) }));
}
