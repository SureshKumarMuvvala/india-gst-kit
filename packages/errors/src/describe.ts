import { ERROR_CATEGORY_BY_CODE } from "./categories.js";
import { EINVOICE_EWB_ERRORS } from "./data/einvoice-ewb.js";
import { EINVOICE_INV_ERRORS } from "./data/einvoice-inv.js";
import { EINVOICE_VITAL_ERRORS } from "./data/einvoice-vital.js";
import { EWAYBILL_API_ERRORS } from "./data/ewaybill-api.js";
import { ERROR_LIST_SOURCES } from "./data/sources.js";
import { CODE_NOTES, USER_MESSAGES_EN } from "./messages.js";
import {
  fillPlaceholders,
  hasMalformedPlaceholder,
  RETURNED_MESSAGE_MAX_LENGTH,
  sanitizeText,
} from "./placeholders.js";
import {
  ErrorSystemSchema,
  LIST_IDS_BY_SYSTEM,
  type ErrorCategory,
  type ErrorDescription,
  type ErrorListId,
  type ErrorListKey,
  type ErrorNote,
  type ErrorSystem,
  type OfficialErrorRow,
} from "./schemas.js";

const ROWS: Readonly<Record<ErrorListKey, readonly OfficialErrorRow[]>> = {
  "einvoice/VITAL": EINVOICE_VITAL_ERRORS,
  "einvoice/INV": EINVOICE_INV_ERRORS,
  "einvoice/EWB": EINVOICE_EWB_ERRORS,
  "ewaybill/API": EWAYBILL_API_ERRORS,
};

const INDEX: ReadonlyMap<ErrorListKey, ReadonlyMap<string, OfficialErrorRow>> = new Map(
  (Object.entries(ROWS) as [ErrorListKey, readonly OfficialErrorRow[]][]).map(([key, rows]) => [
    key,
    new Map(rows.map((row) => [row.code, row])),
  ]),
);

/** Leads with the first of these when a response carries several errors (spec §6.3, D-E5). Ours. */
export const CATEGORY_PRECEDENCE: readonly ErrorCategory[] = [
  "auth",
  "throttled",
  "already-done",
  "integration",
  "gstin-status",
  "not-allowed",
  "fix-data",
  "not-found",
  "retry-later",
  "contact-helpdesk",
  "outcome-unknown",
  "unknown",
];

const OP_ORDER: readonly { ops: readonly string[]; order: readonly ErrorListId[] }[] = [
  {
    ops: ["einvoice.auth", "einvoice.getGstinDetails", "einvoice.syncGstinDetails"],
    order: ["VITAL", "INV", "EWB"],
  },
  {
    ops: [
      "einvoice.generateIrn",
      "einvoice.cancelIrn",
      "einvoice.getEinvoiceByIrn",
      "einvoice.getIrnByDocDetails",
    ],
    order: ["INV", "VITAL", "EWB"],
  },
  { ops: ["einvoice.getEwbByIrn", "einvoice.generateEwbByIrn"], order: ["EWB", "INV", "VITAL"] },
];
const DEFAULT_EINVOICE_ORDER: readonly ErrorListId[] = ["INV", "VITAL", "EWB"];

/** The lists tried, in order, for an operation (spec §5.2, D-E4). Ours. */
export function listOrderForOp(system: ErrorSystem, op?: string): readonly ErrorListId[] {
  if (system === "ewaybill") return LIST_IDS_BY_SYSTEM.ewaybill;
  return (
    OP_ORDER.find((g) => op !== undefined && g.ops.includes(op))?.order ?? DEFAULT_EINVOICE_ORDER
  );
}

export type DescribeErrorOptions = {
  /** Look only in this list; it must belong to `system`. */
  list?: ErrorListId;
  /** A gsp `OperationId`, e.g. `"einvoice.generateIrn"`; picks the list order. */
  op?: string;
  /** Values for `{0}`, `{1}`, … */
  params?: readonly string[];
  /** The message the API actually returned (e-invoice `ErrorMessage`). */
  returnedMessage?: string;
};

const ASCII_TRIM = /^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g;

function keyOf(system: ErrorSystem, list: ErrorListId): ErrorListKey {
  return `${system}/${list}` as ErrorListKey;
}

function rowOf(key: ErrorListKey, code: string): OfficialErrorRow | undefined {
  return INDEX.get(key)?.get(code);
}

/**
 * Describes one official error code: the official text (placeholders filled safely), our category and our
 * plain-English message (spec §5). Never throws on data; an unlisted code is `known: false`, category `unknown`.
 * Throws `TypeError` only on programmer errors: an unknown `system`, or a `list` of the other system.
 */
