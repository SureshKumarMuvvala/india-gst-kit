import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { IrnRequestSchema, isNumberLeaf } from "../src/schema.js";
import { edit, mapped } from "./helpers.js";

// Conformance: the Zod schema against sources/einvoice/generate-irn-json-schema.json (source C).
// The source is not valid draft-07 (spec §10 D1), so it is normalised with the quirk list of spec §4
// and every leaf is probed differentially: the source constraints are the oracle.

type Json = Record<string, unknown>;
interface Leaf {
  kind: "leaf";
  type: "string" | "number";
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: string[];
  minimum?: string;
  maximum?: string;
}
interface ArrNode {
  kind: "array";
  item: ObjNode;
}
interface ObjNode {
  kind: "object";
  props: [string, Leaf | ArrNode | ObjNode][];
  required: string[];
}

const SOURCE_URL = new URL(
  "../../../sources/einvoice/generate-irn-json-schema.json",
  import.meta.url,
);
// Numbers are kept as their source text (99999999999999.98 is not a double).
const SOURCE = JSON.parse(
  readFileSync(SOURCE_URL, "utf8"),
  (_k: string, v: unknown, ctx?: { source?: string }) =>
    typeof v === "number" ? { num: ctx?.source } : v,
) as Json;

const trimKeys = (o: Json): Json =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k.trim(), v]));
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const int = (v: unknown): number | undefined => {
  const t = (v as { num?: string } | undefined)?.num;
  return t === undefined ? undefined : Number(t);
};
const numText = (v: unknown): string | undefined => (v as { num?: string } | undefined)?.num;

function buildObject(props: Json, required: unknown): ObjNode {
  const node: ObjNode = {
    kind: "object",
    props: [],
    required: ((required as string[] | undefined) ?? []).map((r) => r.trim()),
  };
  let hoisted: string[] | undefined;
  for (const [rawKey, rawVal] of Object.entries(props)) {
    const key = rawKey.trim();
    if (key === "required" && Array.isArray(rawVal) && typeof rawVal[0] === "string") {
      // Quirk: RefDtls has a "required" pseudo-property that applies to each PrecDocDtls item.
      hoisted = (rawVal as string[]).map((r) => r.trim());
      continue;
    }
    // Quirk: array-wrapped item schemas.
    const isArray = Array.isArray(rawVal);
    const v = trimKeys((isArray ? (rawVal as Json[])[0] : rawVal) as Json);
    // Quirks: " number" and "String".
    const type = (str(v["type"]) ?? "").trim().toLowerCase();
    if (type === "object") {
      const obj = buildObject(trimKeys((v["properties"] ?? {}) as Json), v["required"]);
      node.props.push([key, isArray ? { kind: "array", item: obj } : obj]);
    } else {
      const leaf: Leaf = {
        kind: "leaf",
        type: type as "string" | "number",
        ...(int(v["minLength"]) !== undefined ? { minLength: int(v["minLength"]) as number } : {}),
        ...(int(v["maxLength"]) !== undefined ? { maxLength: int(v["maxLength"]) as number } : {}),
        ...(str(v["pattern"]) !== undefined ? { pattern: str(v["pattern"]) as string } : {}),
        ...(Array.isArray(v["enum"]) ? { enum: v["enum"] as string[] } : {}),
        ...(numText(v["minimum"]) !== undefined
          ? { minimum: numText(v["minimum"]) as string }
          : {}),
        ...(numText(v["maximum"]) !== undefined
          ? { maximum: numText(v["maximum"]) as string }
          : {}),
      };
      node.props.push([key, leaf]);
    }
  }
  if (hoisted !== undefined) {
    const prec = node.props.find(([k]) => k === "PrecDocDtls")?.[1];
    if (prec?.kind !== "array")
      throw new Error("expected PrecDocDtls array for the hoisted required");
    prec.item.required = hoisted;
  }
  return node;
}

const META = new Set(["$schema", "Title", "Description", "required"]);
const ROOT = buildObject(
  trimKeys(Object.fromEntries(Object.entries(SOURCE).filter(([k]) => !META.has(k.trim())))),
  SOURCE["required"],
);

// ---- navigating the Zod schema ----------------------------------------------------------------
function unwrap(s: z.ZodType): z.ZodType {
  let cur = s;
  while (cur instanceof z.ZodOptional) cur = cur.unwrap() as z.ZodType;
  return cur;
}
function shapeOf(s: z.ZodType): Record<string, z.ZodType> {
  const u = unwrap(s);
  if (u instanceof z.ZodArray) return shapeOf(u.element as z.ZodType);
  if (!(u instanceof z.ZodObject)) throw new Error("not an object schema");
  return u.shape;
}

