// Error descriptions from @india-gst-kit/errors on api errors (spec errors §8, tests T-I1–T-I7).
import { describe, expect, it } from "vitest";
import {
  ErrorSystemSchema,
  SESSION_ERROR_CODES as FROM_ERRORS,
  USER_MESSAGES_EN,
  type ErrorSystem,
} from "@india-gst-kit/errors";
import {
  ApiErrorEntrySchema,
  GspErrorSchema,
  SESSION_ERROR_CODES,
  SystemSchema,
  decorateApiErrors,
  describeErrorCode,
  summarizeGspError,
  type GspError,
  type System,
} from "../src/index.js";
import {
  allText,
  codes,
  expectErr,
  expectOk,
  GSTIN,
  GSTINS,
  irnRequest,
  setup,
} from "./helpers.js";

describe("T-I1 e-invoice api error entries are decorated", () => {
  it("2150 on generateIrn", async () => {
    const s = setup();
    s.mock.on("einvoice.generateIrn", () => ({
      errors: [{ code: "2150", message: "Duplicate IRN" }],
    }));
    const e = expectErr(
      await s.client.einvoice.generateIrn({ gstin: GSTIN, request: irnRequest() }),
    );
    if (e.kind !== "api") throw new Error(`expected api, got ${e.kind}`);
    expect(e.errors).toStrictEqual([
      {
        code: "2150",
        message: "Duplicate IRN",
        system: "einvoice",
        list: "INV",
        category: "already-done",
        officialMessage: "Duplicate IRN",
        userMessage: USER_MESSAGES_EN.categories["already-done"],
        notes: [],
      },
    ]);
    expect(GspErrorSchema.safeParse(e).success).toBe(true);
    for (const entry of e.errors) expect(ApiErrorEntrySchema.safeParse(entry).success).toBe(true);
  });
  it("the op picks the list (5001 on login is VITAL)", () => {
    const [vital] = decorateApiErrors("einvoice", "einvoice.auth", [{ code: "5001" }]);
    const [inv] = decorateApiErrors("einvoice", "einvoice.generateIrn", [{ code: "5001" }]);
    expect([vital?.list, vital?.category]).toStrictEqual(["VITAL", "retry-later"]);
    expect([inv?.list, inv?.category]).toStrictEqual(["INV", "fix-data"]);
  });
  it("an unlisted code is unknown, never a throw", () => {
    expect(
      decorateApiErrors("einvoice", "einvoice.generateIrn", [{ code: "UNKNOWN" }]),
    ).toStrictEqual([
      {
        code: "UNKNOWN",
        system: "einvoice",
        list: null,
        category: "unknown",
        officialMessage: null,
        userMessage: USER_MESSAGES_EN.categories.unknown,
        notes: [],
      },
    ]);
  });
});

describe("T-I2 e-way bill codes", () => {
  it("238,240 ⇒ two entries; summary leads with auth", async () => {
    const s = setup();
    s.mock.on("ewaybill.getGstinDetails", () => ({ errors: [{ code: "238" }, { code: "240" }] }));
    const e = expectErr(
      await s.client.ewaybill.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }),
    );
    if (e.kind !== "api") throw new Error(`expected api, got ${e.kind}`);
    expect(e.errors.map((x) => [x.code, x.list, x.category])).toStrictEqual([
      ["238", "API", "auth"],
      ["240", "API", "contact-helpdesk"],
    ]);
    const sum = summarizeGspError(e);
    expect(sum.category).toBe("auth");
    expect(sum.primary?.code).toBe("238");
    expect(sum.userMessage).toBe(USER_MESSAGES_EN.categories.auth);
    expect(sum.entries.map((x) => x.code)).toStrictEqual(["238", "240"]);
  });
});

describe("T-I3 one System enum", () => {
  it("errors' system enum equals gsp's (type and runtime)", () => {
    type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    const same: Same<ErrorSystem, System> = true;
    expect(same).toBe(true);
    expect(ErrorSystemSchema.options).toStrictEqual(SystemSchema.options);
  });
});

