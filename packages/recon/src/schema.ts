// Zod transcription of sources/recon/gstr2b-get-all-details-v4.5-response-schema.json (source H: GSTR-2B
// "Get All Details" response schema v4.5, Draft, published 20-07-2026). Status: UNVERIFIED — needs CA.
// Retrieved: 2026-10-16. Source: https://developer.gst.gov.in/apiportal/taxpayer/returns
//
// The *Wire* schemas describe the JSON as published, after `convertNumbers` has turned every JSON number
// into its source text. Their outputs are already normalised (money to 2 dp, dates to ISO, GSTINs to upper
// case). Quirks of source H are listed in docs/specs/recon.md §3.3 and cited where they apply.
import { z } from "zod";
import { IsoDateSchema, isTemporaryId, markNumber } from "@india-gst-kit/model";
import { D } from "./decimal.js";

// ---------- leaf definitions ----------

const upper = (s: string): string => s.toUpperCase();

// Quirk 1: `ctin`/`gstin` patterns are unanchored but minLength = maxLength = 15, so they behave as
// anchored patterns. They allow lower case; values are upper-cased in records.
const GSTIN_PATTERN = /^[0-9]{2}[a-zA-Z]{5}[0-9]{4}[a-zA-Z][1-9A-Za-z][Zz1-9A-Ja-j][0-9a-zA-Z]$/;
// Quirk 2: `ctin` has a second, non-resident alternative.
const NR_PATTERN = /^[0-9]{4}[a-zA-Z]{3}[0-9]{5}NR[0-9a-zA-Z]$/;

export function isNonResidentCtin(s: string): boolean {
  return NR_PATTERN.test(s);
}
export function isOrdinaryGstinPattern(s: string): boolean {
  return GSTIN_PATTERN.test(s);
}

// A temporary ID (`…TMP`, model spec §6.4) gets its own message rather than the pattern one.
const TEMPORARY_ID = "looks like a temporary ID, not a GSTIN (model spec §6.4)";
const gstinLike = (valid: (s: string) => boolean, patternMessage: string) =>
  z
    .string()
    .check((ctx) => {
      if (valid(ctx.value)) return;
      ctx.issues.push({
        code: "custom",
        input: ctx.value,
        message: isTemporaryId(ctx.value.toUpperCase()) ? TEMPORARY_ID : patternMessage,
      });
    })
    .transform(upper);
const GstinWire = gstinLike(
  (s) => GSTIN_PATTERN.test(s),
  "not a GSTIN (source H `gstin` pattern, 15 characters)",
);
const CtinWire = gstinLike(
  (s) => GSTIN_PATTERN.test(s) || NR_PATTERN.test(s),
  "not a supplier GSTIN (source H `ctin` patterns, 15 characters)",
);

const MONEY_WIRE = /^-?\d{1,13}(\.\d{1,2})?$/;
const pad2 = (s: string): string => {
  const [int = "", frac = ""] = s.split(".");
  return `${int}.${frac.padEnd(2, "0")}`;
};
/**
 * `val` / `amts`: a JSON number, multipleOf 0.01, maximum 9999999999999.99 and **no minimum** (D4), so a sign
 * is accepted. Written with at most 13 integer digits and 2 decimals, no exponent; output has exactly 2 dp.
 */
const MoneyWire = markNumber(
  z
    .string()
    .regex(MONEY_WIRE, "must be a JSON number with at most 13 integer digits and 2 decimals")
    .transform(pad2),
);
export const Gstr2bMoneySchema = z
  .string()
  .regex(/^-?\d{1,13}\.\d{2}$/, "money must have exactly 2 decimals");

// Quirk 8: `rate` has multipleOf 0.01 and a maximum of 999.9 (and a minimum of 0).
// Zod runs every check even when an earlier one failed, so the refinement must cope with any string.
const RATE_LITERAL = /^\d{1,3}(\.\d{1,2})?$/;
const RateWire = markNumber(
  z
    .string()
    .refine(
      (s) => RATE_LITERAL.test(s),
      "rate must be a non-negative JSON number with at most 2 decimals",
    )
    .refine((s) => !RATE_LITERAL.test(s) || new D(s).lte("999.9"), "rate must not exceed 999.9"),
);
/** Item number: a JSON number, kept as its source text. */
const ItemNumWire = markNumber(
  z.string().regex(/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/, "item number must be a JSON number"),
);

