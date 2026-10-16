// Source: https://docs.ewaybillgst.gov.in/apidocs/version1.03/generate-eway-bill.html#responseSampleJSON (H) —
//         sources/ewaybill/generate-ewaybill-sample-response.txt;
//         https://einv-apisandbox.nic.in/version1.03/ewaybill-generation-irn.html#SampleJSON (I) —
//         sources/ewaybill/ewb-by-irn-sample-response.json
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
//
// Decrypted response `data` only; decryption belongs to `gsp`. Parsing is lenient: unknown keys are
// UNEXPECTED_KEY warnings and the raw JSON is always returned (as in einvoice D-Q5).
import { z } from "zod";
import {
  markNumber,
  parseJsonLossless,
  parseLenient,
  pathStartsWith,
  convertNumbers,
} from "@india-gst-kit/model";
import { EWB_INT_PATTERN } from "./schema.js";
import { toEwbIssues } from "./json.js";
import { hasErrors, issue, type EwbIssue } from "./types.js";

export interface EwbDecodeResult<T> {
  ok: boolean;
  value?: T;
  /** The parsed JSON as received (numbers as their source text), whatever the outcome. */
  raw: unknown;
  issues: EwbIssue[];
}

const intLeaf = () => markNumber(z.string().regex(EWB_INT_PATTERN));
const GENERATE_DATE = /^\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+[AP]M$/;
const IRN_DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export const EwbResponseSchema = z.strictObject({
  ewayBillNo: intLeaf(),
  ewayBillDate: z.string(),
  validUpto: z.string(),
  alert: z.string().nullable().optional(),
});

export const EwbByIrnResponseSchema = z.strictObject({
  EwbNo: intLeaf(),
  EwbDt: z.string().regex(IRN_DATE),
  EwbValidTill: z.string().regex(IRN_DATE).nullable(),
  Remarks: z.string().nullable().optional(),
});

export type EwbResponse = z.infer<typeof EwbResponseSchema>;
export type EwbByIrnResponse = z.infer<typeof EwbByIrnResponseSchema>;

function decode<S extends z.ZodType>(
  text: string,
  schema: S,
  extra: (value: z.output<S>) => EwbIssue[],
): EwbDecodeResult<z.output<S>> {
  let lossless: unknown;
  try {
    lossless = parseJsonLossless(text);
  } catch (e) {
    if (e instanceof SyntaxError) {
      return { ok: false, raw: undefined, issues: [issue([], "BAD_JSON", "P-JSON", e.message)] };
    }
    throw e;
  }
  const found: { path: (string | number)[]; message: string }[] = [];
  const converted = convertNumbers(lossless, schema, [], found);
  const typeIssues = found.map((f) => issue(f.path, "WRONG_TYPE", "P-TYPE", f.message));
  const r = parseLenient(schema, converted);
  const issues: EwbIssue[] = [...typeIssues];
  for (const p of r.unknown) {
    issues.push(
      issue(
        p,
        "UNEXPECTED_KEY",
        "P-UNKNOWN-KEY",
        `unknown key "${String(p[p.length - 1])}"`,
        "warning",
      ),
    );
  }
  issues.push(
    ...toEwbIssues(r.issues, converted, { rule: "P-RESPONSE" }).filter(
      (i) => !typeIssues.some((t) => pathStartsWith(i.path, t.path)),
    ),
  );
  if (r.data !== undefined && !hasErrors(issues)) {
    const value = r.data as z.output<S>;
    issues.push(...extra(value));
    return { ok: true, value, raw: converted, issues };
  }
  return { ok: false, raw: converted, issues };
}

/** Parses the decrypted `data` of a Generate-EWB response. A date in an unexpected format is a warning. */
export function parseEwbResponseData(text: string): EwbDecodeResult<EwbResponse> {
  return decode(text, EwbResponseSchema, (v) =>
    (["ewayBillDate", "validUpto"] as const)
      .filter((k) => !GENERATE_DATE.test(v[k]))
      .map((k) =>
        issue(
          [k],
          "RULE",
          "P-DATE",
          `${k} "${v[k]}" is not DD/MM/YYYY hh:mm:ss AM/PM (the published samples disagree)`,
          "warning",
        ),
      ),
  );
}

/** Parses the decrypted `data` of an EWB-by-IRN response. `EwbValidTill: null` is accepted (Part-A only). */
export function parseEwbByIrnResponseData(text: string): EwbDecodeResult<EwbByIrnResponse> {
  return decode(text, EwbByIrnResponseSchema, () => []);
}
