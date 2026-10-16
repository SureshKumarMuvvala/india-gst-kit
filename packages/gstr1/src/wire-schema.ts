import { z } from "zod";
import { D, type Dec } from "./decimal.js";
import { markNumber } from "./numbers.js";
import {
  CTIN_PATTERNS,
  GSTIN_PATTERN,
  INUM_PATTERN,
  POS_FOREIGN_PATTERN,
  POS_PATTERN,
  WIRE_DATE_PATTERN,
} from "./recipient.js";

// Zod transcription of the in-scope parts of S5 (and, with an `etin` schema, of S4). Number leaves are decimal
// strings in memory (see numbers.ts). Optional keys we never emit (flag, diff_percent, irn…, sez_auth, desc…) are
// not part of the transcription, so a payload carrying them is rejected as an unknown key.

const NUM_RE = /^-?\d{1,16}(\.\d{1,2})?$/;

function leaf(min: string | undefined, max: string | undefined, label: string) {
  const lo: Dec | undefined = min === undefined ? undefined : new D(min);
  const hi: Dec | undefined = max === undefined ? undefined : new D(max);
  return markNumber(
    z
      .string()
      .regex(NUM_RE, "must be a JSON number with at most 2 decimals")
      .refine(
        (s) => (lo === undefined || new D(s).gte(lo)) && (hi === undefined || new D(s).lte(hi)),
        `${label} is outside the portal's range`,
      ),
  );
}

/** S5 `#totalValue`: 0 … 9 999 999 999 999.99 */
const totalValue = () => leaf("0", "9999999999999.99", "value");
/** S5 `#txval`, `#nonEmptyCost`: 0 … 99 999 999 999.99 */
const cost = () => leaf("0", "99999999999.99", "amount");
/** S5 `#txvalue`, `#nonEmptyNil`: ≤ 99 999 999 999.99, no minimum */
const signedCost = () => leaf(undefined, "99999999999.99", "amount");
/** S5 `#hsnamt`: ± 9 999 999 999 999.99 */
const hsnAmount = () => leaf("-9999999999999.99", "9999999999999.99", "amount");
/** S5 `#hsnqty`: ± 10^15, multipleOf 0.01 */
const hsnQty = () => leaf("-1000000000000000", "1000000000000000", "quantity");
/** S5 `rt` in b2b, b2cl, b2cs, exp, hsn: 0 … 999.99 */
const rate = () => leaf("0", "999.99", "rate");
/** S5 `rt` in cdnr, cdnur: any number, multipleOf 0.01 */
const rateOpen = () => leaf(undefined, undefined, "rate");

const inum = () => z.string().regex(INUM_PATTERN);
const date = () => z.string().regex(WIRE_DATE_PATTERN);
const ctin = () =>
  z
    .string()
    .refine((s) => CTIN_PATTERNS.some((p) => p.test(s)), "not a valid GSTIN/UIN/NRTP/TDS id");
const posForeign = () => z.string().regex(POS_FOREIGN_PATTERN);
const pos = () => z.string().regex(POS_PATTERN);
const yn = () => z.enum(["Y", "N"]);
const invTyp = () => z.enum(["R", "DE", "SEWP", "SEWOP", "CBW"]);
const itemNum = (min: number) => z.number().int().min(min);

const taxDet = <R extends z.ZodType>(rt: R) =>
  z.strictObject({
    txval: cost(),
    rt,
    iamt: cost().optional(),
    camt: cost().optional(),
    samt: cost().optional(),
    csamt: cost().optional(),
  });
const igstDet = <R extends z.ZodType>(rt: R) =>
  z.strictObject({ txval: cost(), rt, iamt: cost().optional(), csamt: cost().optional() });

const item = <R extends z.ZodType>(rt: R, min = 1) =>
  z.strictObject({ num: itemNum(min), itm_det: taxDet(rt) });
const igstItem = (min = 1) => z.strictObject({ num: itemNum(min), itm_det: igstDet(rate()) });

const HsnRow = () =>
  z.strictObject({
    num: z.number().int().min(1),
    hsn_sc: z.string().regex(/^[0-9]{2,8}$/),
    uqc: z
      .string()
      .min(1)
      .max(30)
      .regex(/^[a-zA-Z]*$/),
    qty: hsnQty(),
    rt: rate(),
    txval: hsnAmount(),
    iamt: hsnAmount().optional(),
    camt: hsnAmount().optional(),
    samt: hsnAmount().optional(),
    csamt: hsnAmount().optional(),
  });

const hsn = () =>
  z
    .strictObject({ hsn_b2b: z.array(HsnRow()).optional(), hsn_b2c: z.array(HsnRow()).optional() })
    .refine(
      (h) => h.hsn_b2b !== undefined || h.hsn_b2c !== undefined,
      "hsn needs hsn_b2b or hsn_b2c",
    );

