import { describe, expect, it } from "vitest";
import { GSTINS } from "@india-gst-kit/fixtures";
import {
  SavePayloadSchema,
  outwardFromGstr1,
  parseSavePayloadJson,
  serializeGstr3b,
  toSavePayload,
  type Gstr3bReturn,
  type SavePayload,
} from "../src/index.js";
import { writeJson } from "../src/numbers.js";
import { emptyFor } from "./schema-helpers.js";
import { codes, draftOf, gstr1, loadSource, validateSV } from "./helpers.js";

function render(ret: Gstr3bReturn): SavePayload {
  const r = toSavePayload(ret);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

/** A return touching every box, built through assembly (so it is consistent). */
function fullReturn(): Gstr3bReturn {
  const o = outwardFromGstr1(gstr1(), {
    recipientTypes: { [GSTINS.compositionDl]: "COMPOSITION", [GSTINS.recipientMh]: "UIN_HOLDER" },
  });
  if (!o.ok) throw new Error("derivation failed");
  const h4 = (i: string) => ({ igst: i, cgst: "1.00", sgst: "1.00", cess: "0.50" });
  return draftOf({
    outward: o.value,
    entries: [
      { box: "3.1c", label: "nil/exempt per books", amounts: { taxableValue: "700.00" } },
      {
        box: "3.1d",
        label: "RCM inward",
        amounts: {
          taxableValue: "1000.00",
          igst: "0.00",
          cgst: "90.00",
          sgst: "90.00",
          cess: "0.00",
        },
      },
      { box: "3.1e", label: "non-GST", amounts: { taxableValue: "250.00" } },
      {
        box: "3.1.1i",
        label: "9(5) supplies",
        amounts: { taxableValue: "10.00", igst: "1.80", cgst: "0.00", sgst: "0.00", cess: "0.00" },
      },
      { box: "3.1.1ii", label: "via ECO", amounts: { taxableValue: "20.00" } },
      { box: "4A.IMPG", label: "BoE", amounts: h4("100.00") },
      { box: "4A.IMPS", label: "imports of services", amounts: h4("10.00") },
      { box: "4A.ISRC", label: "RCM ITC", amounts: h4("0.00") },
      { box: "4A.ISD", label: "ISD", amounts: h4("5.00") },
      { box: "4A.OTH", label: "2B, CA-approved", amounts: h4("300.00") },
      { box: "4B.RUL", label: "CA working", amounts: h4("2.00") },
      { box: "4B.OTH", label: "CA working", amounts: h4("3.00") },
      { box: "4D.RUL", label: "CA working", amounts: h4("4.00") },
      {
        box: "4D.OTH",
        label: "CA working",
        amounts: { igst: "-1.00", cgst: "0.00", sgst: "0.00", cess: "0.00" },
      },
      { box: "5.GST", label: "exempt inward", amounts: { inter: "11.00", intra: "12.00" } },
      { box: "5.NONGST", label: "non-GST inward", amounts: { inter: "13.00", intra: "14.00" } },
      { box: "5.1", label: "interest per CA", amounts: h4("0.00") },
    ],
    itcNet: "COMPUTE",
  }).return;
}

describe("toSavePayload (spec §8, D-H3)", () => {
  it("renders an empty return to the exact expected JSON text: key order, all fixed rows, zeros, empty 3.2 arrays", () => {
    const text = serializeGstr3b(render(emptyFor()));
    const z5 = '"txval":0.00,"iamt":0.00,"camt":0.00,"samt":0.00,"csamt":0.00';
    const avl = (ty: string) => `{"camt":0.00,"samt":0.00,"csamt":0.00,"iamt":0.00,"ty":"${ty}"}`;
    const rev = (ty: string) => `{"camt":0.00,"csamt":0.00,"iamt":0.00,"samt":0.00,"ty":"${ty}"}`;
    const inelg = (ty: string) => `{"ty":"${ty}","camt":0.00,"csamt":0.00,"iamt":0.00,"samt":0.00}`;
    expect(text).toBe(
      `{"gstin":"${GSTINS.supplierKa}","ret_period":"102026",` +
        `"sup_details":{"osup_det":{${z5}},"osup_zero":{"txval":0.00,"iamt":0.00,"csamt":0.00},"osup_nil_exmp":{"txval":0.00},"isup_rev":{${z5}},"osup_nongst":{"txval":0.00}},` +
        `"inter_sup":{"comp_details":[],"uin_details":[],"unreg_details":[]},` +
        `"eco_dtls":{"eco_sup":{${z5}},"eco_reg_sup":{"txval":0.00}},` +
        `"itc_elg":{"itc_avl":[${["IMPG", "IMPS", "ISRC", "ISD", "OTH"].map(avl).join(",")}],"itc_rev":[${rev("RUL")},${rev("OTH")}],` +
        `"itc_net":{"camt":0.00,"csamt":0.00,"iamt":0.00,"samt":0.00},"itc_inelg":[${inelg("RUL")},${inelg("OTH")}]},` +
        `"inward_sup":{"isup_details":[{"inter":0.00,"intra":0.00,"ty":"GST"},{"inter":0.00,"intra":0.00,"ty":"NONGST"}]},` +
        `"intr_ltfee":{"intr_details":{"camt":0.00,"csamt":0.00,"iamt":0.00,"samt":0.00}}}`,
    );
  });

  it("maps each box to its SV place (full return)", () => {
    const ret = fullReturn();
    const p = render(ret);
    expect(p.sup_details?.osup_det).toEqual({
      txval: ret.t31.a.taxableValue,
      iamt: ret.t31.a.igst,
      camt: ret.t31.a.cgst,
      samt: ret.t31.a.sgst,
      csamt: ret.t31.a.cess,
    });
    expect(p.sup_details?.isup_rev?.camt).toBe("90.00");
    expect(p.inter_sup?.comp_details).toEqual([{ iamt: "360.00", pos: "07", txval: "2000.00" }]);
    expect(p.inter_sup?.uin_details?.map((r) => r.pos)).toEqual(["27"]);
    expect(p.itc_elg?.itc_avl?.map((r) => [r.ty, r.iamt])).toEqual([
      ["IMPG", "100.00"],
      ["IMPS", "10.00"],
      ["ISRC", "0.00"],
      ["ISD", "5.00"],
      ["OTH", "300.00"],
    ]);
    expect(p.itc_elg?.itc_net).toEqual({
      camt: "3.00",
      csamt: "1.50",
      iamt: "410.00",
      samt: "3.00",
    });
    expect(p.itc_elg?.itc_inelg?.[1]).toEqual({
      ty: "OTH",
      camt: "0.00",
      csamt: "0.00",
      iamt: "-1.00",
      samt: "0.00",
    });
    expect(p.inward_sup?.isup_details).toEqual([
      { inter: "11.00", intra: "12.00", ty: "GST" },
      { inter: "13.00", intra: "14.00", ty: "NONGST" },
    ]);
  });

  it("refuses a return with errors (no payload)", () => {
    const r = toSavePayload({ ...emptyFor(), period: "132026" });
    expect(r.ok ? [] : codes(r.issues)).toEqual(["PERIOD_FORMAT"]);
  });
});

describe("conformance with the SV file (Ajv, spec §8)", () => {
  it("Ajv compiled from the SV file accepts every rendered payload", () => {
    for (const ret of [emptyFor(), fullReturn()]) {
      const data: unknown = JSON.parse(serializeGstr3b(render(ret)));
      expect(validateSV(data), JSON.stringify(validateSV.errors)).toBe(true);
    }
  });

  // ---- leaf probe: every SV leaf, boundary values, Ajv(SV) vs SavePayloadSchema ----
  type Leaf = {
    path: (string | number)[];
    kind: "number" | "string";
    def: Record<string, unknown>;
  };
  const sv = loadSource("SV");
  const defs = sv["definitions"] as Record<string, Record<string, unknown>>;
  const resolve = (n: Record<string, unknown>) =>
    typeof n["$ref"] === "string" ? (defs[n["$ref"].replace("#/definitions/", "")] ?? {}) : n;

  /** Leaves of SV, with array index chosen so the path exists in the full payload. */
  function leaves(
    node: Record<string, unknown>,
    path: (string | number)[],
    out: Leaf[],
    index: (p: (string | number)[]) => number[],
  ): Leaf[] {
    const n = resolve(node);
    if (n["type"] === "array" || n["items"] !== undefined) {
      for (const i of index(path))
        leaves(n["items"] as Record<string, unknown>, [...path, i], out, index);
      return out;
    }
    const props = n["properties"] as Record<string, Record<string, unknown>> | undefined;
    const oneOf = n["oneOf"] as Record<string, unknown>[] | undefined;
    if (props !== undefined || oneOf !== undefined) {
      const merged: Record<string, Record<string, unknown>> = { ...(props ?? {}) };
      if (oneOf !== undefined) {
        // itc_inelg: branch by the row's ty (row 0 = RUL, row 1 = OTH in our order)
        const ty = path[path.length - 1] === 0 ? "RUL" : "OTH";
        const branch = oneOf.find((b) =>
          ((b["properties"] as Record<string, { enum?: string[] }>)["ty"]?.enum ?? []).includes(ty),
        );
        Object.assign(
          merged,
          (branch?.["properties"] as Record<string, Record<string, unknown>> | undefined) ?? {},
        );
      }
      for (const [k, v] of Object.entries(merged)) leaves(v, [...path, k], out, index);
      return out;
    }
    out.push({
      path,
      kind: resolve(node)["type"] === "number" ? "number" : "string",
      def: resolve(node),
    });
    return out;
  }
  const base = render(fullReturn());
  const allLeaves = leaves(sv, [], [], (p) => {
    let cur: unknown = base;
    for (const k of p) cur = (cur as Record<string | number, unknown>)[k];
    return Array.isArray(cur) ? cur.map((_, i) => i) : [];
  });

  function candidates(l: Leaf): string[] {
    if (l.kind === "number") {
      return [
        "0",
        "0.00",
        "-0.01",
        "1.5",
        "0.001",
        "123.45",
        "9999999999999.99",
        "10000000000000.00",
        "-9999999999999.99",
        "-10000000000000.00",
      ];
    }
    const last = l.path[l.path.length - 1];
    if (last === "gstin")
      return [
        GSTINS.supplierKa,
        GSTINS.supplierKa.toLowerCase(),
        GSTINS.notPanStructuredKa,
        "29AAAAA0000A1Z",
        "X",
      ];
    if (last === "ret_period") return ["102026", "132026", "001999", "122099", "10202", "1020266"];
    if (last === "pos") return ["27", "97", "96", "99", "25", "28", "00", "7", "270"];
    if (last === "ty")
      return ["IMPG", "IMPS", "ISRC", "ISD", "OTH", "RUL", "GST", "NONGST", "impg", "X"];
    throw new Error(`no candidates for ${l.path.join(".")}`);
  }
  function setAt(obj: unknown, path: (string | number)[], v: unknown): void {
    let cur = obj as Record<string | number, unknown>;
    for (const k of path.slice(0, -1)) cur = cur[k] as Record<string | number, unknown>;
    cur[path[path.length - 1] as string | number] = v;
  }

  it("finds every SV leaf (number and string) in the full payload", () => {
    expect(allLeaves.length).toBeGreaterThan(80);
    expect(
      allLeaves.filter((l) => l.kind === "string").map((l) => l.path[l.path.length - 1]),
    ).toEqual(expect.arrayContaining(["gstin", "ret_period", "pos", "ty"]));
  });

  it("accepts and rejects the same boundary values as Ajv(SV) at every leaf", () => {
    const mismatches: string[] = [];
    for (const l of allLeaves) {
      // itc_inelg ty switches the oneOf branch; probed separately below.
      if (l.path[1] === "itc_inelg" && l.path[l.path.length - 1] === "ty") continue;
      for (const c of candidates(l)) {
        const obj = structuredClone(base) as unknown;
        setAt(obj, l.path, c);
        const text = writeJson(obj, SavePayloadSchema);
        const ajvOk = validateSV(JSON.parse(text));
        const zodOk = parseSavePayloadJson(text).ok;
        if (ajvOk !== zodOk)
          mismatches.push(`${l.path.join(".")} = ${c}: Ajv ${ajvOk}, Zod ${zodOk}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("itc_inelg oneOf: RUL amounts must be ≥ 0, OTH amounts may be negative; ty must be RUL or OTH", () => {
    for (const [i, ty, v, ok] of [
      [0, "RUL", "-1.00", false],
      [0, "RUL", "1.00", true],
      [1, "OTH", "-1.00", true],
      [1, "XYZ", "1.00", false],
    ] as const) {
      const obj = structuredClone(base) as unknown;
      setAt(obj, ["itc_elg", "itc_inelg", i, "ty"], ty);
      setAt(obj, ["itc_elg", "itc_inelg", i, "camt"], v);
      const text = writeJson(obj, SavePayloadSchema);
      expect(validateSV(JSON.parse(text)), `${ty} ${v}`).toBe(ok);
      expect(parseSavePayloadJson(text).ok, `${ty} ${v}`).toBe(ok);
    }
  });

  it("required keys: deleting each one is rejected by both; deleting an optional section is accepted by both", () => {
    const cases: [(string | number)[], boolean][] = [
      [["gstin"], false],
      [["ret_period"], false],
      [["sup_details", "osup_det", "txval"], false],
      [["inter_sup", "comp_details", 0, "pos"], false],
      [["itc_elg", "itc_avl", 0, "ty"], false],
      [["inward_sup", "isup_details"], false],
      [["intr_ltfee", "intr_details"], false],
      [["sup_details"], true],
      [["eco_dtls"], true],
      [["itc_elg", "itc_net"], true],
    ];
    for (const [path, ok] of cases) {
      const obj = structuredClone(base) as Record<string, unknown>;
      let cur = obj as Record<string | number, unknown>;
      for (const k of path.slice(0, -1)) cur = cur[k] as Record<string | number, unknown>;
      Reflect.deleteProperty(cur, path[path.length - 1] as string | number);
      const text = writeJson(obj, SavePayloadSchema);
      expect(validateSV(JSON.parse(text)), path.join(".")).toBe(ok);
      expect(parseSavePayloadJson(text).ok, path.join(".")).toBe(ok);
    }
  });

  it("the one documented difference: unknown keys are rejected by us, accepted by SV outside inter_sup/itc_net (C3)", () => {
    const obj = structuredClone(base) as Record<string, unknown>;
    (obj["sup_details"] as Record<string, unknown>)["extra"] = 1;
    const text = writeJson(obj, SavePayloadSchema);
    expect(validateSV(JSON.parse(text))).toBe(true);
    expect(parseSavePayloadJson(text).ok).toBe(false);
    const inter = structuredClone(base) as Record<string, unknown>;
    (inter["inter_sup"] as Record<string, unknown>)["extra"] = [];
    expect(validateSV(JSON.parse(writeJson(inter, SavePayloadSchema)))).toBe(false);
  });
});

describe("lossless JSON (spec §2)", () => {
  it("9999999999999.99 and -0.01 survive serialise → parse unchanged", () => {
    const r = emptyFor();
    r.t31.a.taxableValue = "9999999999999.99";
    r.t31.a.igst = "-0.01";
    r.t31.a.cgst = "0.01";
    r.t31.a.sgst = "0.01";
    r.t4.net = { igst: "-0.01", cgst: "0.01", sgst: "0.01", cess: "0.00" };
    const text = serializeGstr3b(render(r));
    expect(text).toContain('"txval":9999999999999.99,"iamt":-0.01');
    const back = parseSavePayloadJson(text);
    expect(back.ok && back.value.sup_details?.osup_det).toEqual({
      txval: "9999999999999.99",
      iamt: "-0.01",
      camt: "0.01",
      samt: "0.01",
      csamt: "0.00",
    });
  });

  it("1180 parses to 1180.00; 1e3, a string amount and 10.005 are errors", () => {
    const text = serializeGstr3b(render(emptyFor()));
    const ok = parseSavePayloadJson(
      text.replace('"osup_nil_exmp":{"txval":0.00}', '"osup_nil_exmp":{"txval":1180}'),
    );
    expect(ok.ok && ok.value.sup_details?.osup_nil_exmp?.txval).toBe("1180.00");
    for (const bad of ["1e3", '"10.00"', "10.005"]) {
      const r = parseSavePayloadJson(
        text.replace('"osup_nil_exmp":{"txval":0.00}', `"osup_nil_exmp":{"txval":${bad}}`),
      );
      expect(r.ok, bad).toBe(false);
    }
    const s = parseSavePayloadJson(
      text.replace('"osup_nil_exmp":{"txval":0.00}', '"osup_nil_exmp":{"txval":"10.00"}'),
    );
    expect(s.ok ? [] : codes(s.issues)).toEqual(["WRONG_TYPE"]);
    const g = parseSavePayloadJson(text.replace(`"gstin":"${GSTINS.supplierKa}"`, '"gstin":29'));
    expect(g.ok ? [] : codes(g.issues)).toEqual(["WRONG_TYPE"]);
  });

  it("invalid JSON is a SCHEMA issue, not a throw", () => {
    expect(codes(parseSavePayloadJson("{").issues)).toEqual(["SCHEMA"]);
  });
});
