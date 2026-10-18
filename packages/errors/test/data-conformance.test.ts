// Spec errors §4.4, tests T-D1–T-D8.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LISTS, readChecksums, readList, render } from "../scripts/gen-error-data.mjs";
import {
  EINVOICE_EWB_ERRORS,
  EINVOICE_INV_ERRORS,
  EINVOICE_VITAL_ERRORS,
  ERROR_LIST_SOURCES,
  EWAYBILL_API_ERRORS,
  ErrorListKeySchema,
  OfficialErrorRowSchema,
  type ErrorListKey,
  type OfficialErrorRow,
} from "../src/index.js";

const SOURCES = new URL("../../../sources/errors/", import.meta.url);
const DATA = new URL("../src/data/", import.meta.url);

const EXPORTED: Record<ErrorListKey, readonly OfficialErrorRow[]> = {
  "einvoice/VITAL": EINVOICE_VITAL_ERRORS,
  "einvoice/INV": EINVOICE_INV_ERRORS,
  "einvoice/EWB": EINVOICE_EWB_ERRORS,
  "ewaybill/API": EWAYBILL_API_ERRORS,
};

function sourceTable(file: string): string[][] {
  return JSON.parse(readFileSync(new URL(file, SOURCES), "utf8")) as string[][];
}

describe("T-D1 checksums", () => {
  it("SHA256SUMS matches all four source files", () => {
    const sums = readChecksums(SOURCES);
    expect(Object.keys(sums).sort()).toStrictEqual(LISTS.map((l) => l.file).sort());
    for (const l of LISTS) {
      const sha = createHash("sha256")
        .update(readFileSync(new URL(l.file, SOURCES)))
        .digest("hex");
      expect(sha, l.file).toBe(sums[l.file]);
      expect(ERROR_LIST_SOURCES[l.key as ErrorListKey].sha256).toBe(sha);
    }
  });
});

describe("T-D2 data equals the sources", () => {
  it.each(LISTS.map((l) => [l.key, l] as const))("%s", (key, l) => {
    const table = sourceTable(l.file);
    const expected = table.slice(1).map((cells) => {
      const row: Record<string, string> = {};
      l.columns.forEach((name, i) => {
        const cell = cells[i] ?? "";
        if (cell !== "") row[name] = cell;
      });
      return row;
    });
    expect(EXPORTED[key as ErrorListKey]).toStrictEqual(expected);
    expect(readList(l, SOURCES).rows).toStrictEqual(expected);
  });
  it("row counts 42 / 116 / 77 / 373", () => {
    expect(EINVOICE_VITAL_ERRORS).toHaveLength(42);
    expect(EINVOICE_INV_ERRORS).toHaveLength(116);
    expect(EINVOICE_EWB_ERRORS).toHaveLength(77);
    expect(EWAYBILL_API_ERRORS).toHaveLength(373);
  });
});

describe("T-D3 generated files are byte-for-byte the generator's output", () => {
  it.each(render(SOURCES).map((f) => [f.path, f.text] as const))("%s", (path, text) => {
    expect(readFileSync(new URL(path, DATA), "utf8")).toBe(text);
  });
});

describe("T-D4 verbatim cells", () => {
  it("empty cells are absent keys; every row parses", () => {
    for (const rows of Object.values(EXPORTED))
      for (const row of rows) {
        expect(OfficialErrorRowSchema.safeParse(row).success).toBe(true);
        for (const v of Object.values(row)) expect(v).not.toBe("");
      }
    const vital1004 = EINVOICE_VITAL_ERRORS.find((r) => r.code === "1004");
    expect(vital1004).toStrictEqual({ code: "1004", message: "Header GSTIN is required" });
  });
  it("text is unchanged (curly quote, spelling mistakes)", () => {
    expect(EINVOICE_INV_ERRORS.find((r) => r.code === "2143")?.resolution).toContain("other’s");
    expect(EWAYBILL_API_ERRORS.find((r) => r.code === "111")?.message).toBe(
      "GSTIN is not registerd to this GSP",
    );
    expect(EINVOICE_INV_ERRORS.find((r) => r.code === "2281")?.message).toBe(
      "Inavalid document number",
    );
  });
  it("the generator refuses a header that differs", () => {
    const l = LISTS[0];
    if (l === undefined) throw new Error("no lists");
    expect(() => readList({ ...l, header: ["Error Code", "Error Message"] }, SOURCES)).toThrow(
      /header/,
    );
  });
});

describe("T-D5 codes", () => {
  it("no code repeats within a list", () => {
    for (const rows of Object.values(EXPORTED)) {
      const codes = rows.map((r) => r.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });
  it("_3109 is in VITAL and 3109 is nowhere (X3)", () => {
    expect(EINVOICE_VITAL_ERRORS.some((r) => r.code === "_3109")).toBe(true);
    for (const rows of Object.values(EXPORTED))
      expect(rows.some((r) => r.code === "3109")).toBe(false);
  });
});

describe("T-D6 X1 overlaps", () => {
  it("only the published overlaps exist between e-invoice lists", () => {
    const codes = (rows: readonly OfficialErrorRow[]) => new Set(rows.map((r) => r.code));
    const v = codes(EINVOICE_VITAL_ERRORS);
    const i = codes(EINVOICE_INV_ERRORS);
    const e = codes(EINVOICE_EWB_ERRORS);
    const both = (a: Set<string>, b: Set<string>) => [...a].filter((c) => b.has(c)).sort();
    expect(both(v, i)).toStrictEqual([
      "3029",
      "3074",
      "3075",
      "3076",
      "3077",
      "3078",
      "3079",
      "5001",
    ]);
    expect(both(i, e)).toStrictEqual(["4001"]);
    expect(both(v, e)).toStrictEqual([]);
  });
});

describe("T-D7 list keys", () => {
  it("accepts the four system/list pairs only", () => {
    for (const k of ["einvoice/VITAL", "einvoice/INV", "einvoice/EWB", "ewaybill/API"])
      expect(ErrorListKeySchema.safeParse(k).success).toBe(true);
    for (const k of ["ewaybill/INV", "einvoice/API", "VITAL", "ewaybill/VITAL"])
      expect(ErrorListKeySchema.safeParse(k).success).toBe(false);
  });
});

describe("T-D8 headers", () => {
  it.each(LISTS.map((l) => [l.out, l] as const))(
    "%s starts with Source/Retrieved/Status",
    (out, l) => {
      const lines = readFileSync(new URL(out, DATA), "utf8").split("\n");
      expect(lines[0]).toBe(`// Source: ${l.url} — sources/errors/${l.file}`);
      expect(lines[1]).toBe("// Retrieved: 2026-10-18");
      expect(lines[2]).toBe("// Status: UNVERIFIED — needs CA");
    },
  );
});
