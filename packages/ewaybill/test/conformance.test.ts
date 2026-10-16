import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { pathStartsWith } from "@india-gst-kit/model";
import {
  EwbByIrnRequestSchema,
  EwbRequestSchema,
  validateEwbRequest,
  type EwbIssue,
} from "../src/index.js";
import { GSTINS, edit, mapped } from "./helpers.js";
import { source } from "./sources.js";

// Conformance: the Zod schemas against the published JSON schemas H (sources/ewaybill/generate-ewaybill-schema.json)
// and I (sources/ewaybill/ewb-by-irn-schema.json). Neither is read as plain JSON Schema (spec §7): the quirk
// normalisation below is applied to the *oracle*, and every leaf is probed differentially: the source's
// constraints, after the listed quirks, decide what must be accepted.

type Json = Record<string, unknown>;
type Path = (string | number)[];
interface Leaf {
  path: Path;
  type: "string" | "number" | "integer";
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: string[];
  minimum?: string;
  maximum?: string;
  multipleOf?: string;
}

// Numbers are kept as their source text (0.001 must not become a double).
const parse = (text: string): Json =>
  JSON.parse(text, (_k: string, v: unknown, ctx?: { source?: string }) =>
    typeof v === "number" ? { num: ctx?.source } : v,
  ) as Json;
const numText = (v: unknown): string | undefined => (v as { num?: string } | undefined)?.num;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function leafOf(path: Path, v: Json): Leaf {
  const leaf: Leaf = { path, type: v["type"] as Leaf["type"] };
  const set = <K extends keyof Leaf>(k: K, x: Leaf[K] | undefined) => {
    if (x !== undefined) leaf[k] = x;
  };
  set(
    "minLength",
    numText(v["minLength"]) === undefined ? undefined : Number(numText(v["minLength"])),
  );
  set(
    "maxLength",
    numText(v["maxLength"]) === undefined ? undefined : Number(numText(v["maxLength"])),
  );
  set("pattern", str(v["pattern"]));
  set("enum", Array.isArray(v["enum"]) ? (v["enum"] as string[]) : undefined);
  set("minimum", numText(v["minimum"]));
  set("maximum", numText(v["maximum"]));
  set("multipleOf", numText(v["multipleOf"]));
  return leaf;
}

function leavesOf(props: Json, prefix: Path): Leaf[] {
  const out: Leaf[] = [];
  for (const [key, raw] of Object.entries(props)) {
    const v = raw as Json;
    const path = [...prefix, key];
    if (v["type"] === "object") {
      out.push(...leavesOf(v["properties"] as Json, path));
    } else if (v["type"] === "array") {
      // Quirk: `items: [ {…} ]` (array form) is read as "every item".
      const item = (v["items"] as Json[])[0] as Json;
      out.push(...leavesOf(item["properties"] as Json, [...path, 0]));
    } else {
      out.push(leafOf(path, v));
    }
  }
  return out;
}

const H = parse(source("ewaybill/generate-ewaybill-schema.json"));
const I = parse(source("ewaybill/ewb-by-irn-schema.json"));
const H_PROPS = H["properties"] as Json;
// Quirk: I lists its properties at the top level, beside `$schema` and `required`.
const I_PROPS: Json = Object.fromEntries(
  Object.entries(I).filter(([k]) => k !== "$schema" && k !== "required"),
);
const H_LEAVES = leavesOf(H_PROPS, []);
const I_LEAVES = leavesOf(I_PROPS, []);

// ---- the oracle ------------------------------------------------------------------------------------
const key = (l: Leaf): string => l.path.filter((p) => typeof p === "string").join(".");

/** Quirk: character classes read without the literal `|`; the unanchored patterns are anchored. */
function regexOf(pattern: string): RegExp {
  const noBar = pattern.replace(
    /\[([^\]]*)\]/g,
    (_m, body: string) => `[${body.replace(/\|/g, "")}]`,
  );
  const start = noBar.startsWith("^") ? "" : "^";
  const end = noBar.endsWith("$") ? "" : "$";
  return new RegExp(`${start}${noBar}${end}`);
}

