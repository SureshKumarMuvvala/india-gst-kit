import { describe, expect, it } from "vitest";
import { gstr3bAutoCalcFixture, gstr3bAutoCalcFixtureText } from "@india-gst-kit/fixtures";
import { parseAutoCalcJson } from "../src/index.js";
import { AUTOCALC_SHAPE, type ShapeNode } from "../src/autocalc-shape.js";
import { codes, loadSource, validateAC } from "./helpers.js";

type Obj = Record<string, unknown>;
const clone = (): Obj => structuredClone(gstr3bAutoCalcFixture);
const at = (o: unknown, path: string): Obj => {
  let cur = o;
  for (const k of path.split(".")) cur = (cur as Obj)[k];
  return cur as Obj;
};
const both = (doc: unknown) => ({
  ajv: validateAC(doc),
  zod: parseAutoCalcJson(JSON.stringify(doc)).ok,
});

describe("AC shape transcription vs the AC file (spec §9.1, D-H9)", () => {
  const ac = loadSource("AC");
  const REF: Record<string, string> = {
    "#/definitions/txamt": "T",
    "#/definitions/nonzerotxamt": "P",
    "#/definitions/negtxamt": "N",
    "#/definitions/pos": "pos",
    "#/definitions/taxperiod": "tp",
    "#/definitions/r2btaxprd": "r2b",
    "#/definitions/date": "date",
    "#/definitions/gstin": "gstin",
    "#/definitions/ret_period": "rp",
  };
  /** An independent re-walk of the source (not the generator's code). */
  function walk(n: Obj): unknown {
    if (typeof n["$ref"] === "string") return REF[n["$ref"]];
    const props = n["properties"] as Record<string, Obj> | undefined;
    const bounds = n["minItems"] === undefined ? {} : { n: [n["minItems"], n["maxItems"] ?? null] };
    if (n["items"] !== undefined) return { a: walk(n["items"] as Obj), ...bounds };
    if (n["type"] === "array") {
      const rest: Obj = { ...n, type: "object" };
      Reflect.deleteProperty(rest, "minItems");
      Reflect.deleteProperty(rest, "maxItems");
      return { a: walk(rest), q: 1, ...bounds };
    }
    if (props !== undefined) {
      expect(n["additionalProperties"]).toBe(false);
      const p: Obj = {};
      for (const [k, v] of Object.entries(props)) p[k] = walk(v);
      const out: Obj = n["required"] === undefined ? { p } : { r: n["required"], p };
      if (Array.isArray(n["anyOf"])) out["o"] = (n["anyOf"] as Obj[]).map((alt) => alt["required"]);
      return out;
    }
    return "s";
  }

  it("every object path, required set and $ref of all three blocks matches AUTOCALC_SHAPE", () => {
    const root = (ac["properties"] as Record<string, Obj>)["r3bautopop"] as Obj;
    expect(AUTOCALC_SHAPE).toEqual(walk(root));
  });

  it("the three blocks differ in exactly 35 object/array paths (C5), e.g. osup_3_1b.det.ims_9b_cn_eb2b", () => {
    const blocks = (AUTOCALC_SHAPE as { p: Record<string, ShapeNode> }).p;
    const kinds = (n: ShapeNode, path: string, out: Map<string, string>) => {
      if (typeof n === "string") return out;
      if ("a" in n) {
        out.set(path, "array");
        const inner = n.a;
        if (typeof inner !== "string" && "p" in inner)
          for (const [k, v] of Object.entries(inner.p)) kinds(v, `${path}.${k}`, out);
        return out;
      }
      if (path !== "") out.set(path, "object");
      for (const [k, v] of Object.entries(n.p)) kinds(v, `${path}.${k}`, out);
      return out;
    };
    const s = ["liabitc", "liabitcr1", "liabitcr1a"].map((b) =>
      kinds(blocks[b] as ShapeNode, "", new Map()),
    );
    const all = new Set(s.flatMap((m) => [...m.keys()]));
    const differing = [...all].filter((k) => new Set(s.map((m) => m.get(k) ?? "-")).size > 1);
    expect(differing).toHaveLength(35);
    expect(s.map((m) => m.get(".sup_details.osup_3_1b.det.ims_9b_cn_eb2b"))).toEqual([
      "object",
      "array",
      "array",
    ]);
  });
});

