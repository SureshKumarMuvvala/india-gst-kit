import { ApiSavePayloadSchema, mapApi, type ApiSavePayload } from "./api-payload.js";
import { OfflineUploadJsonSchema, mapOffline, type OfflineUploadJson } from "./offline-upload.js";
import type { Gstr1Return } from "./return-schema.js";
import { serializeGstr1, sizeIssue } from "./serialize.js";
import { issue, type Gstr1Issue, type RenderResult } from "./types.js";
import type { z } from "zod";

function finish<T extends ApiSavePayload | OfflineUploadJson>(
  schema: z.ZodType<T>,
  mapped: unknown,
): RenderResult<T> {
  const parsed = schema.safeParse(mapped);
  if (!parsed.success) {
    // Our own output failing its schema is a bug, reported rather than thrown.
    const issues: Gstr1Issue[] = parsed.error.issues.map((i) =>
      issue("SCHEMA", `own output does not match its schema: ${i.message}`, {
        path: i.path.map((p) => (typeof p === "number" ? p : String(p))),
      }),
    );
    return { ok: false, issues };
  }
  const tooLarge = sizeIssue(serializeGstr1(parsed.data));
  if (tooLarge !== undefined) return { ok: false, issues: [tooLarge] };
  return { ok: true, value: parsed.data };
}

/** Output (a): the GSTN API "Save GSTR1 data" payload, S5 v5.0. Pure; validated against its own schema. */
export function toApiSavePayload(
  ret: Gstr1Return,
  options: { header?: { version?: string; hash?: string } } = {},
): RenderResult<ApiSavePayload> {
  return finish(ApiSavePayloadSchema, mapApi(ret, options.header));
}

/** Output (b): what the official offline tool 3.2.4 writes (v4.1 shapes + its header). Pure. */
export function toOfflineUploadJson(ret: Gstr1Return): RenderResult<OfflineUploadJson> {
  return finish(OfflineUploadJsonSchema, mapOffline(ret));
}
