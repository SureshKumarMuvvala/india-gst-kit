import { z } from "zod";
import { D, type Dec } from "./decimal.js";
import {
  convertNumbers,
  isValidGstin,
  parseJsonLossless,
  parseLenient,
  pathStartsWith,
  zodPath,
  type LosslessTypeIssue,
} from "@india-gst-kit/model";
import {
  Gstr2bResponseSchema,
  UNTYPED_DATA_KEYS,
  UNTYPED_DOC_KEYS,
  isNonResidentCtin,
  type Gstr2b,
  type Gstr2bOrigin,
  type Gstr2bRecord,
  type Gstr2bSection,
} from "./schema.js";
import { hasErrors, issue, type ReconIssue } from "./types.js";

export const GSTR2B_SCHEMA_VERSION = "4.5";

export type Gstr2bParseResult = {
  ok: boolean;
  value?: Gstr2b;
  raw: unknown;
  issues: ReconIssue[];
};

type Path = (string | number)[];
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Removes the sections and summaries that are not typed (spec §10); `raw` keeps them. */
function withoutUntyped(converted: unknown): unknown {
  if (!isObj(converted) || !isObj(converted["data"])) return converted;
  const data: Obj = { ...converted["data"] };
  for (const k of UNTYPED_DATA_KEYS) Reflect.deleteProperty(data, k);
  for (const origin of ["docdata", "docRejdata"]) {
    const node = data[origin];
    if (!isObj(node)) continue;
    const copy: Obj = { ...node };
    for (const k of UNTYPED_DOC_KEYS) Reflect.deleteProperty(copy, k);
    data[origin] = copy;
  }
  return { ...converted, data };
}

/** The fields a document can carry in any origin/section; absent ones are `undefined` (see schema.ts). */
type Money = string;
type WireItem = {
  num: string;
  rt: string;
  txval: Money;
  igst?: Money | undefined;
  cgst?: Money | undefined;
  sgst?: Money | undefined;
  cess?: Money | undefined;
};
type WireDoc = {
  inum?: string | undefined;
  oinum?: string | undefined;
  oidt?: string | undefined;
  ntnum?: string | undefined;
  ontnum?: string | undefined;
  ontdt?: string | undefined;
  onttyp?: "C" | "D" | undefined;
  typ?: string | undefined;
  suptyp?: string | undefined;
  dt: string;
  val: Money;
  pos?: string | undefined;
  rev?: "Y" | "N" | undefined;
  itcavl?: "Y" | "N" | "T" | undefined;
  rsn?: string | undefined;
  diffprcnt?: "0.65" | "1" | undefined;
  txval?: Money | undefined;
  igst?: Money | undefined;
  cgst?: Money | undefined;
  sgst?: Money | undefined;
  cess?: Money | undefined;
  imsStatus?: "A" | "R" | "N" | undefined;
  itcRedReq?: "Y" | "N" | undefined;
  declIgst?: Money | undefined;
  declSgst?: Money | undefined;
  declCgst?: Money | undefined;
  declCess?: Money | undefined;
  remarks?: string | undefined;
  isITCRevAmd?: "Y" | undefined;
  items?: WireItem[] | undefined;
};
type WireContainer = {
  ctin: string;
  trdnm?: string | undefined;
  supfildt: string;
  supprd: string;
  inv?: WireDoc[];
  nt?: WireDoc[];
};

const TAX_FIELDS = ["igst", "cgst", "sgst", "cess"] as const;
const SECTIONS: readonly Gstr2bSection[] = ["b2b", "b2ba", "cdnr", "cdnra"];

function sumItems(items: readonly WireItem[], f: "txval" | (typeof TAX_FIELDS)[number]): Dec {
  return items.reduce((a, it) => a.plus(it[f] ?? "0"), new D(0));
}

type Header = { returnPeriod: string; recipientGstin: string };