describe("parseAutoCalcJson (spec §9.1)", () => {
  it("parses the fixture; Ajv(AC) agrees; money is 2-dp strings and dates ISO", () => {
    expect(validateAC(gstr3bAutoCalcFixture)).toBe(true);
    const r = parseAutoCalcJson(gstr3bAutoCalcFixtureText);
    expect(r.ok ? [] : r.issues).toEqual([]);
    if (!r.ok) return;
    expect(r.value.meta).toEqual({
      r1fildt: "2026-11-11",
      r2bgendt: "2026-11-14",
      r3bgendt: "2026-11-15",
    });
    expect(at(r.value.data, "liabitc.sup_details.osup_3_1a.subtotal")["txval"]).toBe("168300.00");
  });

  it("C5: a liabitcr1 ims_9b_cn_eb2b array parses; the same array in liabitc is a schema error (both per Ajv)", () => {
    const row = { txval: 1, iamt: 0, csamt: 0 };
    const ok = clone();
    at(ok, "r3bautopop.liabitcr1.sup_details.osup_3_1b")["det"] = {
      ims_9b_cn_eb2b: [{ ...row, camt: 0, samt: 0, form: "GSTR-1 Quarterly" }],
    };
    expect(both(ok)).toEqual({ ajv: true, zod: true });
    const bad = clone();
    at(bad, "r3bautopop.liabitc.sup_details.osup_3_1b")["det"] = { ims_9b_cn_eb2b: [row] };
    expect(both(bad)).toEqual({ ajv: false, zod: false });
  });

  it("money definitions: txamt signed, nonzerotxamt ≥ 0, negtxamt ≤ 0 — as Ajv", () => {
    const cases: [string, string, number, boolean][] = [
      ["liabitc.sup_details.osup_3_1a.subtotal", "txval", -5, true],
      ["liabitc.sup_details.osup_3_1a.subtotal", "txval", 10000000000000, false],
      ["liabitc.elgitc.itc4b2.subtotal", "iamt", -1, false],
      ["liabitc.elgitc.itc4b2.subtotal", "iamt", 1, true],
    ];
    for (const [path, key, v, ok] of cases) {
      const doc = clone();
      at(doc, `r3bautopop.${path}`)[key] = v;
      expect(both(doc), `${path}.${key}=${v}`).toEqual({ ajv: ok, zod: ok });
    }
    for (const [v, ok] of [
      [-1, true],
      [1, false],
    ] as const) {
      const doc = clone();
      at(doc, "r3bautopop.liabitc.sup_details.osup_3_1a")["det"] = {
        tbl11b_1_2_4: { txval: v, iamt: v, camt: v, samt: v, csamt: v },
      };
      expect(both(doc), `negtxamt ${v}`).toEqual({ ajv: ok, zod: ok });
    }
    const dp = clone();
    at(dp, "r3bautopop.liabitc.sup_details.osup_3_1c.subtotal")["txval"] = 1.005;
    expect(parseAutoCalcJson(JSON.stringify(dp)).ok).toBe(false);
  });

  it('AC #pos accepts 96, the empty string and even "AB" (unanchored pattern, C4); length > 2 is rejected — as Ajv', () => {
    for (const [pos, ok] of [
      ["96", true],
      ["", true],
      ["AB", true],
      ["270", false],
    ] as const) {
      const doc = clone();
      at(doc, "r3bautopop.liabitc.inter_sup")["osup_uin_3_2"] = {
        subtotal: [{ pos, txval: 1, iamt: 0 }],
      };
      expect(both(doc), pos).toEqual({ ajv: ok, zod: ok });
    }
  });

  it("anyOf: an ITC box needs det or det_q; 3.2 arrays need 1–40 rows — as Ajv", () => {
    const noDet = clone();
    Reflect.deleteProperty(at(noDet, "r3bautopop.liabitc.elgitc.itc4a3"), "det");
    expect(both(noDet)).toEqual({ ajv: false, zod: false });
    const emptyRows = clone();
    at(emptyRows, "r3bautopop.liabitc.inter_sup")["osup_uin_3_2"] = { subtotal: [] };
    expect(both(emptyRows)).toEqual({ ajv: false, zod: false });
    const many = clone();
    const rows = Array.from({ length: 41 }, () => ({ pos: "27", txval: 1, iamt: 0 }));
    at(many, "r3bautopop.liabitc.inter_sup")["osup_uin_3_2"] = { subtotal: rows };
    expect(both(many)).toEqual({ ajv: false, zod: false });
    at(many, "r3bautopop.liabitc.inter_sup")["osup_uin_3_2"] = { subtotal: rows.slice(0, 40) };
    expect(both(many)).toEqual({ ajv: true, zod: true });
  });

  it("taxperiod enum in det_q, as Ajv", () => {
    for (const [form, ok] of [
      ["IFF - October", true],
      ["GSTR-1/1A Quarterly", true],
      ["October", false],
    ] as const) {
      const doc = clone();
      at(doc, "r3bautopop.liabitc.sup_details.osup_3_1c")["det_q"] = { tbl8: [{ form, txval: 1 }] };
      expect(both(doc), form).toEqual({ ajv: ok, zod: ok });
    }
  });

  it("C15: a `type: array` node with properties (3.2 det.tbl15b2c) takes an array of rows; an object is rejected by both", () => {
    const rows = clone();
    at(rows, "r3bautopop.liabitc.inter_sup.osup_unreg_3_2")["det"] = {
      tbl15b2c: [{ pos: "27", txval: 1, iamt: 0 }],
    };
    expect(both(rows)).toEqual({ ajv: true, zod: true });
    const obj = clone();
    at(obj, "r3bautopop.liabitc.inter_sup.osup_unreg_3_2")["det"] = {
      tbl15b2c: { pos: "27", txval: 1, iamt: 0 },
    };
    expect(both(obj)).toEqual({ ajv: false, zod: false });
  });

  it("dates: 29-02-2024 is accepted; 31-04-2026 is rejected (a calendar check stricter than AC's pattern)", () => {
    const leap = clone();
    at(leap, "r3bautopop")["r1afildt"] = "29-02-2024";
    expect(both(leap)).toEqual({ ajv: true, zod: true });
    const bad = clone();
    at(bad, "r3bautopop")["r1afildt"] = "31-04-2026";
    expect(both(bad)).toEqual({ ajv: true, zod: false });
  });

  it("unknown keys are dropped with UNEXPECTED_KEY warnings; error[] gives PORTAL_ERRORS; both still parse", () => {
    const doc = clone();
    at(doc, "r3bautopop.liabitc.sup_details.osup_3_1a.subtotal")["extra"] = 1;
    at(doc, "r3bautopop")["error"] = [{ error_cd: "RT-3BAC-1", error_desc: "synthetic" }];
    const r = parseAutoCalcJson(JSON.stringify(doc));
    expect(r.ok).toBe(true);
    expect(codes(r.issues)).toEqual(["UNEXPECTED_KEY", "PORTAL_ERRORS"]);
    if (r.ok) expect(r.value.errors).toEqual([{ error_cd: "RT-3BAC-1", error_desc: "synthetic" }]);
  });

  it("a string where AC has a number is WRONG_TYPE; bad JSON is SCHEMA; never throws", () => {
    const doc = clone();
    at(doc, "r3bautopop.liabitc.sup_details.osup_3_1c.subtotal")["txval"] = "1.00";
    const r = parseAutoCalcJson(JSON.stringify(doc));
    expect(r.ok ? [] : codes(r.issues)).toEqual(["WRONG_TYPE"]);
    const j = parseAutoCalcJson("{");
    expect(j.ok ? [] : codes(j.issues)).toEqual(["SCHEMA"]);
  });
});
