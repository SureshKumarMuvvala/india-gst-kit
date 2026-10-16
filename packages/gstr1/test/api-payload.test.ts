import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ApiSavePayloadSchema,
  parseApiSavePayloadJson,
  serializeGstr1,
  toApiSavePayload,
  type Gstr1Return,
} from "../src/index.js";
import {
  FILER,
  GSTINS,
  PERIOD,
  api,
  ret,
  mkDoc,
  validateS4,
  validateS5,
  at,
  first,
  list,
  put,
  rec,
} from "./helpers.js";
import { goldenDocs } from "./scenarios.js";

const render = (r: Gstr1Return, options?: Parameters<typeof toApiSavePayload>[1]) => {
  const out = toApiSavePayload(r, options);
  if (!out.ok) throw new Error(JSON.stringify(out.issues));
  return out.value;
};

const hasNull = (v: unknown): boolean =>
  v === null ||
  (Array.isArray(v) && v.some(hasNull)) ||
  (typeof v === "object" && Object.values(v).some(hasNull));

const keyPaths = (v: unknown, path = ""): string[] =>
  Array.isArray(v)
    ? v.flatMap((x) => keyPaths(x, path))
    : typeof v === "object" && v !== null
      ? Object.entries(v).flatMap(([k, x]) => [`${path}/${k}`, ...keyPaths(x, `${path}/${k}`)])
      : [];

describe("toApiSavePayload", () => {
  it("top-level key order is S5's: gstin, fp, [hash, version], b2b, b2cl, b2cs, cdnr, cdnur, exp, hsn, doc_issue", () => {
    const j = api(goldenDocs());
    expect(Object.keys(j)).toEqual([
      "gstin",
      "fp",
      "b2b",
      "b2cl",
      "b2cs",
      "cdnr",
      "cdnur",
      "exp",
      "hsn",
      "doc_issue",
    ]);
  });
  it("no null anywhere, no empty arrays, no etin", () => {
    const j = api(goldenDocs());
    expect(hasNull(j)).toBe(false);
    expect(keyPaths(j).some((p) => p.endsWith("/etin"))).toBe(false);
    const text = serializeGstr1(render(ret(goldenDocs())));
    expect(text).not.toContain("null");
    expect(text).not.toContain("[]");
  });
  it("no version/hash by default; present (hash, version) when options.header is given", () => {
    expect(api([mkDoc()])["version"]).toBeUndefined();
    expect(api([mkDoc()])["hash"]).toBeUndefined();
    const r = ret([mkDoc()]);
    const withHeader = JSON.parse(
      serializeGstr1(render(r, { header: { version: "v1", hash: "abc" } })),
    ) as Record<string, unknown>;
    expect(Object.keys(withHeader).slice(0, 4)).toEqual(["gstin", "fp", "hash", "version"]);
    expect(at(withHeader, "version")).toBe("v1");
    expect(at(withHeader, "hash")).toBe("abc");
    const onlyVersion = render(r, { header: { version: "v1" } });
    expect(onlyVersion.hash).toBeUndefined();
  });
  it("amounts are raw number literals with money at 2 dp; rates trim trailing zeros", () => {
    const text = serializeGstr1(
      render(ret([mkDoc({ lines: [{ taxable: "1000.00", rate: "18.000" }] })])),
    );
    expect(text).toContain('"val":1180.00');
    expect(text).toContain('"txval":1000.00,"rt":18,"camt":90.00,"samt":90.00,"csamt":0.00');
    expect(text).toContain('"num":1801');
    expect(text).toContain('"idt":"05-10-2026"');
  });
  it("9999999999999.99 round-trips byte-exact through parseApiSavePayloadJson", () => {
    const text =
      `{"gstin":"${FILER}","fp":"${PERIOD}","b2b":[{"ctin":"${GSTINS.recipientMh}","inv":[{"inum":"INV/1",` +
      `"idt":"05-10-2026","val":9999999999999.99,"pos":"27","rchrg":"N","inv_typ":"R","itms":[{"num":1,` +
      `"itm_det":{"txval":1.00,"rt":18,"iamt":0.18}}]}]}]}`;
    const parsed = parseApiSavePayloadJson(text);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.b2b?.[0]?.inv[0]?.val).toBe("9999999999999.99");
    expect(serializeGstr1(parsed.data)).toBe(text);
  });
  it("parseApiSavePayloadJson rejects a string where a number belongs, and bad JSON", () => {
    const base: unknown = JSON.parse(serializeGstr1(render(ret([mkDoc()]))));
    put(base, ["b2b", 0, "inv", 0, "val"], "1180.00");
    expect(parseApiSavePayloadJson(JSON.stringify(base)).success).toBe(false);
    expect(parseApiSavePayloadJson("{not json").success).toBe(false);
  });
  it("empty documents → { gstin, fp } only", () => {
    const text = serializeGstr1(render(ret([])));
    expect(text).toBe(`{"gstin":"${FILER}","fp":"${PERIOD}"}`);
  });
  it("round-trips through parseApiSavePayloadJson", () => {
    const text = serializeGstr1(render(ret(goldenDocs())));
    const parsed = parseApiSavePayloadJson(text);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(serializeGstr1(parsed.data)).toBe(text);
  });
  it("the payload's own schema accepts what the renderer emits", () => {
    const value = render(ret(goldenDocs()));
    expect(ApiSavePayloadSchema.safeParse(value).success).toBe(true);
  });
  it("cdnr amounts are never negative; the direction is in ntty", () => {
    const j = api(goldenDocs());
    for (const g of list(j, "cdnr"))
      for (const n of list(g, "nt")) {
        expect(at(n, "val")).toBeGreaterThanOrEqual(0);
        for (const i of list(n, "itms"))
          expect(at(i, "itm_det", "txval")).toBeGreaterThanOrEqual(0);
      }
  });
  it("cdnur B2CL items carry only iamt/csamt", () => {
    const j = api(goldenDocs());
    expect(Object.keys(rec(j, "cdnur", 0, "itms", 0, "itm_det"))).toEqual([
      "txval",
      "rt",
      "iamt",
      "csamt",
    ]);
  });
  it("is pure: the same Gstr1Return renders identically twice and is not mutated", () => {
    const r = ret(goldenDocs());
    const before = JSON.stringify(r);
    expect(serializeGstr1(render(r))).toBe(serializeGstr1(render(r)));
    expect(JSON.stringify(r)).toBe(before);
  });
});