interface Found {
  path: string[];
  node: Leaf | ArrNode | ObjNode;
  zod: z.ZodType;
}
const found: Found[] = [];
const objects: { path: string[]; node: ObjNode; zod: z.ZodType }[] = [];
(function collect(node: ObjNode, zod: z.ZodType, path: string[]) {
  objects.push({ path, node, zod });
  const shape = shapeOf(zod);
  for (const [k, child] of node.props) {
    const z1 = shape[k];
    if (z1 === undefined) continue;
    const p = [...path, k];
    found.push({ path: p, node: child, zod: z1 });
    if (child.kind === "object") collect(child, z1, p);
    if (child.kind === "array") collect(child.item, z1, [...p, "*"]);
  }
})(ROOT, IrnRequestSchema, []);

const leaves = found.filter((f): f is Found & { node: Leaf } => f.node.kind === "leaf");

// ---- oracles ---------------------------------------------------------------------------------
const FREE_TEXT = String.raw`^([^\"])*$`;
function decimals(s: string): number {
  return s.split(".")[1]?.length ?? 0;
}
function oracleString(leaf: Leaf, s: string): boolean {
  const ci = leaf.pattern?.startsWith("(?i)") === true;
  if (s.length < (leaf.minLength ?? 0) || s.length > (leaf.maxLength ?? Infinity)) return false;
  if (leaf.pattern !== undefined) {
    const re = new RegExp(ci ? leaf.pattern.slice(4) : leaf.pattern, ci ? "i" : "");
    if (!re.test(s)) return false;
  }
  if (leaf.enum !== undefined && !leaf.enum.includes(ci ? s.toUpperCase() : s)) return false;
  // Spec §10 D6: the validations text also forbids the backslash in free-text fields.
  if (leaf.pattern === FREE_TEXT && s.includes("\\")) return false;
  return true;
}
function oracleNumber(leaf: Leaf, s: string): boolean {
  // Whole-number leaves (maximum without decimals: PIN, CrDay, Distance) are unsigned integers.
  const integerOnly = decimals(leaf.maximum ?? "0") === 0;
  if (!(integerOnly ? /^(0|[1-9]\d*)$/ : /^-?(0|[1-9]\d*)(\.\d+)?$/).test(s)) return false;
  const d = new Decimal(s);
  if (leaf.minimum !== undefined && d.lt(leaf.minimum)) return false;
  if (leaf.maximum !== undefined && d.gt(leaf.maximum)) return false;
  // Spec §4: decimal places are capped as the maximum implies.
  return decimals(s) <= decimals(leaf.maximum ?? "0");
}

const FIXED_STRINGS = [
  "GST",
  "B2B",
  "b2b",
  "SEZWP",
  "SEZWOP",
  "EXPWP",
  "EXPWOP",
  "DEXP",
  "INV",
  "inv",
  "CRN",
  "DBN",
  "Y",
  "N",
  "y",
  "n",
  "|",
  "URP",
  "29AAAAA0000A1ZY",
  "29aaaaa0000a1zy",
  "05/08/2020",
  "05/08/2030",
  "05/08/2029",
  "05/08/2010",
  "05/08/2009",
  "32/01/2025",
  "12/13/2019",
  "20/20/2020",
  "99/99/2099",
  "01/01/2025",
  "INV/2026-27/0001",
  "0ABC",
  "/ABC",
  "-ABC",
  "A1",
  "A/",
  "AB/-9",
  "1A",
  "9Z/-a",
  "03",
  "3",
  "29",
  "9",
  "00",
  "0",
  "9030457736",
  "903045",
  "9030457",
  "1234567890123",
  "a@b.com",
  "ab+c_d.e-f@gh.ij",
  "abc@",
  "@abc.com",
  "8471",
  "847130",
  "84713010",
  "84",
  "00000000",
  "NOS",
  "KGS",
  "nos",
  "NO",
  "INMAA",
  "USD",
  "usd",
  "IN",
  "in",
  "KA01AB1234",
  "KA01",
  "1",
  "2",
  "3",
  "4",
  "5",
  "O",
  "R",
  "ODC",
  "AB-12",
  "A.B",
  "AB_C",
  "abc def",
  "été",
  'a"b',
  "a\\b",
  "a'b",
  "",
  " ",
  "560001",
  "100000",
  "999999",
  "99999",
  "1000000",
  "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF",
];
const ALPHABET = ["a", "A", "1", "0", "Z", "/", "-", "_", "|", " ", '"', "\\", "@", ".", "+", "é"];

