export { outwardFromGstr1, OutwardDerivationSchema, RecipientTypeSchema } from "./outward.js";
export type { OutwardDerivation, OutwardResult, RecipientType } from "./outward.js";
export { sumGstr2bRecords, Gstr2bTotalsSchema, Gstr2bGroupKeySchema } from "./gstr2b.js";
export type { Gstr2bTotals, Gstr2bGroupKey } from "./gstr2b.js";
export { assembleGstr3b, AssembleInputSchema, CallerEntrySchema } from "./assemble.js";
export type { AssembleInput, AssembleResult, CallerEntry } from "./assemble.js";
export { validateGstr3b, computeItcNet } from "./validate.js";
export { toSavePayload, serializeGstr3b, parseSavePayloadJson } from "./render.js";
export type { ParseResult } from "./render.js";
export { SavePayloadSchema } from "./save-payload.js";
export type { SavePayload } from "./save-payload.js";
export {
  parseAutoCalcJson,
  AutoCalcParsedSchema,
  GSTR3B_AUTOCALC_SCHEMA_VERSION,
} from "./autocalc.js";
export type { AutoCalc } from "./autocalc.js";
export { AutoCalcSchema } from "./autocalc-schema.js";
export { compareWithAutoCalc, CompareResultSchema, AcBlockSchema } from "./compare.js";
export type { CompareResult, CompareOptions, AcBlock } from "./compare.js";
export {
  AC_GSTR1_MAP,
  AC_NOT_COVERED,
  AC_BOX_PATH,
  AC_ITC_PAIRING,
  AC_ITC_UNPAIRED,
} from "./ac-map.js";
export type { AcMapRow } from "./ac-map.js";
export { BOX_FIELDS } from "./boxes.js";
export {
  Gstr3bReturnSchema,
  Gstr3bDraftSchema,
  TrailEntrySchema,
  AmountsSchema,
} from "./return-schema.js";
export type {
  Gstr3bReturn,
  Gstr3bDraft,
  TrailEntry,
  Amounts,
  AmountKey,
  PosRow,
  TaxHeads,
  Heads5,
} from "./return-schema.js";
export {
  Signed3bSchema,
  Unsigned3bSchema,
  PeriodSchema,
  FilerGstinSchema,
  Pos3bSchema,
  RET_PERIOD_PATTERN,
  STATE_CD_PATTERN,
  SV_GSTIN_PATTERN,
} from "./primitives.js";
export {
  BOX_IDS,
  BoxIdSchema,
  GSTR3B_ISSUE_CODES,
  Gstr3bIssueSchema,
  Gstr3bIssueCodeSchema,
} from "./types.js";
export type { BoxId, Gstr3bIssue, Gstr3bIssueCode, RenderResult } from "./types.js";

export const GSTR3B_SAVE_SCHEMA_VERSION = "7.1";
