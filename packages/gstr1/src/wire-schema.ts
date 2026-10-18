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

// ---------------------------------------------------------------- Track A2 sections (spec §17)
// Transcribed from S5 (`b2ba`, `b2cla`, `b2csa`, `cdnra`, `cdnura`, `nil`, `expa`, `at`, `txpd`, `ata`, `txpda`,
// `ecom`, `ecoma`, `supeco`, `supecoa`) and, for output (b), S4. Keys we never emit (flag where optional, diff_percent,
// sez_auth, eco_typ, estin, sbpcode/sbnum/sbdt, the `at_ecom` family) are left out, so they are rejected.

/** S5 `#nonEmptyCostAT`: ±99 999 999 999.99 */
const costAt = () => leaf("-99999999999.99", "99999999999.99", "amount");
/** S4 `#nonEmptyRate` (`ata`, `txpda`): 0 … 999.9 */
const rateS4At = () => leaf("0", "999.9", "rate");
const omon = () => fpWire();
const splyTy = () => z.enum(["INTER", "INTRA"]);
const ecoFlag = () => z.enum(["N", "E", "D"]);
const amendItem = () => z.strictObject({ num: itemNum(1), itm_det: taxDet(rateOpen()) });

/** Sections whose shape is the same in S5 and S4 apart from `etin` and `ntty`. */
export function makeA2Sections<E extends z.ZodType>(etin: E, ntty: readonly [string, ...string[]]) {
  const e = etin.optional();
  return {
    b2ba: z
      .array(
        z.strictObject({
          ctin: ctin(),
          inv: z
            .array(
              z.strictObject({
                inum: inum(),
                idt: date(),
                oinum: inum(),
                oidt: date(),
                val: totalValue(),
                pos: posForeign(),
                rchrg: yn(),
                inv_typ: invTyp(),
                etin: e,
                itms: z.array(amendItem()).min(1),
              }),
            )
            .min(1),
        }),
      )
      .optional(),
    b2cla: z
      .array(
        z.strictObject({
          pos: pos(),
          inv: z
            .array(
              z.strictObject({
                inum: inum(),
                idt: date(),
                oinum: inum(),
                oidt: date(),
                val: totalValue(),
                etin: e,
                itms: z
                  .array(z.strictObject({ num: itemNum(1), itm_det: igstDet(rateOpen()) }))
                  .min(1),
              }),
            )
            .min(1),
        }),
      )
      .optional(),
    b2csa: z
      .array(
        z.strictObject({
          typ: z.enum(["E", "OE"]),
          sply_ty: splyTy(),
          pos: pos(),
          omon: omon(),
          etin: e,
          itms: z
            .array(
              z.strictObject({
                rt: rateOpen(),
                txval: signedCost(),
                iamt: signedCost().optional(),
                camt: signedCost().optional(),
                samt: signedCost().optional(),
                csamt: signedCost().optional(),
              }),
            )
            .min(1),
        }),
      )
      .optional(),
    cdnra: z
      .array(
        z.strictObject({
          ctin: ctin(),
          nt: z
            .array(
              z.strictObject({
                nt_num: inum(),
                nt_dt: date(),
                ont_num: inum(),
                ont_dt: date(),
                ntty: z.enum(ntty),
                val: totalValue(),
                pos: posForeign(),
                rchrg: yn(),
                inv_typ: invTyp(),
                etin: e,
                itms: z.array(amendItem()).min(1),
              }),
            )
            .min(1),
        }),
      )
      .optional(),
    cdnura: z
      .array(
        z
          .strictObject({
            nt_num: inum(),
            nt_dt: date(),
            ont_num: inum(),
            ont_dt: date(),
            ntty: z.enum(ntty),
            val: totalValue(),
            typ: z.enum(["B2CL", "EXPWP", "EXPWOP"]),
            pos: pos().optional(),
            itms: z.array(z.strictObject({ num: itemNum(1), itm_det: igstDet(rateOpen()) })).min(1),
          })
          .superRefine((n, ctx) => {
            if ((n.typ === "B2CL") !== (n.pos !== undefined)) {
              ctx.addIssue({
                code: "custom",
                path: ["pos"],
                message: "pos is required for B2CL and not allowed for export notes",
              });
            }
          }),
      )
      .optional(),
    nil: z
      .strictObject({
        inv: z
          .array(
            z.strictObject({
              sply_ty: z.enum(["INTRB2B", "INTRB2C", "INTRAB2B", "INTRAB2C"]),
              nil_amt: signedCost(),
              expt_amt: signedCost(),
              ngsup_amt: signedCost(),
            }),
          )
          .min(1),
      })
      .optional(),
    expa: z
      .array(
        z.strictObject({
          exp_typ: z.enum(["WOPAY", "WPAY"]),
          inv: z
            .array(
              z.strictObject({
                inum: inum(),
                idt: date(),
                val: totalValue(),
                oinum: inum(),
                oidt: date(),
                itms: z
                  .array(
                    z.strictObject({
                      txval: cost(),
                      rt: cost(),
                      iamt: cost().optional(),
                      csamt: cost().optional(),
                    }),
                  )
                  .min(1),
              }),
            )
            .min(1),
        }),
      )
      .optional(),
  };
}