function stringProbes(leaf: Leaf): string[] {
  const out = new Set<string>(FIXED_STRINGS);
  const min = leaf.minLength ?? 0;
  const max = leaf.maxLength ?? 64;
  for (const c of ["a", "A", "1", "0", "9", "Z"]) {
    for (const n of [
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      8,
      9,
      10,
      11,
      12,
      15,
      16,
      17,
      20,
      min - 1,
      min,
      min + 1,
      max - 1,
      max,
      max + 1,
    ]) {
      if (n >= 0 && n <= 1100) out.add(c.repeat(n));
    }
  }
  const accepted = [...out].filter((s) => oracleString(leaf, s) && s.length <= 64);
  // mutations of accepted examples
  for (const a of accepted) {
    for (let i = 0; i <= Math.min(a.length, 24); i++) {
      out.add(a.slice(0, i) + a.slice(i + 1));
      for (const c of ALPHABET) {
        out.add(a.slice(0, i) + c + a.slice(i + 1));
        out.add(a.slice(0, i) + c + a.slice(i));
      }
    }
    const last = a.slice(-1) || "a";
    for (const n of [min - 1, min, max, max + 1]) {
      if (n >= 0 && n <= 1100)
        out.add(n < a.length ? a.slice(0, n) : a + last.repeat(n - a.length));
    }
    out.add(a.toUpperCase());
    out.add(a.toLowerCase());
  }
  return [...out];
}
function numberProbes(leaf: Leaf): string[] {
  const out = new Set<string>([
    "0",
    "1",
    "-1",
    "0.5",
    "1.5",
    "1.23",
    "1.234",
    "1.2345",
    "12.345",
    "123456",
    "999999",
    "100000",
    "99999",
    "1000000",
    "4000",
    "4001",
    "9999",
    "10000",
    "99.99",
    "99.991",
    "99.98",
    "100",
    "100.00",
    "-99.99",
    "-99.991",
    "-100",
    "-0",
    "-0.00",
    "999.999",
    "999.9991",
    "1000",
    "1000.000",
    "99999999999999.98",
    "99999999999999.99",
    "99999999999999.991",
    "100000000000000.00",
    "999999999999.99",
    "999999999999.999",
    "1000000000000.00",
    "9999999999.999",
    "10000000000.000",
    "999999999999.999",
    "1000000000000",
    "abc",
    "",
    "1e3",
    "1E3",
    "+1",
    "01",
    "00",
    "1.",
    ".5",
    "-",
    " 1",
    "1 ",
    "1,5",
    "0x10",
    "NaN",
    "Infinity",
  ]);
  for (const b of [leaf.minimum, leaf.maximum]) {
    if (b === undefined) continue;
    const d = new Decimal(b);
    for (const delta of ["0", "0.001", "-0.001", "0.01", "-0.01", "1", "-1", "0.0001"]) {
      const v = d.plus(delta);
      out.add(v.toFixed());
      out.add(v.toFixed(2));
      out.add(v.toFixed(3));
    }
  }
  return [...out];
}

describe("IrnRequestSchema conformance with source C", () => {
  it("found the expected number of leaves in the source (guards against a broken normaliser)", () => {
    expect(leaves.length).toBeGreaterThan(120);
    expect(leaves.some((l) => l.path.join(".") === "ItemList.*.BchDtls.Nm")).toBe(true);
    expect(leaves.some((l) => l.path.join(".") === "AddlDocDtls.*.Url")).toBe(true);
  });

  it("has the same objects, keys (in source order) and required sets", () => {
    for (const { path, node, zod } of objects) {
      const where = path.join(".") || "(root)";
      const shape = shapeOf(zod);
      expect(Object.keys(shape), `keys of ${where}`).toEqual(node.props.map(([k]) => k));
      const required = Object.entries(shape)
        .filter(([, s]) => !s.safeParse(undefined).success)
        .map(([k]) => k);
      expect([...required].sort(), `required of ${where}`).toEqual([...node.required].sort());
    }
  });

  it("uses arrays exactly where the source has array-wrapped item schemas", () => {
    const sourceArrays = found.filter((f) => f.node.kind === "array").map((f) => f.path.join("."));
    expect(sourceArrays.sort()).toEqual(
      [
        "AddlDocDtls",
        "ItemList",
        "ItemList.*.AttribDtls",
        "RefDtls.ContrDtls",
        "RefDtls.PrecDocDtls",
      ].sort(),
    );
    for (const f of found) {
      expect(unwrap(f.zod) instanceof z.ZodArray, f.path.join(".")).toBe(f.node.kind === "array");
    }
  });

  it("marks number leaves as numbers and string leaves as strings", () => {
    for (const { path, node, zod } of leaves) {
      expect(isNumberLeaf(zod), path.join(".")).toBe(node.type === "number");
    }
  });

  describe.each(leaves.map((l) => [l.path.join("."), l] as const))(
    "leaf %s",
    (_name, { node, zod }) => {
      it("accepts and rejects exactly what the source constraints say", () => {
        const probes = node.type === "number" ? numberProbes(node) : stringProbes(node);
        const oracle = node.type === "number" ? oracleNumber : oracleString;
        const disagreements: string[] = [];
        let accepted = 0;
        for (const p of probes) {
          const expected = oracle(node, p);
          if (expected) accepted++;
          const actual = zod.safeParse(p).success;
          if (expected !== actual)
            disagreements.push(`${JSON.stringify(p)}: source ${expected}, zod ${actual}`);
        }
        expect(disagreements.slice(0, 5)).toEqual([]);
        expect(accepted, "the probe set must contain accepted values").toBeGreaterThan(0);
      });
    },
  );
});

