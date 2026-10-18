export {
  ERROR_CATEGORIES,
  ErrorCategorySchema,
  ErrorDescriptionSchema,
  ErrorListIdSchema,
  ErrorListKeySchema,
  ErrorListSourceSchema,
  ErrorNoteSchema,
  ErrorSystemSchema,
  LIST_IDS_BY_SYSTEM,
  OfficialErrorRowSchema,
} from "./schemas.js";
export type {
  ErrorCategory,
  ErrorDescription,
  ErrorListId,
  ErrorListKey,
  ErrorListSource,
  ErrorNote,
  ErrorSystem,
  OfficialErrorRow,
} from "./schemas.js";
export { EINVOICE_VITAL_ERRORS } from "./data/einvoice-vital.js";
export { EINVOICE_INV_ERRORS } from "./data/einvoice-inv.js";
export { EINVOICE_EWB_ERRORS } from "./data/einvoice-ewb.js";
export { EWAYBILL_API_ERRORS } from "./data/ewaybill-api.js";
export { ERROR_LIST_SOURCES } from "./data/sources.js";
export { CATEGORY_ASSIGNMENTS, ERROR_CATEGORY_BY_CODE } from "./categories.js";
export { CODE_NOTES, USER_MESSAGES_EN } from "./messages.js";
export type { UserMessages } from "./messages.js";
export { SESSION_ERROR_CODES } from "./session-codes.js";
export {
  fillPlaceholders,
  PARAM_MAX_LENGTH,
  RETURNED_MESSAGE_MAX_LENGTH,
  sanitizeText,
} from "./placeholders.js";
export {
  CATEGORY_PRECEDENCE,
  describeError,
  describeErrors,
  listOrderForOp,
  primaryError,
} from "./describe.js";
export type { DescribeErrorOptions } from "./describe.js";