const ecomItm = () =>
  z.strictObject({
    num: itemNum(1),
    itm_det: z.strictObject({
      rt: rate(),
      txval: cost(),
      iamt: cost().optional(),
      camt: cost().optional(),
      samt: cost().optional(),
      csamt: cost().optional(),
    }),
  });
const ecomInv = (amend: boolean) =>
  z.strictObject({
    inum: inum(),
    idt: date(),
    ...(amend ? { oinum: inum(), oidt: date() } : {}),
    val: totalValue(),
    pos: posForeign(),
    sply_ty: splyTy(),
    inv_typ: z.enum(["R", "DE", "SEWP", "SEWOP"]),
    flag: ecoFlag(),
    itms: z.array(ecomItm()).min(1),
  });
const atHeads = () => ({
  txval: costAt(),
  iamt: costAt().optional(),
  camt: costAt().optional(),
  samt: costAt().optional(),
  csamt: costAt().optional(),
});
const ecomRateRow = () => ({ rt: rate(), ...atHeads() });

/** Table 15 / 15A (S5 = S4 for what we emit, except `b2ca` `itms`, required in S5 only). */
export function makeEcomSections() {
  return {
    ecom: z
      .strictObject({
        b2b: z
          .array(
            z.strictObject({ stin: ctin(), rtin: ctin(), inv: z.array(ecomInv(false)).min(1) }),
          )
          .optional(),
        urp2b: z
          .array(z.strictObject({ rtin: ctin(), inv: z.array(ecomInv(false)).min(1) }))
          .optional(),
        b2c: z
          .array(
            z.strictObject({
              stin: ctin(),
              pos: pos(),
              sply_ty: splyTy(),
              flag: ecoFlag(),
              ...ecomRateRow(),
            }),
          )
          .optional(),
        urp2c: z
          .array(
            z.strictObject({ pos: pos(), sply_ty: splyTy(), flag: ecoFlag(), ...ecomRateRow() }),
          )
          .optional(),
      })
      .optional(),
    ecoma: z
      .strictObject({
        b2ba: z
          .array(z.strictObject({ stin: ctin(), rtin: ctin(), inv: z.array(ecomInv(true)).min(1) }))
          .optional(),
        urp2ba: z
          .array(z.strictObject({ rtin: ctin(), inv: z.array(ecomInv(true)).min(1) }))
          .optional(),
        b2ca: z
          .array(
            z.strictObject({
              pos: pos(),
              posItms: z
                .array(
                  z.strictObject({
                    stin: ctin(),
                    ostin: ctin(),
                    omon: omon(),
                    sply_ty: splyTy(),
                    flag: ecoFlag(),
                    itms: z.array(z.strictObject(ecomRateRow())).min(1),
                  }),
                )
                .min(1),
            }),
          )
          .optional(),
        urp2ca: z
          .array(
            z.strictObject({
              pos: pos(),
              omon: omon(),
              sply_ty: splyTy(),
              flag: ecoFlag(),
              itms: z.array(z.strictObject(ecomRateRow())).min(1),
            }),
          )
          .optional(),
      })
      .optional(),
  };
}

