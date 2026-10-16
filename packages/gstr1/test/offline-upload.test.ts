import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OfflineUploadJsonSchema,
  parseOfflineUploadJson,
  serializeGstr1,
  toOfflineUploadJson,
  type Gstr1Return,
} from "../src/index.js";
import {
  FILER,
  PERIOD,
  at,
  first,
  mkDoc,
  offline,
  ret,
  validateS4,
  validateS5,
} from "./helpers.js";
import { goldenDocs } from "./scenarios.js";

const render = (r: Gstr1Return) => {
  const out = toOfflineUploadJson(r);
  if (!out.ok) throw new Error(JSON.stringify(out.issues));
  return out.value;
};

describe("toOfflineUploadJson", () => {
  it('the header is always version "GST3.2.4", hash "hash"', () => {
    const j = offline([mkDoc()]);
    expect(at(j, "version")).toBe("GST3.2.4");
    expect(at(j, "hash")).toBe("hash");
  });
  it("key order is the tool's: gstin, fp, version, hash, b2b, b2cl, b2cs, exp, cdnr, cdnur, doc_issue, hsn", () => {
    expect(Object.keys(offline(goldenDocs()))).toEqual([
      "gstin",
      "fp",
      "version",
      "hash",
      "b2b",
      "b2cl",
      "b2cs",
      "exp",
      "cdnr",
      "cdnur",
      "doc_issue",
      "hsn",
    ]);
  });
  it("empty documents → { gstin, fp, version, hash } only", () => {
    expect(serializeGstr1(render(ret([])))).toBe(
      `{"gstin":"${FILER}","fp":"${PERIOD}","version":"GST3.2.4","hash":"hash"}`,
    );
  });
  it("doc_issue.doc_det carries an integer doc_num and doc_typ", () => {
    const j = offline([mkDoc()]);
    expect(j["doc_issue"]).toEqual({
      doc_det: [
        {
          doc_num: 1,
          doc_typ: "Invoices for outward supply",
          docs: [{ num: 1, from: "INV/1", to: "INV/1", totnum: 1, cancel: 0, net_issue: 1 }],
        },
      ],
    });
  });
  it("round-trips through parseOfflineUploadJson", () => {
    const text = serializeGstr1(render(ret(goldenDocs())));
    const parsed = parseOfflineUploadJson(text);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(serializeGstr1(parsed.data)).toBe(text);
  });
  it("the schema accepts what the renderer emits and rejects v5.0's doc_det_new", () => {
    expect(OfflineUploadJsonSchema.safeParse(render(ret(goldenDocs()))).success).toBe(true);
  });
  it("etin is not emitted in v0.1", () => {
    expect(serializeGstr1(render(ret(goldenDocs())))).not.toContain("etin");
  });
  it("FILE_TOO_LARGE above 4.7 MiB (generated synthetic input)", () => {
    const base = ret([mkDoc()]);
    const g = first(base.b2b);
    const inv = first(g.invoices);
    const make = (n: number): Gstr1Return => ({
      ...base,
      b2b: [{ ...g, invoices: Array.from({ length: n }, (_, i) => ({ ...inv, number: `I${i}` })) }],
    });
    expect(toOfflineUploadJson(make(5_000)).ok).toBe(true);
    const big = toOfflineUploadJson(make(30_000));
    expect(big.ok ? [] : big.issues.map((i) => i.code)).toEqual(["FILE_TOO_LARGE"]);
  });
  it("is pure: the same Gstr1Return renders identically twice and is not mutated", () => {
    const r = ret(goldenDocs());
    const before = JSON.stringify(r);
    expect(serializeGstr1(render(r))).toBe(serializeGstr1(render(r)));
    expect(JSON.stringify(r)).toBe(before);
  });
});

describe("golden (b)", () => {
  it("equals the committed expected offline JSON", () => {
    const text = serializeGstr1(render(ret(goldenDocs())));
    const expected = readFileSync(new URL("./golden/offline.json", import.meta.url), "utf8");
    expect(JSON.stringify(JSON.parse(text), null, 2) + "\n").toBe(expected);
  });
  it("validates against S4 and fails S5 (doc_det, integer doc_num)", () => {
    const j = offline(goldenDocs());
    expect(validateS4(j)).toBe(true);
    expect(validateS5(j)).toBe(false);
  });
});
