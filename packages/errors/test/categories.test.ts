// Spec errors §6, tests T-C1–T-C7.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CATEGORY_ASSIGNMENTS,
  EINVOICE_EWB_ERRORS,
  EINVOICE_INV_ERRORS,
  EINVOICE_VITAL_ERRORS,
  ERROR_CATEGORIES,
  ERROR_CATEGORY_BY_CODE,
  EWAYBILL_API_ERRORS,
  SESSION_ERROR_CODES,
  describeError,
  primaryError,
  type ErrorCategory,
  type ErrorListKey,
  type OfficialErrorRow,
} from "../src/index.js";

const DATA: Record<ErrorListKey, readonly OfficialErrorRow[]> = {
  "einvoice/VITAL": EINVOICE_VITAL_ERRORS,
  "einvoice/INV": EINVOICE_INV_ERRORS,
  "einvoice/EWB": EINVOICE_EWB_ERRORS,
  "ewaybill/API": EWAYBILL_API_ERRORS,
};
const KEYS = Object.keys(DATA) as ErrorListKey[];

describe("T-C1 one category per code", () => {
  it.each(KEYS)("%s", (key) => {
    const seen = new Map<string, string>();
    for (const [category, codes] of Object.entries(CATEGORY_ASSIGNMENTS[key])) {
      expect(ERROR_CATEGORIES).toContain(category);
      for (const code of codes) {
        expect(seen.has(code), `${code} twice`).toBe(false);
        seen.set(code, category);
      }
    }
    const dataCodes = DATA[key].map((r) => r.code);
    expect([...seen.keys()].sort()).toStrictEqual([...dataCodes].sort());
    expect(ERROR_CATEGORY_BY_CODE[key].size).toBe(dataCodes.length);
  });
});

describe("T-C2 Appendix A of the spec equals categories.ts", () => {
  it("parses docs/specs/errors.md", () => {
    const spec = readFileSync(new URL("../../../docs/specs/errors.md", import.meta.url), "utf8");
    const appendix = spec.slice(spec.indexOf("## Appendix A"));
    expect(appendix.startsWith("## Appendix A")).toBe(true);
    const parsed: Record<string, Map<string, string>> = {};
    let current: string | undefined;
    for (const line of appendix.split("\n")) {
      const h = /^### (\S+) — \d+ codes$/.exec(line);
      if (h?.[1] !== undefined) {
        current = h[1];
        parsed[current] = new Map();
        continue;
      }
      const row = /^\| `([^`]+)` \| `([^`]+)` \|/.exec(line);
      if (row?.[1] !== undefined && row[2] !== undefined && current !== undefined)
        parsed[current]?.set(row[1], row[2]);
    }
    expect(Object.keys(parsed).sort()).toStrictEqual([...KEYS].sort());
    for (const key of KEYS)
      expect(Object.fromEntries(parsed[key] ?? [])).toStrictEqual(
        Object.fromEntries(ERROR_CATEGORY_BY_CODE[key]),
      );
  });
});

describe("T-C3 counts (spec §6.2)", () => {
  it("per list and category", () => {
    const count = (key: ErrorListKey, c: ErrorCategory) =>
      CATEGORY_ASSIGNMENTS[key][c]?.length ?? 0;
    const expected: Record<string, [number, number, number, number]> = {
      "fix-data": [7, 76, 53, 207],
      "gstin-status": [8, 9, 1, 8],
      "not-allowed": [1, 17, 10, 72],
      "already-done": [1, 3, 2, 3],
      "not-found": [1, 3, 3, 7],
      auth: [14, 0, 1, 14],
      throttled: [4, 0, 1, 3],
      "retry-later": [4, 4, 2, 37],
      "contact-helpdesk": [0, 0, 1, 8],
      integration: [2, 4, 2, 14],
      unknown: [0, 0, 1, 0],
      "outcome-unknown": [0, 0, 0, 0],
    };
    for (const c of ERROR_CATEGORIES)
      expect(
        KEYS.map((k) => count(k, c)),
        c,
      ).toStrictEqual(expected[c]);
  });
});

describe("T-C4 reserved categories", () => {
  it("outcome-unknown is never assigned; unknown only to EWB 4058", () => {
    for (const key of KEYS) expect(CATEGORY_ASSIGNMENTS[key]["outcome-unknown"]).toBeUndefined();
    expect(CATEGORY_ASSIGNMENTS["einvoice/EWB"].unknown).toStrictEqual(["4058"]);
  });
});

describe("T-C5 X5/X6 spot checks", () => {
  const cat = (key: ErrorListKey, code: string) => ERROR_CATEGORY_BY_CODE[key].get(code);
  it("already-done", () => {
    expect(cat("einvoice/INV", "2150")).toBe("already-done");
    expect(cat("einvoice/INV", "2295")).toBe("already-done");
    expect(cat("einvoice/EWB", "4026")).toBe("already-done");
    expect(cat("ewaybill/API", "604")).toBe("already-done");
  });
  it("throttled", () => {
    for (const c of ["3095", "3096", "3108", "_3109"])
      expect(cat("einvoice/VITAL", c)).toBe("throttled");
    for (const c of ["118", "658", "813"]) expect(cat("ewaybill/API", c)).toBe("throttled");
  });
  it("INV 2278 is not-allowed (D-E3, deviates from X5)", () => {
    expect(cat("einvoice/INV", "2278")).toBe("not-allowed");
  });
});

describe("T-C6 SESSION_ERROR_CODES (X4)", () => {
  it("every code exists and is auth", () => {
    for (const code of SESSION_ERROR_CODES.einvoice)
      expect(cat2("einvoice/VITAL", code)).toBe("auth");
    for (const code of SESSION_ERROR_CODES.ewaybill)
      expect(cat2("ewaybill/API", code)).toBe("auth");
    function cat2(key: ErrorListKey, code: string) {
      expect(DATA[key].some((r) => r.code === code)).toBe(true);
      return ERROR_CATEGORY_BY_CODE[key].get(code);
    }
  });
});

describe("T-C7 primaryError (spec §6.3)", () => {
  it("follows the precedence; ties keep input order; empty ⇒ undefined", () => {
    const d = ["240", "238", "201"].map((c) => describeError("ewaybill", c));
    expect(primaryError(d)?.code).toBe("238");
    const ties = [
      { category: "fix-data" as const, id: 1 },
      { category: "fix-data" as const, id: 2 },
      { category: "retry-later" as const, id: 3 },
    ];
    expect(primaryError(ties)?.id).toBe(1);
    expect(
      primaryError([
        { category: "unknown" as const },
        { category: "outcome-unknown" as const },
        { category: "contact-helpdesk" as const },
      ])?.category,
    ).toBe("contact-helpdesk");
    expect(
      primaryError([{ category: "fix-data" as const }, { category: "already-done" as const }])
        ?.category,
    ).toBe("already-done");
    expect(primaryError<{ category: ErrorCategory }>([])).toBeUndefined();
  });
});