const DIFFPRCNT_LITERAL = /^\d+(\.\d+)?$/;
function diffprcntOf(s: string): "0.65" | "1" | undefined {
  if (!DIFFPRCNT_LITERAL.test(s)) return undefined;
  const d = new D(s);
  if (d.eq("0.65")) return "0.65";
  if (d.eq(1)) return "1";
  return undefined;
}
const DiffprcntWire = markNumber(
  z
    .string()
    .refine((s) => diffprcntOf(s) !== undefined, "diffprcnt must be 0.65 or 1")
    .transform((s) => diffprcntOf(s) ?? "1"),
);

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function isoFromDdMmYyyy(s: string): string | undefined {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m === null) return undefined;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return undefined;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const max = month === 2 && leap ? 29 : (DAYS[month - 1] ?? 0);
  if (day > max) return undefined;
  return `${m[3]}-${m[2]}-${m[1]}`;
}
/** `definitions/date` (DD-MM-YYYY, real calendar check); output is ISO `YYYY-MM-DD`. */
const DateWire = z
  .string()
  .refine((s) => isoFromDdMmYyyy(s) !== undefined, "must be a real date, DD-MM-YYYY")
  .transform((s) => isoFromDdMmYyyy(s) ?? s)
  .pipe(IsoDateSchema);

/** `definitions/prd` (MMYYYY, years 1900–2099). */
const PrdWire = z.string().regex(/^(0[1-9]|1[0-2])((19|20)\d\d)$/, "period must be MMYYYY");
const PosWire = z
  .string()
  .regex(/^(3[0-8]|[12][0-9]|0[1-9]|9[67])$/, "place of supply must be a 2-digit state code");
// Quirk 6: `invnum`, not the stricter `inum`: no whitespace, leading zeros allowed, all-zero rejected.
const InvnumWire = z
  .string()
  .min(1)
  .max(16)
  .regex(/^(?!0*$)[a-zA-Z0-9/-]+$/, "document number: 1–16 of [a-zA-Z0-9/-], not all zeros");
const RemarksWire = z.string().min(1).max(1000);
const ChksumWire = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9]+$/);
const FcWire = markNumber(
  z.string().regex(/^\d+(\.\d+)?([eE][+-]?\d+)?$/, "fc must be a non-negative number"),
);

const Yn = z.enum(["Y", "N"]);
const Ynt = z.enum(["Y", "N", "T"]);
const InvTyp = z.enum(["R", "DE", "SEWP", "SEWOP", "SEZNAO", "SEZWPAO", "SEZWOPAO", "CBW"]);
const NtTyp = z.enum(["C", "D"]);
const NtSupTyp = z.enum(["R", "DE", "SEWP", "SEWOP", "CBW"]);
const ImsStatus = z.enum(["A", "R", "N"]);
const ItcRedReq = z.enum(["N", "Y"]);
const IsItcRevAmd = z.enum(["Y"]);

// ---------- builders ----------

function build<F extends Record<string, z.ZodType>, R extends keyof F, O extends keyof F>(
  fields: F,
  required: readonly R[],
  optional: readonly O[],
) {
  const shape: Record<string, z.ZodType> = {};
  for (const k of required) shape[k as string] = fields[k] as z.ZodType;
  for (const k of optional) shape[k as string] = (fields[k] as z.ZodType).optional();
  return z.strictObject(shape as { [K in R]: F[K] } & { [K in O]: z.ZodOptional<F[K]> });
}

const ItemSchema = build(
  {
    num: ItemNumWire,
    rt: RateWire,
    txval: MoneyWire,
    igst: MoneyWire,
    cgst: MoneyWire,
    sgst: MoneyWire,
    cess: MoneyWire,
  },
  ["num", "txval", "rt"],
  ["igst", "cgst", "sgst", "cess"],
);
export const Gstr2bItemWireSchema = ItemSchema;

const COMMON_FIELDS = {
  dt: DateWire,
  val: MoneyWire,
  pos: PosWire,
  rev: Yn,
  itcavl: Ynt,
  rsn: z.string(),
  diffprcnt: DiffprcntWire,
  txval: MoneyWire,
  igst: MoneyWire,
  cgst: MoneyWire,
  sgst: MoneyWire,
  cess: MoneyWire,
  imsStatus: ImsStatus,
  itcRedReq: ItcRedReq,
  declIgst: MoneyWire,
  declSgst: MoneyWire,
  declCgst: MoneyWire,
  declCess: MoneyWire,
  remarks: RemarksWire,
  isITCRevAmd: IsItcRevAmd,
  items: z.array(ItemSchema),
};
const INVOICE_FIELDS = {
  ...COMMON_FIELDS,
  inum: InvnumWire,
  oinum: InvnumWire,
  oidt: DateWire,
  typ: InvTyp,
};
const NOTE_FIELDS = {
  ...COMMON_FIELDS,
  ntnum: InvnumWire,
  ontnum: InvnumWire,
  ontdt: DateWire,
  onttyp: NtTyp,
  typ: NtTyp,
  suptyp: NtSupTyp,
};