function toRecord(
  doc: WireDoc,
  head: Header,
  container: WireContainer,
  origin: Gstr2bOrigin,
  section: Gstr2bSection,
  path: Path,
  issues: ReconIssue[],
): Gstr2bRecord | undefined {
  const isNote = section === "cdnr" || section === "cdnra";
  const items = doc.items ?? [];

  let amountsSource: "document" | "items";
  let taxable: string;
  const taxes: Record<(typeof TAX_FIELDS)[number], string> = {
    igst: "",
    cgst: "",
    sgst: "",
    cess: "",
  };
  if (doc.txval !== undefined) {
    amountsSource = "document";
    taxable = doc.txval;
    for (const f of TAX_FIELDS) taxes[f] = doc[f] ?? "0.00";
    if (items.length > 0) {
      const off: string[] = [];
      if (!sumItems(items, "txval").eq(taxable)) off.push("txval");
      for (const f of TAX_FIELDS) if (!sumItems(items, f).eq(taxes[f])) off.push(f);
      if (off.length > 0) {
        issues.push(
          issue(
            path,
            "ITEMS_TOTAL_MISMATCH",
            `item totals differ from the document level for ${off.join(", ")}; the document level is used`,
            "warning",
          ),
        );
      }
    }
  } else if (items.length > 0) {
    amountsSource = "items";
    taxable = sumItems(items, "txval").toFixed(2);
    for (const f of TAX_FIELDS) taxes[f] = sumItems(items, f).toFixed(2);
  } else {
    issues.push(
      issue(
        path,
        "NO_AMOUNTS",
        "neither items nor txval is present, so there is nothing to compare",
      ),
    );
    return undefined;
  }

  const number = (isNote ? doc.ntnum : doc.inum) ?? "";
  const documentType = !isNote ? "INVOICE" : doc.typ === "D" ? "DEBIT_NOTE" : "CREDIT_NOTE";

  const record: Gstr2bRecord = {
    origin,
    section,
    returnPeriod: head.returnPeriod,
    recipientGstin: head.recipientGstin,
    supplier: {
      gstin: container.ctin,
      filingDate: container.supfildt,
      filingPeriod: container.supprd,
      ...(container.trdnm === undefined ? {} : { tradeName: container.trdnm }),
    },
    documentType,
    number,
    date: doc.dt,
    amounts: { value: doc.val, taxableValue: taxable, ...taxes },
    amountsSource,
    items: items.map((it) => ({
      num: it.num,
      rate: it.rt,
      taxableValue: it.txval,
      ...(it.igst === undefined ? {} : { igst: it.igst }),
      ...(it.cgst === undefined ? {} : { cgst: it.cgst }),
      ...(it.sgst === undefined ? {} : { sgst: it.sgst }),
      ...(it.cess === undefined ? {} : { cess: it.cess }),
    })),
    itc: {
      ...(doc.itcavl === undefined ? {} : { itcavl: doc.itcavl }),
      ...(doc.rsn === undefined ? {} : { rsn: doc.rsn }),
      ...(doc.diffprcnt === undefined ? {} : { diffprcnt: doc.diffprcnt }),
      ...(doc.imsStatus === undefined ? {} : { imsStatus: doc.imsStatus }),
      ...(doc.itcRedReq === undefined ? {} : { itcRedReq: doc.itcRedReq }),
      ...(doc.declIgst === undefined ? {} : { declIgst: doc.declIgst }),
      ...(doc.declCgst === undefined ? {} : { declCgst: doc.declCgst }),
      ...(doc.declSgst === undefined ? {} : { declSgst: doc.declSgst }),
      ...(doc.declCess === undefined ? {} : { declCess: doc.declCess }),
      ...(doc.remarks === undefined ? {} : { remarks: doc.remarks }),
      ...(doc.isITCRevAmd === undefined ? {} : { isITCRevAmd: doc.isITCRevAmd }),
    },
    path,
  };
  // Invoice `typ` / note `suptyp` are supply-type codes, passed through raw and never mapped (Q-CA1).
  const supplyType = isNote ? doc.suptyp : doc.typ;
  if (supplyType !== undefined) record.supplyType = supplyType;
  if (doc.pos !== undefined) record.placeOfSupply = doc.pos;
  if (doc.rev !== undefined) record.reverseCharge = doc.rev;
  if (section === "b2ba" && doc.oinum !== undefined && doc.oidt !== undefined) {
    record.original = { number: doc.oinum, date: doc.oidt };
  }
  if (section === "cdnra" && doc.ontnum !== undefined && doc.ontdt !== undefined) {
    record.original = {
      number: doc.ontnum,
      date: doc.ontdt,
      ...(doc.onttyp === undefined ? {} : { noteType: doc.onttyp }),
    };
  }
  return record;
}

