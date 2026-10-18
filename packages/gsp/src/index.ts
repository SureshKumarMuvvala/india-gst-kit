export { createGspClient } from "./client.js";
export type {
  GspClient,
  GspClientConfig,
  GspLogEvent,
  LoginInfo,
  SignedEinvoice,
} from "./client.js";
export {
  NIC_DEFAULT_PATHS,
  NIC_EINVOICE_HEADERS,
  NIC_EINVOICE_HEADERS_JAVA_SAMPLE,
  NIC_EWAYBILL_HEADERS,
  NicDirectOptionsSchema,
  buildLoginPlaintext,
  createNicDirectProvider,
  nicAuthStrategy,
  nicEnvelopeDecoder,
  nicPayloadCodec,
} from "./nic.js";
export type { NicDirectOptions } from "./nic.js";
export { HeaderNameMapSchema, OPERATION_IDS } from "./provider.js";
export type {
  AuthStrategy,
  CredentialsProvider,
  DecodedResponse,
  EndpointSpec,
  EnvelopeDecoder,
  GspProvider,
  HeaderContext,
  HeaderNameMap,
  HttpMethod,
  LoginContext,
  LoginData,
  NicCredentials,
  OperationId,
  PayloadCodec,
  Session,
  SessionPolicy,
} from "./provider.js";
export {
  aesEcbDecrypt,
  aesEcbEncrypt,
  decodeBase64,
  decodePayload,
  decodeRekResponse,
  decryptSek,
  encodeBase64,
  encodePayload,
  generateAppKey,
  plaintextToJson,
  rsaEncryptLogin,
} from "./crypto.js";
export type { AppKey, CryptoResult, PayloadForm, RekDecoded } from "./crypto.js";
export { createMemorySessionStore, REFRESH_WINDOW_MS } from "./session.js";
export type { SessionStore } from "./session.js";
export { decodeNicEnvelope, parseEinvoiceErrors, parseEwbErrors } from "./envelope.js";
export type { Envelope } from "./envelope.js";
export {
  ApiErrorEntrySchema,
  GspErrorSchema,
  SystemSchema,
  failResult,
  okResult,
} from "./errors.js";
export type { ApiErrorEntry, GspError, GspResult, System } from "./errors.js";
export { GspIssueSchema } from "./issues.js";
export type { GspIssue } from "./issues.js";
export { Secret, REDACTED } from "./secret.js";
export type { SecretInput } from "./secret.js";
export { ErrorCodeInfoSchema, describeErrorCode } from "./error-codes.js";
export type { ErrorCodeInfo } from "./error-codes.js";
export { GSTIN_STATUSES, GstinDetailsSchema, normaliseGstinDetails } from "./gstin-details.js";
export type { GstinDetails } from "./gstin-details.js";
export {
  precheckCancelEwb,
  precheckCancelIrn,
  precheckEwbActive,
  precheckExtendValidity,
  precheckIrnLookup,
  precheckRejectEwb,
} from "./precheck.js";
export type { EwbRole } from "./precheck.js";
export { parsePortalDateTime } from "./datetime.js";
export {
  CancelIrnRequestSchema,
  CancelIrnResponseSchema,
  EinvoiceDetailsSchema,
  EwbByIrnDetailsSchema,
  GenerateIrnResponseSchema,
  IrnByDocQuerySchema,
  validateCancelIrnRequest,
} from "./schemas/einvoice.js";
export type {
  CancelIrnRequest,
  CancelIrnResponse,
  EinvoiceDetails,
  EwbByIrnDetails,
  GenerateIrnResponse,
  IrnByDocQuery,
} from "./schemas/einvoice.js";
export {
  CancelEwbRequestSchema,
  CancelEwbResponseSchema,
  ConsolidatedEwbRequestSchema,
  ConsolidatedEwbResponseSchema,
  ExtendValidityRequestSchema,
  ExtendValidityResponseSchema,
  RejectEwbRequestSchema,
  RejectEwbResponseSchema,
  UpdateTransporterRequestSchema,
  UpdateTransporterResponseSchema,
  UpdateVehicleRequestSchema,
  UpdateVehicleResponseSchema,
  validateCancelEwbRequest,
  validateConsolidatedEwbRequest,
  validateExtendValidityRequest,
  validateRejectEwbRequest,
  validateUpdateTransporterRequest,
  validateUpdateVehicleRequest,
} from "./schemas/ewaybill.js";
export type {
  CancelEwbRequest,
  CancelEwbResponse,
  ConsolidatedEwbRequest,
  ConsolidatedEwbResponse,
  ExtendValidityRequest,
  ExtendValidityResponse,
  RejectEwbRequest,
  RejectEwbResponse,
  UpdateTransporterRequest,
  UpdateTransporterResponse,
  UpdateVehicleRequest,
  UpdateVehicleResponse,
} from "./schemas/ewaybill.js";
export type { RequestValidation } from "./validate.js";
export { EINVOICE_CANCEL_REASONS } from "./codes/einvoice-cancel-reasons.js";
export { EWB_CANCEL_REASONS } from "./codes/ewb-cancel-reasons.js";
export { EWB_VEHICLE_REASONS } from "./codes/ewb-vehicle-reasons.js";
export { EWB_EXTENSION_REASONS } from "./codes/ewb-extension-reasons.js";
export {
  EWB_CONSIGNMENT_STATUS,
  EWB_TRANSIT_TYPES,
  EWB_TRANSPORT_MODES,
} from "./codes/ewb-consignment.js";