// Required / optional sets per origin and section, as in source H. `docRejdata` documents require `txval`
// and `pos` but not `rev`/`itcavl` (quirk 7); `itcrev` documents have no document-level amounts at all.
const docdata = {
  b2b: build(
    INVOICE_FIELDS,
    ["inum", "typ", "dt", "val", "pos", "rev", "itcavl"],
    ["rsn", "diffprcnt", "txval", "igst", "cgst", "sgst", "cess", "imsStatus", "items"],
  ),
  b2ba: build(
    INVOICE_FIELDS,
    ["oinum", "oidt", "inum", "typ", "dt", "val", "itcavl", "pos", "rev"],
    [
      "rsn",
      "diffprcnt",
      "txval",
      "igst",
      "cgst",
      "sgst",
      "cess",
      "imsStatus",
      "itcRedReq",
      "declIgst",
      "declSgst",
      "declCgst",
      "declCess",
      "remarks",
      "isITCRevAmd",
      "items",
    ],
  ),
  cdnr: build(
    NOTE_FIELDS,
    ["ntnum", "typ", "dt", "val", "itcavl"],
    [
      "suptyp",
      "pos",
      "rev",
      "rsn",
      "diffprcnt",
      "txval",
      "igst",
      "cgst",
      "sgst",
      "cess",
      "imsStatus",
      "itcRedReq",
      "declIgst",
      "declSgst",
      "declCgst",
      "declCess",
      "remarks",
      "items",
    ],
  ),
  cdnra: build(
    NOTE_FIELDS,
    ["onttyp", "ontnum", "ontdt", "ntnum", "typ", "dt", "val", "itcavl"],
    [
      "suptyp",
      "pos",
      "rev",
      "rsn",
      "diffprcnt",
      "txval",
      "igst",
      "cgst",
      "sgst",
      "cess",
      "imsStatus",
      "itcRedReq",
      "declIgst",
      "declSgst",
      "declCgst",
      "declCess",
      "remarks",
      "isITCRevAmd",
      "items",
    ],
  ),
};
const docRejdata = {
  b2b: build(
    INVOICE_FIELDS,
    ["inum", "typ", "dt", "val", "pos", "txval"],
    ["rev", "itcavl", "rsn", "diffprcnt", "igst", "cgst", "sgst", "cess", "remarks", "items"],
  ),
  b2ba: build(
    INVOICE_FIELDS,
    ["oinum", "oidt", "inum", "typ", "dt", "val", "pos", "txval"],
    ["rev", "itcavl", "rsn", "diffprcnt", "igst", "cgst", "sgst", "cess", "remarks", "items"],
  ),
  cdnr: build(
    NOTE_FIELDS,
    ["ntnum", "typ", "dt", "val", "txval"],
    [
      "suptyp",
      "pos",
      "rev",
      "itcavl",
      "rsn",
      "diffprcnt",
      "igst",
      "cgst",
      "sgst",
      "cess",
      "remarks",
      "items",
    ],
  ),
  cdnra: build(
    NOTE_FIELDS,
    ["onttyp", "ontnum", "ontdt", "ntnum", "typ", "dt", "val", "txval"],
    [
      "suptyp",
      "pos",
      "rev",
      "itcavl",
      "rsn",
      "diffprcnt",
      "igst",
      "cgst",
      "sgst",
      "cess",
      "remarks",
      "items",
    ],
  ),
};
// Quirk 3: source H's `itcrev` nodes have no `type`/`properties` wrapper, so a draft-07 validator ignores
// them; they are read here as the intended section shapes.
const itcrev = {
  b2b: build(
    INVOICE_FIELDS,
    ["inum", "typ", "dt", "val", "pos", "rev", "itcavl"],
    ["rsn", "diffprcnt", "items"],
  ),
  b2ba: build(
    INVOICE_FIELDS,
    ["oinum", "oidt", "inum", "typ", "dt", "val", "itcavl", "pos", "rev"],
    ["rsn", "diffprcnt", "items"],
  ),
  cdnr: build(
    NOTE_FIELDS,
    ["ntnum", "typ", "dt", "val", "itcavl"],
    ["suptyp", "pos", "rev", "rsn", "diffprcnt", "items"],
  ),
  cdnra: build(
    NOTE_FIELDS,
    ["onttyp", "ontnum", "ontdt", "ntnum", "typ", "dt", "val", "itcavl"],
    ["suptyp", "pos", "rev", "rsn", "diffprcnt", "isITCRevAmd", "items"],
  ),
};
const rejItcrev = {
  b2b: build(
    INVOICE_FIELDS,
    ["inum", "typ", "dt", "val", "pos"],
    ["rev", "itcavl", "rsn", "diffprcnt", "items"],
  ),
  b2ba: build(
    INVOICE_FIELDS,
    ["oinum", "oidt", "inum", "typ", "dt", "val", "pos"],
    ["rev", "itcavl", "rsn", "diffprcnt", "items"],
  ),
  cdnr: build(
    NOTE_FIELDS,
    ["ntnum", "typ", "dt", "val"],
    ["suptyp", "pos", "rev", "itcavl", "rsn", "diffprcnt", "items"],
  ),
  cdnra: build(
    NOTE_FIELDS,
    ["onttyp", "ontnum", "ontdt", "ntnum", "typ", "dt", "val"],
    ["suptyp", "pos", "rev", "itcavl", "rsn", "diffprcnt", "items"],
  ),
};

