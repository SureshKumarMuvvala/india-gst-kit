import {
  describeErrors,
  primaryError,
  USER_MESSAGES_EN,
  type ErrorCategory,
} from "@india-gst-kit/errors";
import type { ErrorCodeInfo } from "./error-codes.js";
import type { ApiErrorEntry, GspError, RawApiError, System } from "./errors.js";

/**
 * Describes the codes of a status-0 envelope with `@india-gst-kit/errors` (spec errors §8.1): the official list
 * (chosen by `op`), the library's category and plain-English message. A caller-supplied `table` (deprecated, see
 * `describeErrorCode`) overrides `officialMessage` for matching codes and nothing else.
 */
export function decorateApiErrors(
  system: System,
  op: string,
  errors: readonly RawApiError[],
  table: readonly ErrorCodeInfo[] = [],
): ApiErrorEntry[] {
  const described = describeErrors(system, errors, { op });
  return errors.map((raw, i) => {
    const d = described[i];
    /* c8 ignore next */
    if (d === undefined) throw new Error("unreachable");
    const custom = table.find((r) => r.system === system && r.code === d.code);
    const entry: ApiErrorEntry = {
      code: raw.code,
      system,
      list: d.list,
      category: d.category,
      officialMessage: custom?.message ?? d.officialMessage,
      userMessage: d.userMessage,
      notes: d.notes,
    };
    if (raw.message !== undefined) entry.message = raw.message;
    return entry;
  });
}

export type GspErrorSummary = {
  /** The library's category (not official) of the error to lead with. */
  category: ErrorCategory;
  /** Plain-English text for that category or code (ours, not official). */
  userMessage: string;
  /** The api entry the summary leads with, when the error came from the portal. */
  primary?: ApiErrorEntry;
  /** Every api entry, in the portal's order; empty for errors that did not come from the portal. */
  entries: ApiErrorEntry[];
};

function bare(category: ErrorCategory): GspErrorSummary {
  return { category, userMessage: USER_MESSAGES_EN.categories[category], entries: [] };
}

/** One category and message for any `GspError` (spec errors §8.2). */
export function summarizeGspError(error: GspError): GspErrorSummary {
  switch (error.kind) {
    case "auth":
      return error.cause.kind === "api" ? summarizeGspError(error.cause) : bare("auth");
    case "api": {
      const primary = primaryError(error.errors);
      if (primary === undefined) return { ...bare("unknown"), entries: error.errors };
      return {
        category: primary.category,
        userMessage: primary.userMessage,
        primary,
        entries: error.errors,
      };
    }
    case "validation":
      return bare("fix-data");
    case "transport":
      return bare(error.outcome === "unknown" ? "outcome-unknown" : "retry-later");
    case "protocol":
    case "crypto":
    case "config":
      return bare("integration");
  }
}
