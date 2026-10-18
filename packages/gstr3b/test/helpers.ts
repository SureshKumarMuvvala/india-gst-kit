import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { Gstr1ReturnSchema, type Gstr1Return } from "@india-gst-kit/gstr1";
import { GSTINS, gstr1ReturnFixture } from "@india-gst-kit/fixtures";
import {
  assembleGstr3b,
  type AssembleInput,
  type Gstr3bDraft,
  type Gstr3bIssue,
} from "../src/index.js";

const SV_FILE = "GSTR3B - Save GSTR3B data request_schema v7.1.json";
const AC_FILE = "GSTR3B - Get ITC Liability Auto Calc Details response_schema v7.1.json";

export function loadSource(name: "SV" | "AC"): Record<string, unknown> {
  const url = new URL(
    `../../../sources/gstr3b/${name === "SV" ? SV_FILE : AC_FILE}`,
    import.meta.url,
  );
  return JSON.parse(readFileSync(url, "utf8")) as Record<string, unknown>;
}

function ajv(schema: object) {
  // strict: false because of the publisher's quirks (spec §13); multipleOfPrecision tolerates binary doubles.
  return new Ajv({ strict: false, allErrors: false, multipleOfPrecision: 2 }).compile(schema);
}
export const validateSV = ajv(loadSource("SV"));
export const validateAC = ajv(loadSource("AC"));

export const FILER = GSTINS.supplierKa;
export const PERIOD = "102026";

/** The fixture GSTR-1 return, parsed into its typed form. */
export function gstr1(): Gstr1Return {
  return Gstr1ReturnSchema.parse(structuredClone(gstr1ReturnFixture));
}

/** A one-document GSTR-1 return around the given sections. */
export function gstr1With(sections: Partial<Omit<Gstr1Return, "gstin" | "period">>): Gstr1Return {
  return Gstr1ReturnSchema.parse({
    gstin: FILER,
    period: PERIOD,
    b2b: [],
    b2cl: [],
    b2cs: [],
    cdnr: [],
    cdnur: [],
    exp: [],
    hsn: { b2b: [], b2c: [] },
    docIssue: [],
    ...sections,
  });
}

export const item = (
  taxableValue: string,
  tax: { igst?: string; cgst?: string; sgst?: string },
  cess = "0.00",
) => ({
  rate: "18",
  taxableValue,
  ...tax,
  cess,
});

/** Assembles and fails the test when assembly fails. */
export function draftOf(input: Partial<AssembleInput> = {}): Gstr3bDraft {
  const r = assembleGstr3b({ gstin: FILER, period: PERIOD, ...input });
  if (!r.ok) throw new Error(`assembly failed: ${JSON.stringify(r.issues)}`);
  return r.value;
}

export const codes = (issues: readonly Gstr3bIssue[]) => issues.map((i) => i.code);

/** The first element; fails the test when there is none. */
export function first<T>(xs: readonly T[] | undefined): T {
  const x = xs?.[0];
  if (x === undefined) throw new Error("expected at least one element");
  return x;
}
