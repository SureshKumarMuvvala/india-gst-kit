// Source: GST Offline Tool 3.2.4 splits files at 4.7 × 1024 × 1024 bytes (offline.js:42; sources/gstr1/offline-tool/code-excerpts.md §4);
//         the portal's offline-upload limit is 5 MB (sources/gstr1/portal-faq-excerpts.txt, FAQ 43). The API limit is not
//         stated in S5 (spec Q-9), so the same limit is applied to the API payload as a conservative default.
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
import { ApiSavePayloadSchema, type ApiSavePayload } from "./api-payload.js";
import {
  OFFLINE_HASH,
  OFFLINE_VERSION,
  OfflineUploadJsonSchema,
  type OfflineUploadJson,
} from "./offline-upload.js";
import { parseWire, writeJson } from "./numbers.js";
import { issue, type Gstr1Issue } from "./types.js";
import type { z } from "zod";

export const MAX_FILE_BYTES = 4.7 * 1024 * 1024;

/** FILE_TOO_LARGE when the serialised output is over the limit. */
export function sizeIssue(text: string): Gstr1Issue | undefined {
  const bytes = Buffer.byteLength(text, "utf8");
  return bytes > MAX_FILE_BYTES
    ? issue(
        "FILE_TOO_LARGE",
        `output is ${bytes} bytes; the limit is ${Math.floor(MAX_FILE_BYTES)} (4.7 MiB)`,
      )
    : undefined;
}

function isOffline(json: ApiSavePayload | OfflineUploadJson): json is OfflineUploadJson {
  return json.version === OFFLINE_VERSION && json.hash === OFFLINE_HASH;
}

/** Compact JSON; amounts, quantities and rates are written as raw number literals from their string form. */
export function serializeGstr1(json: ApiSavePayload | OfflineUploadJson): string {
  return writeJson(json, isOffline(json) ? OfflineUploadJsonSchema : ApiSavePayloadSchema);
}

/** Exact number text is kept: 9999999999999.99 survives a round trip byte for byte. */
export function parseApiSavePayloadJson(text: string): z.ZodSafeParseResult<ApiSavePayload> {
  return parseWire(ApiSavePayloadSchema, text);
}

export function parseOfflineUploadJson(text: string): z.ZodSafeParseResult<OfflineUploadJson> {
  return parseWire(OfflineUploadJsonSchema, text);
}