const D = Decimal.clone({ precision: 60 });
const INT = /^(0|[1-9]\d*)$/;
const DEC = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const whole = (s: string | undefined): boolean => s !== undefined && /^-?\d+$/.test(s);

function oracle(leaf: Leaf, v: string): boolean {
  if (leaf.type === "string") {
    // Quirk (H): fromGstin / toGstin also accept exactly "URP", overriding minLength 15.
    if (v === "URP" && (key(leaf) === "fromGstin" || key(leaf) === "toGstin")) return true;
    if (leaf.minLength !== undefined && v.length < leaf.minLength) return false;
    if (leaf.maxLength !== undefined && v.length > leaf.maxLength) return false;
    if (leaf.pattern !== undefined && !regexOf(leaf.pattern).test(v)) return false;
    if (leaf.enum !== undefined && !leaf.enum.includes(v)) return false;
    return true;
  }
  // Quirks: "integer" fields are non-negative; "number" fields with whole-number bounds (I: Distance, Pin)
  // are whole numbers, like source C (so "-0" and "-1" are out: their minimum is 0). Neither allows leading zeros, + or exponents (always writable JSON).
  const wholeNumber = leaf.type === "integer" || (whole(leaf.minimum) && whole(leaf.maximum));
  if (wholeNumber ? !INT.test(v) : !DEC.test(v)) {
    return false;
  }
  const n = new D(v);
  if (leaf.minimum !== undefined && n.lt(leaf.minimum)) return false;
  if (leaf.maximum !== undefined && n.gt(leaf.maximum)) return false;
  if (leaf.multipleOf !== undefined && !n.mod(leaf.multipleOf).isZero()) return false;
  return true;
}

function candidates(leaf: Leaf): string[] {
  const out = new Set<string>();
  if (leaf.type === "string") {
    const lens = [0, 1, 2, 3, 7, 14, 15, 16, 20, 21, 50, 51, 100, 101, 120, 121];
    for (const n of lens) {
      out.add("A".repeat(n));
      out.add("1".repeat(n));
    }
    for (const n of [leaf.minLength, leaf.maxLength]) {
      if (n === undefined) continue;
      for (const d of [-1, 0, 1])
        out.add("A".repeat(Math.max(0, n + d))).add("1".repeat(Math.max(0, n + d)));
    }
    for (const e of leaf.enum ?? []) out.add(e);
    for (const s of [
      "ZZZ",
      "O",
      "R",
      "I",
      "X",
      "o",
      "r",
      "1",
      "2",
      "3",
      "4",
      "5",
      "URP",
      "urp",
      GSTINS.supplierKa,
      GSTINS.supplierKa.toLowerCase(),
      `99${GSTINS.supplierKa.slice(2)}`,
      `${GSTINS.supplierKa.slice(0, 14)}|`,
      `${GSTINS.supplierKa.slice(0, 13)}|Y`,
      "15/12/2017",
      "15/12/2009",
      "15/12/2010",
      "15/12/2029",
      "15/12/2030",
      "32/12/2017",
      "15/13/2017",
      "x15/12/2017",
      "15/12/2017x",
      "15-12-2017",
      "AB|1234",
      "ab1234",
      "AB 1234",
      'a"b',
      "abc",
      "a\\b",
      "0",
      "00",
      "01",
      "10",
      "29",
      "99",
      "100",
      "TRAN/DOC/11",
      "01/08/2020",
      "0123456789",
    ]) {
      out.add(s);
    }
  } else {
    for (const s of [
      "0",
      "1",
      "2",
      "4",
      "5",
      "-1",
      "-0.5",
      "0.5",
      "0.01",
      "0.001",
      "0.0001",
      "12.345",
      "99",
      "100",
      "101",
      "999",
      "4000",
      "4001",
      "99999",
      "100000",
      "100001",
      "999999",
      "1000000",
      "5609889",
      "99999999999999.99",
      "1e3",
      "1E3",
      "+1",
      "01",
      "1.",
      ".5",
      "abc",
      "",
      " 1",
      "1 ",
      "0x10",
      "-0",
      "1.50",
      "10.00",
    ]) {
      out.add(s);
    }
    for (const b of [leaf.minimum, leaf.maximum]) {
      if (b === undefined) continue;
      for (const d of ["-1", "-0.001", "0", "0.001", "1"]) out.add(new D(b).plus(d).toFixed());
    }
  }
  return [...out];
}