const supplierHead = { ctin: CtinWire, trdnm: z.string(), supfildt: DateWire, supprd: PrdWire };
const invContainer = <D extends z.ZodType>(doc: D) =>
  build({ ...supplierHead, inv: z.array(doc) }, ["ctin", "inv", "supprd", "supfildt"], ["trdnm"]);
const noteContainer = <D extends z.ZodType>(doc: D) =>
  build({ ...supplierHead, nt: z.array(doc) }, ["ctin", "nt", "supprd", "supfildt"], ["trdnm"]);

function sectionsOf<
  A extends z.ZodType,
  B extends z.ZodType,
  C extends z.ZodType,
  E extends z.ZodType,
>(flavour: { b2b: A; b2ba: B; cdnr: C; cdnra: E }) {
  return {
    b2b: z.array(invContainer(flavour.b2b)),
    b2ba: z.array(invContainer(flavour.b2ba)),
    cdnr: z.array(noteContainer(flavour.cdnr)),
    cdnra: z.array(noteContainer(flavour.cdnra)),
  };
}

/** Section schemas per origin (the four typed sections each). */
export const SECTION_SCHEMAS = {
  docdata: sectionsOf(docdata),
  docRejdata: sectionsOf(docRejdata),
  itcrev: sectionsOf(itcrev),
  "docRejdata.itcrev": sectionsOf(rejItcrev),
};
export const Gstr2bB2bSchema = SECTION_SCHEMAS.docdata.b2b;
export const Gstr2bB2baSchema = SECTION_SCHEMAS.docdata.b2ba;
export const Gstr2bCdnrSchema = SECTION_SCHEMAS.docdata.cdnr;
export const Gstr2bCdnraSchema = SECTION_SCHEMAS.docdata.cdnra;

const S = SECTION_SCHEMAS;
const DocdataWire = z.strictObject({
  b2b: S.docdata.b2b.optional(),
  b2ba: S.docdata.b2ba.optional(),
  cdnr: S.docdata.cdnr.optional(),
  cdnra: S.docdata.cdnra.optional(),
  itcrev: z
    .strictObject({
      b2b: S.itcrev.b2b.optional(),
      b2ba: S.itcrev.b2ba.optional(),
      cdnr: S.itcrev.cdnr.optional(),
      cdnra: S.itcrev.cdnra.optional(),
    })
    .optional(),
});
const DocRejdataWire = z.strictObject({
  b2b: S.docRejdata.b2b.optional(),
  b2ba: S.docRejdata.b2ba.optional(),
  cdnr: S.docRejdata.cdnr.optional(),
  cdnra: S.docRejdata.cdnra.optional(),
  itcrev: z
    .strictObject({
      b2b: S["docRejdata.itcrev"].b2b.optional(),
      b2ba: S["docRejdata.itcrev"].b2ba.optional(),
      cdnr: S["docRejdata.itcrev"].cdnr.optional(),
      cdnra: S["docRejdata.itcrev"].cdnra.optional(),
    })
    .optional(),
});

/**
 * The typed part of a response. `isd`, `isda`, `impg`, `impgsez`, `ecom`, `ecoma`, `itcsumm`, `cpsumm` and
 * `cpSummRej` are not typed (spec §10); the parser removes them before validation and `raw` keeps them.
 * Only `gstin` and `rtnprd` are required: they are the keys common to every `anyOf` alternative of source H's
 * `data` node, whose other alternatives are not enforced (spec deviation).
 */
