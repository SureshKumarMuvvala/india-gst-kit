// Checks the Zod section schemas against sources/recon/gstr2b-get-all-details-v4.5-response-schema.json
// (source H): required sets, property sets, enums, patterns, min/max. Probes are generated from the source.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { arrayElement, objectShape } from "@india-gst-kit/model";
import { Gstr2bResponseSchema, SECTION_SCHEMAS, parseGstr2bJson } from "../src/index.js";
import {
  jsonText,
  must,
  omit,
  supplierBlock,
  wireFile,
  wireInvoice,
  AMOUNT_KEYS,
} from "./helpers.js";

// ---------- typed access to the (untyped) source JSON ----------

type J = { readonly [k: string]: unknown };
function j(v: unknown): J {
  if (typeof v !== "object" || v === null) throw new Error(`expected an object, got ${String(v)}`);
  return v as J;
}
/** Object at `path` below `root`. */
const at = (root: unknown, ...path: (string | number)[]): J =>
  j(path.reduce<unknown>((cur, k) => j(cur)[k], root));
const keysOf = (v: unknown): string[] => Object.keys(j(v)).sort();
const strings = (v: unknown): string[] => (v as string[]).slice();

const load = (name: string): J =>
  j(JSON.parse(readFileSync(new URL(`../../../sources/recon/${name}`, import.meta.url), "utf8")));
const H = load("gstr2b-get-all-details-v4.5-response-schema.json");
const H44 = load("gstr2b-get-all-details-v4.4-response-schema.json");
const defs = at(H, "definitions");
const dataProps = at(H, "properties", "data", "properties");
const def = (name: string): J => at(defs, name);

type Flavour = keyof typeof SECTION_SCHEMAS;
const SECTIONS = ["b2b", "b2ba", "cdnr", "cdnra"] as const;
type Section = (typeof SECTIONS)[number];
const FLAVOURS = Object.keys(SECTION_SCHEMAS) as Flavour[];

function sourceNode(flavour: Flavour, section: Section): J {
  switch (flavour) {
    case "docdata":
      return at(dataProps, "docdata", "properties", section);
    case "docRejdata":
      return at(dataProps, "docRejdata", "properties", section);
    case "itcrev":
      return at(dataProps, "docdata", "properties", "itcrev", section);
    case "docRejdata.itcrev":
      return at(dataProps, "docRejdata", "properties", "itcrev", section);
  }
}

function levels(flavour: Flavour, section: Section) {
  const container = at(sourceNode(flavour, section), "items");
  const docKey = section === "cdnr" || section === "cdnra" ? "nt" : "inv";
  const doc = at(container, "properties", docKey, "items");
  const item = at(doc, "properties", "items", "items");
  return { container, docKey, doc, item };
}

function shapeOf(schema: z.ZodType): Record<string, z.ZodType> {
  const s = objectShape(schema);
  if (s === undefined) throw new Error("not an object schema");
  return { ...s };
}
const requiredKeys = (shape: Record<string, z.ZodType>): string[] =>
  Object.entries(shape)
    .filter(([, v]) => !v.safeParse(undefined).success)
    .map(([k]) => k)
    .sort();
const elementOf = (schema: z.ZodType | undefined): z.ZodType => must(arrayElement(must(schema)));