/**
 * The sections shared by both outputs. `etin` is the e-commerce operator GSTIN schema: `z.never()` for S5
 * (removed in v5.0), the TCS pattern or "" for S4 / the offline tool (O7); never emitted in v0.1 either way.
 */
export function makeSections<E extends z.ZodType>(etin: E, ntty: readonly [string, ...string[]]) {
  const e = etin.optional();
  const noteType = () => z.enum(ntty);
  return {
    b2b: z
      .array(
        z.strictObject({
          ctin: ctin(),
          inv: z
            .array(
              z.strictObject({
                inum: inum(),
                idt: date(),
                val: totalValue(),
                pos: posForeign(),
                rchrg: yn(),
                inv_typ: invTyp(),
                etin: e,
                itms: z.array(item(rate())).min(1),
              }),
            )
            .min(1),
        }),
      )
      .optional(),
    b2cl: z
      .array(
        z.strictObject({
          pos: pos(),
          inv: z
            .array(
              z.strictObject({
                inum: inum(),
                idt: date(),
                val: totalValue(),
                etin: e,
                itms: z.array(igstItem()).min(1),
              }),
            )
            .min(1),
        }),
      )
      .optional(),
    b2cs: z
      .array(
        z.strictObject({
          sply_ty: z.enum(["INTRA", "INTER"]),
          typ: z.enum(["E", "OE"]),
          pos: pos(),
          rt: rate(),
          txval: signedCost(),
          iamt: signedCost().optional(),
          camt: signedCost().optional(),
          samt: signedCost().optional(),
          csamt: signedCost().optional(),
          etin: e,
        }),
      )
      .optional(),
    cdnr: z
      .array(
        z.strictObject({
          ctin: ctin(),
          nt: z
            .array(
              z.strictObject({
                nt_num: inum(),
                nt_dt: date(),
                ntty: noteType(),
                val: totalValue(),
                pos: posForeign(),
                rchrg: yn(),
                inv_typ: invTyp(),
                etin: e,
                itms: z.array(item(rateOpen())).min(1),
              }),
            )
            .min(1),
        }),
      )
      .optional(),
    cdnur: z
      .array(
        z
          .strictObject({
            nt_num: inum(),
            nt_dt: date(),
            ntty: noteType(),
            val: totalValue(),
            typ: z.enum(["B2CL", "EXPWP", "EXPWOP"]),
            pos: pos().optional(),
            itms: z.array(z.strictObject({ num: itemNum(0), itm_det: taxDet(rateOpen()) })).min(1),
          })
          .superRefine((n, ctx) => {
            if (n.typ === "B2CL" && n.pos === undefined) {
              ctx.addIssue({
                code: "custom",
                path: ["pos"],
                message: "pos is required when typ is B2CL",
              });
            }
            if (n.typ !== "B2CL" && n.pos !== undefined) {
              ctx.addIssue({
                code: "custom",
                path: ["pos"],
                message: "pos is not allowed for export notes",
              });
            }
          }),
      )
      .optional(),
    exp: z
      .array(
        z.strictObject({
          exp_typ: z.enum(["WOPAY", "WPAY"]),
          inv: z
            .array(
              z.strictObject({
                inum: inum(),
                idt: date(),
                val: totalValue(),
                itms: z.array(igstDet(rate())).min(1),
              }),
            )
            .min(1),
        }),
      )
      .optional(),
    hsn: hsn().optional(),
  };
}

const docs = () =>
  z.array(
    z.strictObject({
      num: z.number().int().min(1),
      from: inum(),
      to: inum(),
      totnum: z.number().int().min(0).max(9_999_999_999),
      cancel: z.number().int().min(0).max(9_999_999_999),
      net_issue: z.number().int().min(0).max(9_999_999_999),
    }),
  );

/** S5 `doc_issue`: `doc_det_new[]`, `doc_num` a string `^(1A|[1-9]|1[0-2])$`. */
export const docIssueApi = () =>
  z.strictObject({
    doc_det_new: z.array(
      z.strictObject({
        doc_num: z.string().regex(/^(1A|[1-9]|1[0-2])$/),
        doc_typ: z.string().min(1).optional(),
        docs: docs(),
      }),
    ),
  });

/** S4 `doc_issue`: `doc_det[]`, `doc_num` an integer 1–12 (what the offline tool writes). */
export const docIssueOffline = () =>
  z.strictObject({
    doc_det: z.array(
      z.strictObject({
        doc_num: z.number().int().min(1).max(12),
        doc_typ: z.string().min(1).optional(),
        docs: docs(),
      }),
    ),
  });

export const fpWire = () => z.string().regex(/^((0[1-9]|1[012])((19|20)\d\d))$/);
export const gstinWire = () => z.string().regex(GSTIN_PATTERN);
