import { describe, expect, it } from "vitest";
import { serializeGstr1, toApiSavePayload, toOfflineUploadJson } from "../src/index.js";
import { ret, validateS4, validateS5 } from "./helpers.js";
import { SCENARIOS } from "./scenarios.js";

describe.each(Object.entries(SCENARIOS))("scenario %s", (_name, s) => {
  const r = ret(s.documents, s.extra);
  const a = toApiSavePayload(r);
  const b = toOfflineUploadJson(r);
  it("(a) validates against S5", () => {
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const j: unknown = JSON.parse(serializeGstr1(a.value));
    expect(validateS5(j) || JSON.stringify(validateS5.errors)).toBe(true);
  });
  it("(b) validates against S4", () => {
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const j: unknown = JSON.parse(serializeGstr1(b.value));
    expect(validateS4(j) || JSON.stringify(validateS4.errors)).toBe(true);
  });
  it("(a) vs S4 fails only when doc_issue is present; (b) vs S5 likewise", () => {
    if (!a.ok || !b.ok) throw new Error("render failed");
    const ja: unknown = JSON.parse(serializeGstr1(a.value));
    const jb: unknown = JSON.parse(serializeGstr1(b.value));
    const hasDocIssue = "doc_issue" in (ja as object);
    expect(validateS4(ja)).toBe(!hasDocIssue);
    expect(validateS5(jb)).toBe(!hasDocIssue); // the header literals are valid strings in S5 too
  });
});