// ---- the system under test -------------------------------------------------------------------------
const H_BASE = mapped("intraInvoice") as unknown as Json;
const I_BASE: Json = { Irn: "a".repeat(64), Distance: "100" };

const issuesAt = (
  schema: typeof EwbRequestSchema | typeof EwbByIrnRequestSchema,
  input: unknown,
  path: Path,
) => {
  const r = schema.safeParse(input);
  if (r.success) return [];
  return r.error.issues.filter((i) =>
    pathStartsWith(
      i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
      path,
    ),
  );
};

function probe(
  schema: typeof EwbRequestSchema | typeof EwbByIrnRequestSchema,
  base: Json,
  leaves: Leaf[],
) {
  const wrong: string[] = [];
  for (const leaf of leaves) {
    for (const v of candidates(leaf)) {
      const input = edit(base, [[leaf.path, v]]);
      const accepted = issuesAt(schema, input, leaf.path).length === 0;
      if (accepted !== oracle(leaf, v))
        wrong.push(`${key(leaf)} ${JSON.stringify(v)}: schema ${accepted}, source ${!accepted}`);
    }
  }
  return wrong;
}

describe("H: Generate E-way Bill schema", () => {
  it("has the source's properties in the source's order", () => {
    expect(Object.keys(EwbRequestSchema.shape)).toEqual(Object.keys(H_PROPS));
    const item = ((H_PROPS["itemList"] as Json)["items"] as Json[])[0] as Json;
    const itemShape = (EwbRequestSchema.shape.itemList.element as unknown as { shape: Json }).shape;
    expect(Object.keys(itemShape)).toEqual(Object.keys(item["properties"] as Json));
  });
  it("probes every leaf constraint against the source (lengths, patterns, enums, bounds, multipleOf)", () => {
    expect(H_LEAVES.length).toBe(50);
    expect(probe(EwbRequestSchema, H_BASE, H_LEAVES)).toEqual([]);
  });
  it("requires exactly the source's required properties", () => {
    const required = H["required"] as string[];
    expect(required).toHaveLength(17);
    for (const k of Object.keys(H_PROPS)) {
      const bare = edit(H_BASE, [[[k], undefined]]);
      const missing = issuesAt(EwbRequestSchema, bare, [k]).length > 0;
      expect(missing, k).toBe(required.includes(k));
    }
    for (const k of ((H_PROPS["itemList"] as Json)["items"] as Json[])[0]
      ? ["hsnCode", "taxableAmount", "productDesc", "quantity", "qtyUnit", "cgstRate"]
      : []) {
      const bare = edit(H_BASE, [[["itemList", 0, k], undefined]]);
      expect(issuesAt(EwbRequestSchema, bare, ["itemList", 0, k]).length > 0, k).toBe(
        k === "hsnCode" || k === "taxableAmount",
      );
    }
  });
});