function toRecords(data: z.output<typeof Gstr2bResponseSchema>["data"], issues: ReconIssue[]) {
  const head: Header = { returnPeriod: data.rtnprd, recipientGstin: data.gstin };
  const records: Gstr2bRecord[] = [];
  // Order (spec §6.1): docdata, docRejdata, itcrev, then the (undocumented in the spec) docRejdata.itcrev.
  const origins: [Gstr2bOrigin, Partial<Record<Gstr2bSection, unknown>> | undefined, Path][] = [
    ["docdata", data.docdata, ["data", "docdata"]],
    ["docRejdata", data.docRejdata, ["data", "docRejdata"]],
    ["itcrev", data.docdata?.itcrev, ["data", "docdata", "itcrev"]],
    ["docRejdata.itcrev", data.docRejdata?.itcrev, ["data", "docRejdata", "itcrev"]],
  ];
  for (const [origin, node, base] of origins) {
    if (node === undefined) continue;
    for (const section of SECTIONS) {
      const containers = node[section] as WireContainer[] | undefined;
      containers?.forEach((container, ci) => {
        const cpath: Path = [...base, section, ci];
        if (isOrdinaryGstinCheck(container.ctin) && !isValidGstin(container.ctin)) {
          issues.push(
            issue(
              [...cpath, "ctin"],
              "CTIN_CHECK_DIGIT",
              "supplier GSTIN does not pass the model's GSTIN check (check digit, UNVERIFIED)",
              "info",
            ),
          );
        }
        const key = section === "cdnr" || section === "cdnra" ? "nt" : "inv";
        (container[key] ?? []).forEach((doc, di) => {
          const r = toRecord(doc, head, container, origin, section, [...cpath, key, di], issues);
          if (r !== undefined) records.push(r);
        });
      });
    }
  }
  return records;
}

const isOrdinaryGstinCheck = (ctin: string): boolean => !isNonResidentCtin(ctin);

/**
 * Parses a GSTR-2B "Get All Details" response (source H, v4.5). Money is kept as exact strings (numbers are
 * read from their source text). Never throws on bad data; `ok` means no issue of severity `error`.
 * @throws TypeError if `text` is not a string (a programmer error).
 */
export function parseGstr2bJson(text: string): Gstr2bParseResult {
  if (typeof text !== "string") throw new TypeError("parseGstr2bJson(): text must be a string");
  let lossless: unknown;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
    lossless = parseJsonLossless(text);
  } catch (e) {
    if (e instanceof SyntaxError) {
      return { ok: false, raw: undefined, issues: [issue([], "BAD_JSON", e.message)] };
    }
    throw e;
  }

  const issues: ReconIssue[] = [];
  const typeIssues: LosslessTypeIssue[] = [];
  const converted = convertNumbers(lossless, Gstr2bResponseSchema, [], typeIssues);
  for (const t of typeIssues) issues.push(issue(t.path, "WRONG_TYPE", t.message));

  const parsed = parseLenient(Gstr2bResponseSchema, withoutUntyped(converted));
  for (const p of parsed.unknown) {
    const key = String(p[p.length - 1]);
    // Source H forbids additional properties only at the root (quirk 5); elsewhere it is a warning.
    issues.push(
      issue(p, "UNEXPECTED_KEY", `unknown key "${key}"`, p.length === 1 ? "error" : "warning"),
    );
  }
  const seen = new Set<string>();
  for (const z1 of parsed.issues) {
    const path = zodPath(z1.path);
    if (typeIssues.some((t) => pathStartsWith(path, t.path))) continue;
    const key = `${path.join(".")}|${z1.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue(path, "SCHEMA", z1.message));
  }

  const response = parsed.data as z.output<typeof Gstr2bResponseSchema> | undefined;
  if (response === undefined) return { ok: false, raw, issues };

  const data = response.data;
  if (data.version !== GSTR2B_SCHEMA_VERSION) {
    issues.push(
      issue(
        ["data", "version"],
        "SCHEMA_VERSION",
        `expected version "${GSTR2B_SCHEMA_VERSION}", found ${data.version === undefined ? "none" : `"${data.version}"`}`,
        "warning",
      ),
    );
  }
  if (!isValidGstin(data.gstin)) {
    issues.push(
      issue(
        ["data", "gstin"],
        "CTIN_CHECK_DIGIT",
        "recipient GSTIN does not pass the model's GSTIN check (check digit, UNVERIFIED)",
        "info",
      ),
    );
  }
  const records = toRecords(data, issues);
  if (hasErrors(issues)) return { ok: false, raw, issues };
  const value: Gstr2b = {
    gstin: data.gstin,
    returnPeriod: data.rtnprd,
    records,
    ...(data.version === undefined ? {} : { version: data.version }),
    ...(data.gendt === undefined ? {} : { generatedOn: data.gendt }),
    ...(data.fc === undefined ? {} : { fileCount: data.fc }),
  };
  return { ok: true, value, raw, issues };
}
