import { describe, expect, it } from "vitest";
import {
  buildGstr1,
  serializeGstr1,
  toApiSavePayload,
  toOfflineUploadJson,
  type Gstr1Return,
} from "../src/index.js";
import { FILER, PERIOD } from "./helpers.js";
import { SCENARIOS, goldenDocs } from "./scenarios.js";

type Json = Record<string, unknown>;

/** §9: drop version/hash, rename doc_det ↔ doc_det_new, integer ↔ string doc_num. Key order is ignored by toEqual. */
function normalise(j: Json, from: "api" | "offline"): Json {
  const out: Json = { ...j };
  delete out["version"];
  delete out["hash"];
  const di = out["doc_issue"] as Json | undefined;
  if (di !== undefined) {
    const list = (from === "api" ? di["doc_det_new"] : di["doc_det"]) as Json[];
    out["doc_issue"] = {
      doc_det: list.map((e) => ({ ...e, doc_num: String(e["doc_num"]) })),
    };
  }
  return out;
}

function deepFreeze<T>(o: T): T {
  if (typeof o === "object" && o !== null) {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

describe.each(Object.entries(SCENARIOS))("(a) vs (b): %s", (_name, s) => {
  it("differ only by §4.2 / §4.4", () => {
    const built = buildGstr1({ gstin: FILER, period: PERIOD, documents: s.documents, ...s.extra });
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    // The very same Gstr1Return object goes into both converters (frozen: any mutation or
    // re-classification attempt would throw).
    const r: Gstr1Return = deepFreeze(built.value);
    const a = toApiSavePayload(r);
    const b = toOfflineUploadJson(r);
    if (!a.ok || !b.ok) throw new Error("render failed");
    const ja = JSON.parse(serializeGstr1(a.value)) as Json;
    const jb = JSON.parse(serializeGstr1(b.value)) as Json;
    expect(normalise(jb, "offline")).toEqual(normalise(ja, "api"));
  });
});

describe("(a) vs (b) cross-checks", () => {
  it("numbers are written identically in both (same text, byte for byte, in the shared sections)", () => {
    const built = buildGstr1({ gstin: FILER, period: PERIOD, documents: goldenDocs() });
    if (!built.ok) throw new Error("build failed");
    const a = toApiSavePayload(built.value);
    const b = toOfflineUploadJson(built.value);
    if (!a.ok || !b.ok) throw new Error("render failed");
    const ta = serializeGstr1(a.value);
    const tb = serializeGstr1(b.value);
    const section = (t: string, key: string) => {
      const o = JSON.parse(t) as Json;
      return JSON.stringify(o[key]);
    };
    for (const k of ["b2b", "b2cl", "b2cs", "cdnr", "cdnur", "exp", "hsn"]) {
      expect(section(tb, k)).toBe(section(ta, k));
    }
  });
});