describe("I: EWB by IRN schema", () => {
  it("has the source's properties in the source's order", () => {
    expect(Object.keys(EwbByIrnRequestSchema.shape)).toEqual(Object.keys(I_PROPS));
    for (const block of ["ExpShipDtls", "DispDtls"] as const) {
      const shape = (EwbByIrnRequestSchema.shape[block].unwrap() as unknown as { shape: Json })
        .shape;
      expect(Object.keys(shape)).toEqual(
        Object.keys((I_PROPS[block] as Json)["properties"] as Json),
      );
    }
  });
  it("probes every leaf constraint against the source", () => {
    expect(I_LEAVES.length).toBe(20);
    const base = {
      ...I_BASE,
      ExpShipDtls: { Addr1: "Port Road", Loc: "Chennai", Pin: "600001", Stcd: "33" },
      DispDtls: { Nm: "Depot", Addr1: "9 Road", Loc: "Hosur", Pin: "560002", Stcd: "29" },
    };
    // The base needs every optional top-level leaf present for the probe to replace it; replacing adds it anyway.
    expect(probe(EwbByIrnRequestSchema, base, I_LEAVES)).toEqual([]);
  });
  it("requires exactly the source's required properties, in the object blocks too", () => {
    expect(I["required"]).toEqual(["Distance"]);
    for (const k of Object.keys(I_PROPS).filter((x) => x !== "ExpShipDtls" && x !== "DispDtls")) {
      const bare = edit(I_BASE, [[[k], undefined]]);
      expect(issuesAt(EwbByIrnRequestSchema, bare, [k]).length > 0, k).toBe(k === "Distance");
    }
    for (const block of ["ExpShipDtls", "DispDtls"] as const) {
      const spec = I_PROPS[block] as Json;
      const required = spec["required"] as string[];
      const full = {
        Nm: "Depot",
        Addr1: "9 Road",
        Addr2: "Floor 2",
        Loc: "Hosur",
        Pin: "560002",
        Stcd: "29",
      };
      for (const k of Object.keys(spec["properties"] as Json)) {
        const input = {
          ...I_BASE,
          [block]: Object.fromEntries(
            Object.entries(full).filter(([x]) => x !== k && x in (spec["properties"] as Json)),
          ),
        };
        expect(issuesAt(EwbByIrnRequestSchema, input, [block, k]).length > 0, `${block}.${k}`).toBe(
          required.includes(k),
        );
      }
    }
  });
});