describe("FILE_TOO_LARGE", () => {
  const LIMIT = 4.7 * 1024 * 1024;
  const huge = (n: number): Gstr1Return => {
    const base = ret([mkDoc()]);
    const g = first(base.b2b);
    const inv = first(g.invoices);
    const invoices = Array.from({ length: n }, (_, i) => ({ ...inv, number: `I${i}` }));
    return { ...base, b2b: [{ ...g, invoices }] };
  };
  it("a payload over 4.7 MiB is refused; one under is not", () => {
    const small = toApiSavePayload(huge(5_000));
    expect(small.ok).toBe(true);
    if (small.ok) expect(Buffer.byteLength(serializeGstr1(small.value))).toBeLessThan(LIMIT);
    const big = toApiSavePayload(huge(30_000));
    expect(big.ok ? [] : big.issues.map((i) => i.code)).toEqual(["FILE_TOO_LARGE"]);
  });
});

describe("golden (a)", () => {
  const expectedUrl = new URL("./golden/api.json", import.meta.url);
  it("equals the committed expected JSON, byte for byte after normalisation", () => {
    const text = serializeGstr1(render(ret(goldenDocs())));
    const expected = readFileSync(expectedUrl, "utf8");
    expect(JSON.stringify(JSON.parse(text), null, 2) + "\n").toBe(expected);
  });
  it("validates against S5 and fails S4 (doc_det_new)", () => {
    const j = api(goldenDocs());
    expect(validateS5(j)).toBe(true);
    expect(validateS4(j)).toBe(false);
  });
  it("covers b2b intra/inter, SEZ, b2cl, b2cs, export, cdnr, cdnur B2CL and a b2cs credit note", () => {
    const j = api(goldenDocs());
    const types = list(j, "b2b").flatMap((g) => list(g, "inv").map((i) => at(i, "inv_typ")));
    expect(types).toEqual(["R", "R", "SEWP", "SEWOP"]);
    expect(at(j, "b2cl")).toHaveLength(1);
    expect(list(j, "b2cs").some((r) => at(r, "sply_ty") === "INTRA")).toBe(true);
    expect(list(j, "exp").map((e) => at(e, "exp_typ"))).toEqual(["WPAY", "WOPAY"]);
    expect(at(j, "cdnr")).toHaveLength(2);
    expect(at(j, "cdnur", 0, "typ")).toBe("B2CL");
    // CN/G3 nets INV/G6 (1000 − 200) into the INTRA/29/18 row
    const row = list(j, "b2cs").find((r) => at(r, "sply_ty") === "INTRA" && at(r, "rt") === 18);
    expect(row).toMatchObject({ txval: 800, camt: 72, samt: 72 });
  });
});