describe("structure equals source H (required sets and property sets)", () => {
  for (const flavour of FLAVOURS) {
    for (const section of SECTIONS) {
      it(`${flavour}.${section}`, () => {
        const { container, docKey, doc, item } = levels(flavour, section);

        const cShape = shapeOf(elementOf(SECTION_SCHEMAS[flavour][section]));
        expect(Object.keys(cShape).sort()).toEqual(keysOf(at(container, "properties")));
        expect(requiredKeys(cShape)).toEqual(strings(container["required"]).sort());

        const dShape = shapeOf(elementOf(cShape[docKey]));
        expect(Object.keys(dShape).sort()).toEqual(keysOf(at(doc, "properties")));
        expect(requiredKeys(dShape)).toEqual(strings(doc["required"]).sort());

        const iShape = shapeOf(elementOf(dShape["items"]));
        expect(Object.keys(iShape).sort()).toEqual(keysOf(at(item, "properties")));
        expect(requiredKeys(iShape)).toEqual(strings(item["required"]).sort());
      });
    }
  }

  it("the root and data nodes", () => {
    const root = shapeOf(Gstr2bResponseSchema);
    expect(Object.keys(root).sort()).toEqual(keysOf(at(H, "properties")));
    expect(requiredKeys(root)).toEqual(strings(H["required"]).sort());
    const data = shapeOf(must(root["data"]));
    // The typed keys plus the untyped ones (removed before validation) are exactly source H's `data` keys.
    expect([...Object.keys(data), "itcsumm", "cpsumm", "cpSummRej"].sort()).toEqual(
      Object.keys(dataProps).sort(),
    );
    // Only gstin and rtnprd are common to every anyOf alternative of `data`; those are required here.
    const alternatives = (at(H, "properties", "data")["anyOf"] as { required: string[] }[]).map(
      (a) => a.required,
    );
    const common = Object.keys(dataProps).filter((k) => alternatives.every((a) => a.includes(k)));
    expect(common.sort()).toEqual(["gstin", "rtnprd"]);
    expect(requiredKeys(data)).toEqual(["gstin", "rtnprd"]);
  });
});

// ---------- per-definition probes, generated from the source's definitions ----------

const cents = (n: number, delta: number): string =>
  ((Math.round(n * 100) + delta) / 100).toString();

type Probe = { valid: string[]; invalid: string[] };
function probeFor(name: string): Probe {
  const d = def(name);
  const enumValues = d["enum"];
  if (Array.isArray(enumValues)) {
    return {
      valid: enumValues.map(String),
      invalid: d["type"] === "number" ? ["0.5", "7", "abc"] : ["ZZZ", ""],
    };
  }
  const min = d["minLength"] as number | undefined;
  const max = d["maxLength"] as number | undefined;
  if (d["type"] === "number") {
    const hi = d["maximum"] as number | undefined;
    const lo = d["minimum"] as number | undefined;
    const valid = ["0", "1", "12.5", "1180.10"].filter(
      (v) => (hi === undefined || Number(v) <= hi) && (lo === undefined || Number(v) >= lo),
    );
    const invalid = ["0.001", "1.005", "abc"];
    if (hi !== undefined) {
      valid.push(String(hi));
      invalid.push(cents(hi, 1));
    }
    if (lo === undefined) valid.push("-5", "-0.01");
    else {
      valid.push(String(lo));
      invalid.push(cents(lo, -1), "-1");
    }
    return { valid, invalid };
  }
  const lengths = (ch: string): Probe => ({
    valid: [
      ...(min === undefined ? [] : [ch.repeat(min)]),
      ...(max === undefined ? [] : [ch.repeat(max)]),
    ],
    invalid: [
      ...(max === undefined ? [] : [ch.repeat(max + 1)]),
      ...(min === undefined || min === 0 ? [] : [""]),
    ],
  });
  switch (name) {
    case "date":
    case "nonEmptydate":
      return {
        valid: ["01-01-2026", "29-02-2024", "28-02-2025", "30-04-2026", "31-12-2026"],
        invalid: [
          "29-02-2025",
          "31-04-2026",
          "32-01-2026",
          "00-01-2026",
          "01-13-2026",
          "2026-01-01",
          "1-1-2026",
          "",
        ],
      };
    case "prd":
      return {
        valid: ["012026", "122026", "011900", "122099"],
        invalid: ["132026", "002026", "01-2026", "011899", "012100", ""],
      };
    case "pos":
      return {
        valid: ["01", "09", "29", "38", "96", "97"],
        invalid: ["00", "39", "98", "99", "1", "290", "AB"],
      };
    case "invnum":
      return {
        valid: ["1", "0012", "INV/001", "a-b/c", "0-0", ...lengths("A").valid],
        invalid: ["000", "0", "A B", "A_B", "INV 1", "INV.1", ...lengths("A").invalid],
      };
    case "ctin":
      return {
        valid: ["29AAAAA0000A1ZY", "29aaaaa0000a1zy", "1234ABC12345NRA", "1234abc12345NRA"],
        invalid: [
          "29AAAAA0000A1Z",
          "29AAAAA0000A1ZYY",
          "29AAAAA0000A0ZY",
          "29AAAAA0000A1KY",
          "2AAAAAA0000A1ZYY",
          "1234ABC12345NSA",
          "1234ABC12345nrA",
          "",
        ],
      };
    case "gstin":
      return {
        valid: ["29AAAAA0000A1ZY", "29aaaaa0000a1zy"],
        invalid: ["29AAAAA0000A1Z", "29AAAAA0000A1ZYY", "29AAAAA0000A0ZY", "1234ABC12345NRA", ""],
      };
    case "chksum":
      return { valid: ["a", "A1b2", "x".repeat(64)], invalid: ["", "a b", "a-b", "x".repeat(65)] };
    case "remarks":
      return { valid: ["x", "x".repeat(1000)], invalid: ["", "x".repeat(1001)] };
    default:
      throw new Error(`no probe for definition ${name}`);
  }
}

