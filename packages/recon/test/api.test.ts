import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALLOWED_FIXTURE_GSTINS } from "@india-gst-kit/fixtures";
import * as api from "../src/index.js";

describe("public API", () => {
  it("exports the documented names and no default export", () => {
    expect("default" in api).toBe(false);
    for (const name of [
      "parseGstr2bJson",
      "reconcile",
      "summarise",
      "normaliseDocNumber",
      "looseDocNumber",
      "GSTR2B_SCHEMA_VERSION",
      "Gstr2bSchema",
      "Gstr2bRecordSchema",
      "ReconResultSchema",
      "ReconIssueSchema",
      "Gstr2bB2bSchema",
      "Gstr2bB2baSchema",
      "Gstr2bCdnrSchema",
      "Gstr2bCdnraSchema",
    ]) {
      expect(api, name).toHaveProperty(name);
    }
    expect(api.GSTR2B_SCHEMA_VERSION).toBe("4.5");
  });

  it("no source file has a default export", () => {
    const dir = new URL("../src/", import.meta.url);
    for (const f of readdirSync(dir)) {
      expect(readFileSync(new URL(f, dir), "utf8"), f).not.toMatch(/export\s+default/);
    }
  });

  it("test and source files contain only registered synthetic GSTINs", () => {
    const shape = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][A-Z0-9][0-9A-Z]\b/g;
    for (const rel of ["../src/", "./"]) {
      const dir = new URL(rel, import.meta.url);
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".ts")) continue;
        for (const m of readFileSync(new URL(f, dir), "utf8").match(shape) ?? []) {
          // the probe tables in conformance.test.ts use deliberately malformed/pattern-only strings
          if (f === "conformance.test.ts" || f === "parse.test.ts") continue;
          expect(ALLOWED_FIXTURE_GSTINS, `${f}: ${m}`).toContain(m);
        }
      }
    }
  });
});