/** Table 14 / 14A. S5: `etin` = `#ctin`, `flag` optional; S4: `etin` loose, `flag` required. */
export function makeSupecoSections(v: "S5" | "S4") {
  const etin = () => (v === "S5" ? ctin() : z.string().regex(/^[a-zA-Z0-9._\s]+$/));
  const flag = v === "S5" ? ecoFlag().optional() : ecoFlag();
  const row = () => ({
    etin: etin(),
    suppval: costAt(),
    igst: costAt(),
    cgst: costAt(),
    sgst: costAt(),
    cess: costAt().optional(),
    flag,
  });
  const arow = () => ({ oetin: etin(), omon: omon(), ...row() });
  return {
    supeco: z
      .strictObject({
        clttx: z.array(z.strictObject(row())).optional(),
        paytx: z.array(z.strictObject(row())).optional(),
      })
      .optional(),
    supecoa: z
      .strictObject({
        clttxa: z.array(z.strictObject(arow())).optional(),
        paytxa: z.array(z.strictObject(arow())).optional(),
      })
      .optional(),
  };
}

const advItems = (amount: () => z.ZodType, rt: () => z.ZodType) =>
  z
    .array(
      z.strictObject({
        ad_amt: amount(),
        iamt: amount().optional(),
        camt: amount().optional(),
        samt: amount().optional(),
        csamt: amount().optional(),
        rt: rt(),
      }),
    )
    .min(1);
const advInvTyp = () => z.enum(["R", "RC", "DE", "SEWP", "SEWOP"]);

/** S5 v5.0 advances: objects split by party (spec §17.6). `prefix` is `at`, `txpd`, `ata` or `txpda`. */
export function advancesApi(amend: boolean) {
  const it = () => advItems(costAt, rate);
  const o = amend ? { omon: omon() } : {};
  return z
    .strictObject({
      b2b: z
        .array(
          z.strictObject({
            rtin: ctin(),
            pos: posForeign(),
            sply_ty: splyTy(),
            inv_typ: advInvTyp(),
            rchrg: yn(),
            ...(amend
              ? {
                  omon: omon(),
                  opos: posForeign(),
                  oinv_typ: advInvTyp(),
                  ortin: ctin(),
                  orchrg: yn(),
                }
              : {}),
            itms: it(),
          }),
        )
        .optional(),
      b2c: z
        .array(
          z.strictObject({
            pos: pos(),
            sply_ty: splyTy(),
            ...o,
            ...(amend ? { opos: pos() } : {}),
            itms: it(),
          }),
        )
        .optional(),
      exp: z
        .array(
          z.strictObject({
            exp_typ: z.enum(["WOPAY", "WPAY"]),
            sply_ty: splyTy(),
            ...o,
            ...(amend ? { oexp_typ: z.enum(["WOPAY", "WPAY"]) } : {}),
            itms: it(),
          }),
        )
        .optional(),
    })
    .optional();
}

/** Renames the neutral `b2b`/`b2c`/`exp` keys of {@link advancesApi} to S5's `<prefix>_b2b` … keys. */
export function advancesApiNamed(prefix: "at" | "txpd" | "ata" | "txpda") {
  const inner = advancesApi(prefix === "ata" || prefix === "txpda").unwrap();
  const shape: Record<string, z.ZodType> = {
    [`${prefix}_b2b`]: inner.shape.b2b,
    [`${prefix}_b2c`]: inner.shape.b2c,
    [`${prefix}_exp`]: inner.shape.exp,
  };
  return z.strictObject(shape).optional();
}

/** S4 / tool advances: flat rows `{ pos, sply_ty, [omon], itms }` (spec O10). */
export function advancesOffline(prefix: "at" | "txpd" | "ata" | "txpda") {
  const amend = prefix === "ata" || prefix === "txpda";
  const amount = prefix === "at" || prefix === "ata" ? costAt : cost;
  const rt = amend ? rateS4At : rate;
  const arr = z.array(
    z.strictObject({
      pos: pos(),
      sply_ty: splyTy(),
      ...(amend ? { omon: omon() } : {}),
      itms: advItems(amount, rt),
    }),
  );
  return (prefix === "txpda" ? arr.min(1) : arr).optional();
}