describe("T-I4 summarizeGspError (spec §8.2)", () => {
  const text = USER_MESSAGES_EN.categories;
  const api: GspError = {
    kind: "api",
    system: "einvoice",
    op: "einvoice.generateIrn",
    errors: decorateApiErrors("einvoice", "einvoice.generateIrn", [
      { code: "2176", message: "HSN code(s)-1234 is invalid" },
      { code: "2150", message: "Duplicate IRN" },
    ]),
    httpStatus: 200,
    raw: {},
  };
  it("api ⇒ the primary entry", () => {
    const s = summarizeGspError(api);
    expect([s.category, s.primary?.code, s.userMessage]).toStrictEqual([
      "already-done",
      "2150",
      text["already-done"],
    ]);
    expect(s.entries).toHaveLength(2);
  });
  it("auth wrapping api ⇒ as api", () => {
    const login: GspError = {
      kind: "auth",
      cause: {
        kind: "api",
        system: "einvoice",
        op: "einvoice.auth",
        errors: decorateApiErrors("einvoice", "einvoice.auth", [{ code: "1008" }]),
        httpStatus: 200,
        raw: {},
      },
    };
    const s = summarizeGspError(login);
    expect([s.category, s.primary?.code, s.entries.length]).toStrictEqual(["auth", "1008", 1]);
  });
  it.each<[string, GspError, string]>([
    [
      "auth wrapping transport",
      {
        kind: "auth",
        cause: { kind: "transport", reason: "network", outcome: "not-sent", message: "x" },
      },
      "auth",
    ],
    ["validation", { kind: "validation", issues: [] }, "fix-data"],
    [
      "transport not-sent",
      { kind: "transport", reason: "network", outcome: "not-sent", message: "x" },
      "retry-later",
    ],
    [
      "transport unknown",
      { kind: "transport", reason: "timeout", outcome: "unknown", message: "x" },
      "outcome-unknown",
    ],
    ["protocol", { kind: "protocol", reason: "bad-json", message: "x" }, "integration"],
    ["crypto", { kind: "crypto", reason: "bad-sek", message: "x" }, "integration"],
    ["config", { kind: "config", reason: "no-path", message: "x" }, "integration"],
  ])("%s", (_name, error, category) => {
    const s = summarizeGspError(error);
    expect(s.category).toBe(category);
    expect(s.userMessage).toBe(text[category as keyof typeof text]);
    expect(s.primary).toBeUndefined();
    expect(s.entries).toStrictEqual([]);
  });
  it("an api error with no entries ⇒ unknown", () => {
    const s = summarizeGspError({ ...api, errors: [] });
    expect(s.category).toBe("unknown");
  });
});

describe("T-I5 deprecated describeErrorCode and a caller table", () => {
  const table = [
    { system: "einvoice" as const, code: "2150", message: "Ours", source: "s", retrieved: "r" },
  ];
  it("still looks up a caller table", () => {
    expect(describeErrorCode("einvoice", " 2150 ", table)?.message).toBe("Ours");
    expect(describeErrorCode("einvoice", "2150")).toBeUndefined();
  });
  it("errorCodeTable overrides officialMessage only", async () => {
    const s = setup({ client: { errorCodeTable: table } });
    s.mock.on("einvoice.generateIrn", () => ({
      errors: [{ code: "2150", message: "Duplicate IRN" }],
    }));
    const e = expectErr(
      await s.client.einvoice.generateIrn({ gstin: GSTIN, request: irnRequest() }),
    );
    expect(e).toMatchObject({
      kind: "api",
      errors: [{ code: "2150", officialMessage: "Ours", category: "already-done", list: "INV" }],
    });
  });
  it("an invalid errorCodeTable throws (programmer error)", () => {
    expect(() =>
      setup({ client: { errorCodeTable: [{ code: "1" }] as unknown as typeof table } }),
    ).toThrow(TypeError);
  });
});

describe("T-I6 redaction of decorated entries", () => {
  it("a token echoed in the message is redacted", async () => {
    const s = setup();
    await s.client.einvoice.login({ gstin: GSTIN });
    const tok = [...s.mock.tokens.keys()][0] ?? "";
    s.mock.on("einvoice.getGstinDetails", () => ({
      errors: [{ code: "1005", message: `Invalid Token ${tok}` }],
    }));
    const e = expectErr(
      await s.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh }),
    );
    expect(tok.length).toBeGreaterThan(5);
    expect(allText(e)).not.toContain(tok);
    expect(e).toMatchObject({ kind: "api", errors: [{ code: "1005", category: "auth" }] });
  });
});

describe("T-I7 SESSION_ERROR_CODES", () => {
  it("is the errors package's constant", () => {
    expect(SESSION_ERROR_CODES).toBe(FROM_ERRORS);
  });
  it("authErrorCodes: SESSION_ERROR_CODES re-logs in on 1005 for a GET", async () => {
    const s = setup({ client: { authErrorCodes: SESSION_ERROR_CODES } });
    await s.client.einvoice.login({ gstin: GSTIN });
    s.mock.on("einvoice.getGstinDetails", () => {
      s.mock.handlers.delete("einvoice.getGstinDetails");
      return { errors: [{ code: "1005", message: "Invalid Token" }] };
    });
    const r = await s.client.einvoice.getGstinDetails({ gstin: GSTIN, target: GSTINS.recipientMh });
    expectOk(r);
    expect(codes(r)).toContain("SESSION_RENEWED");
    expect(s.mock.count("einvoice.auth")).toBe(2);
    expect(s.mock.count("einvoice.getGstinDetails")).toBe(2);
  });
});
