// Source: GST Offline Tool 3.2.4, app/utility/returnStructure.js:1599-1611 — "docDetails" list; doc_num = index + 1
//         (sources/gstr1/offline-tool/code-excerpts.md §3 doc_issue); S5 `#doc_num` pattern ^(1A|[1-9]|1[0-2])$
//         (sources/gstr1/gstr1-save-v5.0-schema.json). The excerpt quotes the first nine names of the tool's
//         12-item list ("…" for the rest); only the three that GSTR-1 documents map to are recorded here.
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
import { z } from "zod";
import { D } from "./decimal.js";
import { INUM_PATTERN } from "./recipient.js";
import type { Gstr1Issue } from "./types.js";
import { issue } from "./types.js";

/** Document-issue types the builder emits: tax invoices (1), debit notes (4) and credit notes (5). */
export const DOC_ISSUE_TYPES = {
  TAX_INVOICE: { code: 1, name: "Invoices for outward supply" },
  DEBIT_NOTE: { code: 4, name: "Debit Note" },
  CREDIT_NOTE: { code: 5, name: "Credit Note" },
} as const;

export const DocIssueTypeSchema = z.enum(["TAX_INVOICE", "DEBIT_NOTE", "CREDIT_NOTE"]);
export type DocIssueType = z.infer<typeof DocIssueTypeSchema>;

const Count = z.number().int().min(0).max(9_999_999_999);

const seriesFields = {
  from: z.string(),
  to: z.string(),
  total: Count,
  cancelled: Count,
  netIssued: Count,
};

/** One series of consecutive documents (Table 13 row). Neutral names: no schema-version encoding. */
export const DocIssueSeriesSchema = z.strictObject({ type: DocIssueTypeSchema, ...seriesFields });
export type DocIssueSeries = z.infer<typeof DocIssueSeriesSchema>;

export const DocIssueEntrySchema = z.strictObject({
  type: DocIssueTypeSchema,
  series: z.array(z.strictObject({ num: z.number().int().min(1), ...seriesFields })).min(1),
});
export type DocIssueEntry = z.infer<typeof DocIssueEntrySchema>;

const ORDER: readonly DocIssueType[] = ["TAX_INVOICE", "DEBIT_NOTE", "CREDIT_NOTE"];

/** Groups series by type (in doc_num order), numbering the series of each type 1..n. */
export function toEntries(list: readonly DocIssueSeries[]): DocIssueEntry[] {
  const out: DocIssueEntry[] = [];
  for (const type of ORDER) {
    const mine = list.filter((s) => s.type === type);
    if (mine.length === 0) continue;
    out.push({
      type,
      series: mine.map((s, i) => ({
        num: i + 1,
        from: s.from,
        to: s.to,
        total: s.total,
        cancelled: s.cancelled,
        netIssued: s.netIssued,
      })),
    });
  }
  return out;
}

/** DOC_ISSUE_INVALID checks for a caller-supplied series (S5 #inum, counts, T's totnum ≥ cancel rules). */
export function docIssueIssues(list: readonly DocIssueSeries[]): Gstr1Issue[] {
  const out: Gstr1Issue[] = [];
  list.forEach((s, i) => {
    const bad = (field: string, message: string) => {
      out.push(issue("DOC_ISSUE_INVALID", message, { path: ["options", "docIssue", i, field] }));
    };
    for (const f of ["from", "to"] as const) {
      if (!INUM_PATTERN.test(s[f]))
        bad(f, `${f} "${s[f]}" does not match the document-number pattern`);
    }
    for (const f of ["total", "cancelled", "netIssued"] as const) {
      const v = s[f];
      if (!Number.isInteger(v) || v < 0 || v > 9_999_999_999) {
        bad(f, `${f} must be an integer from 0 to 9999999999`);
      }
    }
    if (s.cancelled > s.total) bad("cancelled", "cancelled cannot exceed total");
    if (!new D(s.total).minus(s.cancelled).eq(s.netIssued)) {
      bad("netIssued", "netIssued must equal total − cancelled");
    }
  });
  return out;
}
