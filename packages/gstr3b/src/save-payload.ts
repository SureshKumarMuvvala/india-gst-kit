// Source: https://developer.gst.gov.in/apiportal/taxpayer/returns — "GSTR3B – Save GSTR3B data" (2269) v7.1, Draft,
//         published 23-03-2026 — sources/gstr3b/GSTR3B - Save GSTR3B data request_schema v7.1.json (SV)
// Retrieved: 2026-10-18
// Status: UNVERIFIED — needs CA
// A Zod transcription of every SV constraint, in SV's property order. Stricter than SV in one way only: unknown keys
// are rejected at every level (SV forbids them only in `inter_sup` and `itc_net`; spec §13 C3, D-H3).
import { z } from "zod";
import { MAX, MIN, markNumber, wireMoney } from "./numbers.js";
import { RET_PERIOD_PATTERN, STATE_CD_PATTERN, SV_GSTIN_PATTERN } from "./primitives.js";

/** #negVal: −9999999999999.99 … 9999999999999.99. */
const negVal = () => markNumber(wireMoney(MIN, MAX));
/** #nonEmptyCost: 0 … 9999999999999.99. */
const nonEmptyCost = () => markNumber(wireMoney("0", MAX));
/** #nonEmptyCostITCNet: −9999999999999.99 … 9999999999999.99. */
const itcNet = () => markNumber(wireMoney(MIN, MAX));

const stateCd = z.string().length(2).regex(STATE_CD_PATTERN);
const posRow = z.strictObject({ iamt: negVal(), pos: stateCd, txval: negVal() });

const fiveHeads = () =>
  z.strictObject({
    txval: negVal(),
    iamt: negVal(),
    camt: negVal(),
    samt: negVal(),
    csamt: negVal(),
  });

export const SavePayloadSchema = z.strictObject({
  gstin: z.string().length(15).regex(SV_GSTIN_PATTERN),
  ret_period: z.string().regex(RET_PERIOD_PATTERN),
  sup_details: z
    .strictObject({
      osup_det: fiveHeads(),
      osup_zero: z.strictObject({ txval: negVal(), iamt: negVal(), csamt: negVal() }),
      osup_nil_exmp: z.strictObject({ txval: negVal() }),
      isup_rev: fiveHeads(),
      osup_nongst: z.strictObject({ txval: negVal() }),
    })
    .partial()
    .optional(),
  inter_sup: z
    .strictObject({
      comp_details: z.array(posRow),
      uin_details: z.array(posRow),
      unreg_details: z.array(posRow),
    })
    .partial()
    .optional(),
  eco_dtls: z
    .strictObject({
      eco_sup: fiveHeads(),
      eco_reg_sup: z.strictObject({ txval: negVal() }),
    })
    .partial()
    .optional(),
  itc_elg: z
    .strictObject({
      itc_avl: z.array(
        z.strictObject({
          camt: negVal(),
          samt: negVal(),
          csamt: negVal(),
          iamt: negVal(),
          ty: z.enum(["IMPG", "IMPS", "ISRC", "ISD", "OTH"]),
        }),
      ),
      itc_rev: z.array(
        z.strictObject({
          camt: nonEmptyCost(),
          csamt: nonEmptyCost(),
          iamt: nonEmptyCost(),
          samt: nonEmptyCost(),
          ty: z.enum(["RUL", "OTH"]),
        }),
      ),
      itc_net: z.strictObject({ camt: itcNet(), csamt: itcNet(), iamt: itcNet(), samt: itcNet() }),
      // SV oneOf: OTH amounts are #negVal, RUL amounts #nonEmptyCost.
      itc_inelg: z.array(
        z.discriminatedUnion("ty", [
          z.strictObject({
            ty: z.literal("OTH"),
            camt: negVal(),
            csamt: negVal(),
            iamt: negVal(),
            samt: negVal(),
          }),
          z.strictObject({
            ty: z.literal("RUL"),
            camt: nonEmptyCost(),
            csamt: nonEmptyCost(),
            iamt: nonEmptyCost(),
            samt: nonEmptyCost(),
          }),
        ]),
      ),
    })
    .partial()
    .optional(),
  inward_sup: z
    .strictObject({
      isup_details: z.array(
        z.strictObject({
          inter: nonEmptyCost(),
          intra: nonEmptyCost(),
          ty: z.enum(["GST", "NONGST"]),
        }),
      ),
    })
    .optional(),
  intr_ltfee: z
    .strictObject({
      intr_details: z.strictObject({
        camt: nonEmptyCost(),
        csamt: nonEmptyCost(),
        iamt: nonEmptyCost(),
        samt: nonEmptyCost(),
      }),
    })
    .optional(),
});
export type SavePayload = z.infer<typeof SavePayloadSchema>;