export const Gstr2bDataWireSchema = z.strictObject({
  gstin: GstinWire,
  rtnprd: PrdWire,
  version: z.string().optional(),
  gendt: DateWire.optional(),
  docdata: DocdataWire.optional(),
  docRejdata: DocRejdataWire.optional(),
  fc: FcWire.optional(),
});

/** Root of the response; `additionalProperties: false` is in force here (source H), so unknown keys are errors. */
export const Gstr2bResponseSchema = z.strictObject({
  chksum: ChksumWire,
  data: Gstr2bDataWireSchema,
});

export const UNTYPED_DATA_KEYS = ["itcsumm", "cpsumm", "cpSummRej"] as const;
export const UNTYPED_DOC_KEYS = ["isd", "isda", "impg", "impgsez", "ecom", "ecoma"] as const;

// ---------- normalised record (spec §3.2) ----------

export const Gstr2bOriginSchema = z.enum(["docdata", "docRejdata", "itcrev", "docRejdata.itcrev"]);
export const Gstr2bSectionSchema = z.enum(["b2b", "b2ba", "cdnr", "cdnra"]);
const PathSchema = z.array(z.union([z.string(), z.number()]));

export const Gstr2bRecordSchema = z.strictObject({
  origin: Gstr2bOriginSchema,
  section: Gstr2bSectionSchema,
  returnPeriod: z.string().regex(/^(0[1-9]|1[0-2])\d{4}$/),
  recipientGstin: z.string().length(15),
  supplier: z.strictObject({
    gstin: z.string().length(15),
    tradeName: z.string().optional(),
    filingDate: IsoDateSchema,
    filingPeriod: z.string().regex(/^(0[1-9]|1[0-2])\d{4}$/),
  }),
  documentType: z.enum(["INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"]),
  number: z.string(),
  date: IsoDateSchema,
  original: z
    .strictObject({
      number: z.string(),
      date: IsoDateSchema,
      noteType: NtTyp.optional(),
    })
    .optional(),
  supplyType: z.string().optional(),
  placeOfSupply: z.string().optional(),
  reverseCharge: Yn.optional(),
  amounts: z.strictObject({
    value: Gstr2bMoneySchema,
    taxableValue: Gstr2bMoneySchema,
    igst: Gstr2bMoneySchema,
    cgst: Gstr2bMoneySchema,
    sgst: Gstr2bMoneySchema,
    cess: Gstr2bMoneySchema,
  }),
  amountsSource: z.enum(["document", "items"]),
  items: z.array(
    z.strictObject({
      num: z.string(),
      rate: z.string(),
      taxableValue: Gstr2bMoneySchema,
      igst: Gstr2bMoneySchema.optional(),
      cgst: Gstr2bMoneySchema.optional(),
      sgst: Gstr2bMoneySchema.optional(),
      cess: Gstr2bMoneySchema.optional(),
    }),
  ),
  // Verbatim from 2B, never interpreted. `itcavl` is optional because `docRejdata` documents may omit it.
  itc: z.strictObject({
    itcavl: Ynt.optional(),
    rsn: z.string().optional(),
    diffprcnt: z.enum(["0.65", "1"]).optional(),
    imsStatus: ImsStatus.optional(),
    itcRedReq: ItcRedReq.optional(),
    declIgst: Gstr2bMoneySchema.optional(),
    declCgst: Gstr2bMoneySchema.optional(),
    declSgst: Gstr2bMoneySchema.optional(),
    declCess: Gstr2bMoneySchema.optional(),
    remarks: z.string().optional(),
    isITCRevAmd: IsItcRevAmd.optional(),
  }),
  path: PathSchema,
});

export const Gstr2bSchema = z.strictObject({
  gstin: z.string().length(15),
  returnPeriod: z.string().regex(/^(0[1-9]|1[0-2])\d{4}$/),
  version: z.string().optional(),
  generatedOn: IsoDateSchema.optional(),
  fileCount: z.string().optional(),
  records: z.array(Gstr2bRecordSchema),
});

export type Gstr2bRecord = z.infer<typeof Gstr2bRecordSchema>;
export type Gstr2b = z.infer<typeof Gstr2bSchema>;
export type Gstr2bOrigin = z.infer<typeof Gstr2bOriginSchema>;
export type Gstr2bSection = z.infer<typeof Gstr2bSectionSchema>;
export type Gstr2bResponse = z.output<typeof Gstr2bResponseSchema>;