/** Definition name (`$ref`) of a property node, if it has one. */
const refName = (prop: unknown): string | undefined => {
  const ref = j(prop)["$ref"];
  return typeof ref === "string" ? ref.split("/").pop() : undefined;
};

const firstValid = (prop: unknown): string => {
  const name = refName(prop);
  if (name === undefined) return j(prop)["type"] === "number" ? "1" : "x";
  return must(probeFor(name).valid[0]);
};

describe("every property accepts exactly what source H allows (probes from the source)", () => {
  for (const flavour of FLAVOURS) {
    for (const section of SECTIONS) {
      it(`${flavour}.${section}`, () => {
        const { container, docKey, doc, item } = levels(flavour, section);
        const schema = SECTION_SCHEMAS[flavour][section];
        const cProps = at(container, "properties");
        const dProps = at(doc, "properties");
        const iProps = at(item, "properties");

        type Over = {
          c?: Record<string, unknown>;
          d?: Record<string, unknown>;
          i?: Record<string, unknown>;
        };
        const build = (over: Over): unknown[] => {
          const itemObj = Object.fromEntries(
            Object.entries(iProps).map(([k, p]) => [k, firstValid(p)]),
          );
          const docObj: Record<string, unknown> = Object.fromEntries(
            Object.entries(dProps).map(([k, p]) => [k, firstValid(p)]),
          );
          docObj["items"] = [{ ...itemObj, ...over.i }];
          Object.assign(docObj, over.d);
          const cObj: Record<string, unknown> = Object.fromEntries(
            Object.entries(cProps)
              .filter(([k]) => k !== docKey)
              .map(([k, p]) => [k, firstValid(p)]),
          );
          cObj[docKey] = [docObj];
          Object.assign(cObj, over.c);
          return [cObj];
        };
        // Sanity: the all-valid baseline parses (otherwise the probes prove nothing).
        const base = schema.safeParse(build({}));
        expect(base.success ? [] : base.error.issues).toEqual([]);

        const check = (level: keyof Over, key: string, prop: unknown) => {
          const name = refName(prop);
          if (name === undefined) return;
          const probe = probeFor(name);
          for (const v of probe.valid) {
            const r = schema.safeParse(build({ [level]: { [key]: v } }));
            expect(r.success, `${level}.${key} should accept ${JSON.stringify(v)}`).toBe(true);
          }
          for (const v of probe.invalid) {
            const r = schema.safeParse(build({ [level]: { [key]: v } }));
            expect(r.success, `${level}.${key} should reject ${JSON.stringify(v)}`).toBe(false);
          }
        };
        for (const [k, p] of Object.entries(cProps)) if (k !== docKey) check("c", k, p);
        for (const [k, p] of Object.entries(dProps)) if (k !== "items") check("d", k, p);
        for (const [k, p] of Object.entries(iProps)) check("i", k, p);
      });
    }
  }

  it("the probe table covers every definition referenced by the typed sections and the root", () => {
    const used = new Set<string>();
    const walk = (n: unknown) => {
      if (typeof n !== "object" || n === null) return;
      const r = refName(n);
      if (r !== undefined) used.add(r);
      for (const v of Object.values(n)) walk(v);
    };
    for (const f of FLAVOURS) for (const s of SECTIONS) walk(sourceNode(f, s));
    walk(at(H, "properties", "chksum"));
    for (const k of ["gstin", "rtnprd", "gendt"]) walk(at(dataProps, k));
    expect(used.size).toBeGreaterThan(10);
    for (const name of used) {
      expect(() => probeFor(name), name).not.toThrow();
    }
  });

  it("source H's own numeric limits are the ones the probes assume", () => {
    expect(def("val")).toMatchObject({
      type: "number",
      multipleOf: 0.01,
      maximum: 9999999999999.99,
    });
    expect(def("val")["minimum"]).toBeUndefined(); // D4: no minimum for money
    expect(def("amts")["minimum"]).toBeUndefined();
    expect(def("rate")).toMatchObject({ multipleOf: 0.01, maximum: 999.9, minimum: 0 });
  });
});