export function describeError(
  system: ErrorSystem,
  code: string,
  options: DescribeErrorOptions = {},
): ErrorDescription {
  if (!ErrorSystemSchema.safeParse(system).success)
    throw new TypeError(`describeError: unknown system ${system}`);
  if (options.list !== undefined && !LIST_IDS_BY_SYSTEM[system].includes(options.list))
    throw new TypeError(`describeError: list ${options.list} does not belong to ${system}`);
  if (options.params !== undefined && !options.params.every((p) => typeof p === "string"))
    throw new TypeError("describeError: params must be strings");

  const trimmed = code.replace(ASCII_TRIM, "");
  const returned =
    options.returnedMessage === undefined
      ? null
      : sanitizeText(options.returnedMessage, RETURNED_MESSAGE_MAX_LENGTH) || null;
  const params = options.params ?? [];
  const candidates =
    options.list === undefined ? listOrderForOp(system, options.op) : [options.list];
  const list = candidates.find((l) => rowOf(keyOf(system, l), trimmed) !== undefined);

  if (list === undefined) {
    return {
      system,
      list: null,
      code: trimmed,
      known: false,
      category: "unknown",
      officialMessage: null,
      officialMessageTemplate: null,
      officialReason: null,
      officialResolution: null,
      returnedMessage: returned,
      userMessage: USER_MESSAGES_EN.categories.unknown,
      userMessageSource: "category",
      otherLists: [],
      notes: [],
      source: null,
    };
  }

  const key = keyOf(system, list);
  const row = rowOf(key, trimmed) as OfficialErrorRow;
  const category = ERROR_CATEGORY_BY_CODE[key].get(trimmed) ?? "unknown";
  const notes = new Set<ErrorNote>();

  const otherLists = LIST_IDS_BY_SYSTEM[system].flatMap((other) => {
    if (other === list) return [];
    const r = rowOf(keyOf(system, other), trimmed);
    return r === undefined ? [] : [{ list: other, officialMessage: r.message }];
  });
  if (otherLists.length > 0) {
    notes.add("X1-in-other-lists");
    const opKnown = OP_ORDER.some((g) => options.op !== undefined && g.ops.includes(options.op));
    if (options.list === undefined && !opKnown) notes.add("list-guessed");
  }
  if (trimmed.startsWith("_")) notes.add("X3-underscore-code");
  for (const n of CODE_NOTES[key]?.[trimmed] ?? []) notes.add(n);
  if (hasMalformedPlaceholder(row.message)) notes.add("X8-malformed-placeholder");

  const message = fillPlaceholders(row.message, params);
  const reason = row.reason === undefined ? null : fillPlaceholders(row.reason, params);
  const resolution = row.resolution === undefined ? null : fillPlaceholders(row.resolution, params);
  if (message.missing || reason?.missing === true || resolution?.missing === true)
    notes.add("missing-params");

  let userMessage = USER_MESSAGES_EN.categories[category];
  let userMessageSource: "category" | "code" = "category";
  const override = USER_MESSAGES_EN.codes[key]?.[trimmed];
  if (override !== undefined) {
    const filled = fillPlaceholders(override, params);
    if (!filled.missing) {
      userMessage = filled.text;
      userMessageSource = "code";
    }
  }

  const source = ERROR_LIST_SOURCES[key];
  return {
    system,
    list,
    code: trimmed,
    known: true,
    category,
    officialMessage: message.text,
    officialMessageTemplate: row.message,
    officialReason: reason?.text ?? null,
    officialResolution: resolution?.text ?? null,
    returnedMessage: returned,
    userMessage,
    userMessageSource,
    otherLists,
    notes: [...notes],
    source: { url: source.url, retrieved: source.retrieved, status: source.status },
  };
}

/** `describeError` for each `{ code, message? }` (gsp's error-entry shape); `message` becomes `returnedMessage`. */
export function describeErrors(
  system: ErrorSystem,
  entries: readonly { code: string; message?: string | undefined }[],
  options: Omit<DescribeErrorOptions, "returnedMessage"> = {},
): ErrorDescription[] {
  return entries.map((e) =>
    describeError(
      system,
      e.code,
      e.message === undefined ? options : { ...options, returnedMessage: e.message },
    ),
  );
}

/** The entry to lead with, by `CATEGORY_PRECEDENCE`; ties keep input order. `undefined` for an empty list. */
export function primaryError<T extends { category: ErrorCategory }>(
  items: readonly T[],
): T | undefined {
  let best: T | undefined;
  let bestRank = Infinity;
  for (const item of items) {
    const rank = CATEGORY_PRECEDENCE.indexOf(item.category);
    if (rank < bestRank) {
      best = item;
      bestRank = rank;
    }
  }
  return best;
}