describe("the quirk list (spec §7), asserted explicitly", () => {
  const ok = (
    input: unknown,
    schema: typeof EwbRequestSchema | typeof EwbByIrnRequestSchema,
    path: Path,
  ) => issuesAt(schema, input, path).length === 0;
  const h = (edits: [Path, unknown][]) => edit(H_BASE, edits);

  it("H GSTINs: anchored, no literal `|`; URP only in fromGstin/toGstin and overriding minLength 15", () => {
    expect(ok(h([[["toGstin"], "URP"]]), EwbRequestSchema, ["toGstin"])).toBe(true);
    expect(ok(h([[["fromGstin"], "URP"]]), EwbRequestSchema, ["fromGstin"])).toBe(true);
    expect(ok(h([[["transporterId"], "URP"]]), EwbRequestSchema, ["transporterId"])).toBe(false);
    const g = GSTINS.recipientKa;
    for (const bad of [
      `${g.slice(0, 14)}|`,
      `${g.slice(0, 13)}|4`,
      `x${g}`,
      `${g}x`,
      "URPX",
      "UR",
    ]) {
      expect(ok(h([[["toGstin"], bad]]), EwbRequestSchema, ["toGstin"]), bad).toBe(false);
    }
    expect(
      ok(h([[["transporterId"], `${g.slice(0, 14)}|`]]), EwbRequestSchema, ["transporterId"]),
    ).toBe(false);
  });
  it("H docDate: anchored; the year part 20[1-2][0-9] stays (2030 is rejected)", () => {
    for (const good of ["15/12/2010", "15/12/2029"])
      expect(ok(h([[["docDate"], good]]), EwbRequestSchema, ["docDate"]), good).toBe(true);
    for (const bad of ["15/12/2009", "15/12/2030", "x15/12/2017", "15/12/2017x", "15/12/17"]) {
      expect(ok(h([[["docDate"], bad]]), EwbRequestSchema, ["docDate"]), bad).toBe(false);
    }
  });
  it("H itemList: the array form means every item", () => {
    const items = H_BASE["itemList"] as Json[];
    const three = h([[["itemList"], [items[0], items[0], items[0]]]]);
    expect(ok(three, EwbRequestSchema, ["itemList"])).toBe(true);
    for (const i of [0, 1, 2]) {
      const bad = edit(three, [[["itemList", i, "hsnCode"], undefined]]);
      expect(ok(bad, EwbRequestSchema, ["itemList", i, "hsnCode"]), `item ${i}`).toBe(false);
    }
    expect(ok(h([[["itemList"], []]]), EwbRequestSchema, ["itemList"])).toBe(true); // V-G11 owns the count
  });
  it("H empty strings: the listed optional fields are absent when empty (D-M4); others are not", () => {
    for (const k of [
      "transporterName",
      "transporterId",
      "transDocNo",
      "transDocDate",
      "vehicleNo",
      "vehicleType",
      "subSupplyDesc",
    ]) {
      const r = validateEwbRequest(h([[[k], ""]]), { supplierEInvoiceEnabled: false });
      expect(
        r.issues.filter((i: EwbIssue) => i.path[0] === k && i.rule.startsWith("S-")),
        k,
      ).toEqual([]);
      expect(r.value && k in r.value, k).toBe(false);
    }
    expect(validateEwbRequest(h([[["docNo"], ""]])).issues.some((i) => i.rule === "V-G4")).toBe(
      true,
    );
    expect(ok(h([[["transporterId"], ""]]), EwbRequestSchema, ["transporterId"])).toBe(false); // the bare schema is strict
  });
  it("I top level: `$schema` and `required` are not request keys", () => {
    for (const k of ["$schema", "required"]) {
      const r = EwbByIrnRequestSchema.safeParse({ ...I_BASE, [k]: "x" });
      expect(r.success, k).toBe(false);
    }
  });
  it("I character classes: no literal `|`; VehType is the O/R enum", () => {
    const i = (k: string, v: string) => ok({ ...I_BASE, [k]: v }, EwbByIrnRequestSchema, [k]);
    expect(i("VehNo", "AB|1234")).toBe(false);
    expect(i("VehNo", "ab1234")).toBe(true);
    expect(i("VehType", "|")).toBe(false);
    expect(i("VehType", "r")).toBe(false);
    expect(i("VehType", "O")).toBe(true);
  });
  it("I Distance and Pin (type number, whole bounds) are whole numbers", () => {
    expect(ok({ ...I_BASE, Distance: "10.5" }, EwbByIrnRequestSchema, ["Distance"])).toBe(false);
    const ship = (Pin: string) => ({
      ...I_BASE,
      ExpShipDtls: { Addr1: "Port", Loc: "Chennai", Pin, Stcd: "33" },
    });
    expect(ok(ship("600001.5"), EwbByIrnRequestSchema, ["ExpShipDtls", "Pin"])).toBe(false);
    expect(ok(ship("600001"), EwbByIrnRequestSchema, ["ExpShipDtls", "Pin"])).toBe(true);
  });
  it("integers are non-negative; number strings have no leading zero, + or exponent", () => {
    expect(ok(h([[["actToStateCode"], "-1"]]), EwbRequestSchema, ["actToStateCode"])).toBe(false);
    for (const bad of ["01", "+1", "1e3", "1."]) {
      expect(ok(h([[["totalValue"], bad]]), EwbRequestSchema, ["totalValue"]), bad).toBe(false);
      expect(ok(h([[["fromStateCode"], bad]]), EwbRequestSchema, ["fromStateCode"]), bad).toBe(
        false,
      );
    }
  });
  it("an unknown key is rejected on both schemas", () => {
    expect(EwbRequestSchema.safeParse({ ...H_BASE, dispatchFromGSTIN: "x" }).success).toBe(false);
    expect(
      EwbRequestSchema.safeParse({
        ...H_BASE,
        itemList: [{ ...(H_BASE["itemList"] as Json[])[0], extra: 1 }],
      }).success,
    ).toBe(false);
    expect(EwbByIrnRequestSchema.safeParse({ ...I_BASE, Extra: 1 }).success).toBe(false);
    expect(
      EwbByIrnRequestSchema.safeParse({
        ...I_BASE,
        ExpShipDtls: { Addr1: "Port", Loc: "Chennai", Pin: "600001", Stcd: "33", Gstin: "x" },
      }).success,
    ).toBe(false);
  });
  it("JSON types: transDistance, transMode, subSupplyType and Stcd are strings; hsnCode and Pin numbers", () => {
    const types = (leaves: Leaf[]) => Object.fromEntries(leaves.map((l) => [key(l), l.type]));
    const t = types(H_LEAVES);
    expect(t).toMatchObject({
      transDistance: "string",
      transMode: "string",
      subSupplyType: "string",
      "itemList.hsnCode": "number",
      fromPincode: "integer",
      transactionType: "integer",
    });
    const ti = types(I_LEAVES);
    expect(ti).toMatchObject({
      "ExpShipDtls.Stcd": "string",
      "ExpShipDtls.Pin": "number",
      Distance: "number",
    });
  });
});