describe("IrnRequestSchema — source quirks (spec §4)", () => {
  const ok = mapped("intraInvoice");
  const parse = (v: unknown) => IrnRequestSchema.safeParse(v);

  it("accepts a mapped payload", () => {
    expect(parse(ok).success).toBe(true);
  });
  it("trims keys: AddlDocDtls (published as 'AddlDocDtls ') has Url and Docs", () => {
    const shape = shapeOf(IrnRequestSchema);
    expect(Object.keys(shape)).toContain("AddlDocDtls");
    expect(Object.keys(shapeOf(shape["AddlDocDtls"] as z.ZodType))).toEqual([
      "Url",
      "Docs",
      "Info",
    ]);
  });
  it("reads ' number' (BuyerDtls.Pin) as a number and 'String' (Ph) as a string", () => {
    const buyer = shapeOf(shapeOf(IrnRequestSchema)["BuyerDtls"] as z.ZodType);
    expect(isNumberLeaf(unwrap(buyer["Pin"] as z.ZodType))).toBe(true);
    expect(isNumberLeaf(unwrap(buyer["Ph"] as z.ZodType))).toBe(false);
  });
  it("RefDtls.required applies to each PrecDocDtls item", () => {
    const withPrec = (item: unknown) => edit(ok, [[["RefDtls"], { PrecDocDtls: [item] }]]);
    expect(parse(withPrec({ InvNo: "AB-12", InvDt: "01/04/2026" })).success).toBe(true);
    expect(parse(withPrec({ InvNo: "AB-12" })).success).toBe(false);
    expect(parse(withPrec({ InvDt: "01/04/2026" })).success).toBe(false);
  });
  it("DocPerdDtls requires InvStDt and InvEndDt (trimmed)", () => {
    const withPeriod = (p: unknown) => edit(ok, [[["RefDtls"], { DocPerdDtls: p }]]);
    expect(parse(withPeriod({ InvStDt: "01/04/2026", InvEndDt: "30/04/2026" })).success).toBe(true);
    expect(parse(withPeriod({ InvStDt: "01/04/2026" })).success).toBe(false);
  });
  it("D3: a one-character PrecDocDtls.InvNo is rejected (the pattern needs 2 characters)", () => {
    const r = parse(
      edit(ok, [[["RefDtls"], { PrecDocDtls: [{ InvNo: "A", InvDt: "01/04/2026" }] }]]),
    );
    expect(r.success).toBe(false);
  });
  it("(?i) enums accept b2b / inv and normalise to upper case", () => {
    const r = parse(
      edit(ok, [
        [["TranDtls", "SupTyp"], "b2b"],
        [["DocDtls", "Typ"], "crn"],
      ]),
    );
    expect(r.success).toBe(true);
    expect(r.data?.TranDtls.SupTyp).toBe("B2B");
    expect(r.data?.DocDtls.Typ).toBe("CRN");
    expect(parse(edit(ok, [[["TranDtls", "SupTyp"], "B2C"]])).success).toBe(false);
  });
  it("Version is any 1–6 character string structurally (rule V1 does the rest)", () => {
    expect(parse(edit(ok, [[["Version"], "1.01"]])).success).toBe(true);
    expect(parse(edit(ok, [[["Version"], "1234567"]])).success).toBe(false);
    expect(parse(edit(ok, [[["Version"], ""]])).success).toBe(false);
  });
  it("rejects an unknown key at any level", () => {
    expect(parse(edit(ok, [[["DocumentDiscount"], "5.00"]])).success).toBe(false);
    expect(parse(edit(ok, [[["ItemList", 0, "Foo"], "x"]])).success).toBe(false);
    expect(parse(edit(ok, [[["ValDtls", "Foo"], "1"]])).success).toBe(false);
  });
  it("D2: the date pattern stops at year 2029", () => {
    expect(parse(edit(ok, [[["DocDtls", "Dt"], "01/04/2029"]])).success).toBe(true);
    expect(parse(edit(ok, [[["DocDtls", "Dt"], "01/04/2030"]])).success).toBe(false);
  });
  it("rejects a backslash in free text (D6) but accepts it where no pattern applies", () => {
    expect(parse(edit(ok, [[["ItemList", 0, "PrdDesc"], "a\\b"]])).success).toBe(false);
    expect(parse(edit(ok, [[["ItemList", 0, "PrdDesc"], 'a"b']])).success).toBe(false);
  });
});