describe("plain string properties", () => {
  it("rsn, trdnm and version take any string; num is any JSON number", () => {
    const doc = wireInvoice({ rsn: "", items: [{ num: 7.5, rt: 5, txval: 1000 }] });
    const text = jsonText(
      wireFile({ b2b: [{ ...supplierBlock({ trdnm: "" }), inv: [doc] }] }, { version: "x" }),
    );
    const r = parseGstr2bJson(text);
    expect(r.ok).toBe(true);
    expect(r.value?.records[0]?.items[0]?.num).toBe("7.5");
  });
});

describe("source H quirks (spec §3.3)", () => {
  it("(1) ctin/gstin patterns are unanchored but 15 characters long", () => {
    for (const name of ["ctin", "gstin"]) {
      const d = def(name);
      const alternatives = Array.isArray(d["anyOf"]) ? (d["anyOf"] as unknown[]).map(j) : [d];
      for (const a of alternatives) {
        expect(a["minLength"]).toBe(15);
        expect(a["maxLength"]).toBe(15);
        expect(String(a["pattern"]).startsWith("^")).toBe(false);
      }
    }
  });
  it("(2) ctin has a non-resident alternative that gstin lacks", () => {
    expect(def("ctin")["anyOf"]).toHaveLength(2);
    expect(String(at(def("ctin"), "anyOf", 1)["pattern"])).toContain("[N][R]");
    expect(def("gstin")["anyOf"]).toBeUndefined();
  });
  it("(3) itcrev nodes have no type/properties wrapper", () => {
    for (const parent of ["docdata", "docRejdata"]) {
      const node = at(dataProps, parent, "properties", "itcrev");
      expect(node["type"]).toBeUndefined();
      expect(node["properties"]).toBeUndefined();
      expect(Object.keys(node).sort()).toEqual(["b2b", "b2ba", "cdnr", "cdnra"]);
    }
  });
  it("(4) 'anyof' is not a JSON-Schema keyword and is not enforced: a document with neither items nor txval passes the schema", () => {
    expect(levels("docdata", "b2b").doc["anyof"]).toEqual(["items", "txval", "imsStatus"]);
    const bare = omit(wireInvoice(), ...AMOUNT_KEYS);
    const r = SECTION_SCHEMAS.docdata.b2b.safeParse([
      {
        ctin: "29AAAAA0000A1ZY",
        supfildt: "11-05-2026",
        supprd: "042026",
        inv: [{ ...bare, dt: "20-04-2026", val: "1" }],
      },
    ]);
    expect(r.success).toBe(true);
  });
  it("(5) additionalProperties:false is only at the root and on the ecom/ecoma arrays", () => {
    const paths: string[] = [];
    const walk = (n: unknown, path: string[]) => {
      if (typeof n !== "object" || n === null) return;
      if (j(n)["additionalProperties"] === false) paths.push(path.join("."));
      for (const [k, v] of Object.entries(n)) walk(v, [...path, k]);
    };
    walk(H, []);
    expect(paths.filter((p) => p !== "" && !/(^|\.)ecoma?(\.|$)/.test(p))).toEqual([]);
    expect(paths).toContain("");
    expect(parseGstr2bJson(jsonText({ ...wireFile({}), extra: 1 })).ok).toBe(false);
    expect(parseGstr2bJson(jsonText(wireFile({}, { extra: 1 }))).ok).toBe(true);
  });
  it("(6) invnum is used (not inum) in every typed section", () => {
    for (const f of FLAVOURS) {
      for (const s of SECTIONS) {
        const props = at(levels(f, s).doc, "properties");
        for (const k of ["inum", "oinum", "ntnum", "ontnum"]) {
          if (props[k] !== undefined) expect(refName(props[k])).toBe("invnum");
        }
      }
    }
  });
  it("(7) fields differ between sections as published", () => {
    const has = (f: Flavour, s: Section, k: string) =>
      at(levels(f, s).doc, "properties")[k] !== undefined;
    expect(has("docdata", "b2b", "itcRedReq")).toBe(false);
    expect(has("docdata", "b2b", "remarks")).toBe(false);
    expect(has("docdata", "b2b", "declIgst")).toBe(false);
    for (const s of ["b2ba", "cdnr", "cdnra"] as const) {
      expect(has("docdata", s, "itcRedReq")).toBe(true);
      expect(has("docdata", s, "remarks")).toBe(true);
    }
    for (const s of SECTIONS) {
      expect(has("docRejdata", s, "remarks")).toBe(true);
      expect(has("docRejdata", s, "imsStatus")).toBe(false);
    }
  });
  it("(8) rate has a maximum of 999.9", () => {
    expect(def("rate")["maximum"]).toBe(999.9);
  });
});

describe("v4.4 → v4.5 is a strict superset (diff in sources/recon/README.md)", () => {
  const contains = (big: unknown, small: unknown, path = ""): string[] => {
    if (typeof small !== "object" || small === null)
      return big === small ? [] : [`${path}: changed`];
    if (typeof big !== "object" || big === null) return [`${path}: removed`];
    if (Array.isArray(small)) {
      if (!Array.isArray(big) || big.length !== small.length) return [`${path}: array changed`];
      return small.flatMap((v: unknown, i) => contains(big[i], v, `${path}[${i}]`));
    }
    return Object.entries(small).flatMap(([k, v]) =>
      k in big ? contains((big as J)[k], v, `${path}.${k}`) : [`${path}.${k}: removed`],
    );
  };
  it("nothing in v4.4 was removed or changed", () => {
    expect(contains(H, H44)).toEqual([]);
  });
  it("the additions are exactly the documented isITCRevAmd ones", () => {
    const added: string[] = [];
    const diff = (big: unknown, small: unknown, path: string) => {
      if (Array.isArray(big)) {
        big.forEach((v: unknown, i) => {
          diff(v, (small as unknown[])[i], `${path}[${i}]`);
        });
      } else if (typeof big === "object" && big !== null) {
        for (const [k, v] of Object.entries(big)) {
          if (!(k in j(small))) added.push(`${path}.${k}`);
          else diff(v, j(small)[k], `${path}.${k}`);
        }
      }
    };
    diff(H, H44, "");
    const docdata = ".properties.data.properties.docdata.properties";
    expect(added.sort()).toEqual(
      [
        ".definitions.isITCRevAmd",
        `${docdata}.b2ba.items.properties.inv.items.properties.isITCRevAmd`,
        `${docdata}.cdnra.items.properties.nt.items.properties.isITCRevAmd`,
        `${docdata}.ecoma.items[0].properties.inv.items[0].properties.isITCRevAmd`,
        `${docdata}.itcrev.cdnra.items.properties.nt.items.properties.isITCRevAmd`,
      ].sort(),
    );
  });
  it("a document valid under v4.4 (no isITCRevAmd) is valid here", () => {
    const text = jsonText(wireFile({ b2b: [{ ...supplierBlock(), inv: [wireInvoice()] }] }));
    expect(parseGstr2bJson(text).ok).toBe(true);
  });
});
