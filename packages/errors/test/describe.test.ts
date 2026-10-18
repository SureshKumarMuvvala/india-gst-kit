// Spec errors §5, tests T-L1–T-L9.
import { describe, expect, it } from "vitest";
import {
  EINVOICE_EWB_ERRORS,
  EINVOICE_INV_ERRORS,
  EINVOICE_VITAL_ERRORS,
  ERROR_LIST_SOURCES,
  EWAYBILL_API_ERRORS,
  ErrorDescriptionSchema,
  USER_MESSAGES_EN,
  describeError,
  describeErrors,
  listOrderForOp,
  type ErrorListId,
  type ErrorListKey,
  type ErrorSystem,
} from "../src/index.js";

describe("T-L1 a known code", () => {
  it("einvoice 2150 ⇒ INV, already-done, verbatim text, source", () => {
    const d = describeError("einvoice", "2150");
    expect(d).toMatchObject({
      system: "einvoice",
      list: "INV",
      code: "2150",
      known: true,
      category: "already-done",
      officialMessage: "Duplicate IRN",
      officialMessageTemplate: "Duplicate IRN",
      userMessage: USER_MESSAGES_EN.categories["already-done"],
      userMessageSource: "category",
      otherLists: [],
      notes: [],
      returnedMessage: null,
    });
    const row = EINVOICE_INV_ERRORS.find((r) => r.code === "2150");
    expect(d.officialReason).toBe(row?.reason);
    expect(d.officialResolution).toBe(row?.resolution);
    expect(d.source).toStrictEqual({
      url: "https://einvoice1.gst.gov.in/others/geterrorcodes/INV",
      retrieved: "2026-10-18",
      status: "UNVERIFIED — needs CA",
    });
  });
  it("a row without reason/resolution ⇒ null", () => {
    const d = describeError("ewaybill", "238");
    expect(d.officialReason).toBeNull();
    expect(d.officialResolution).toBeNull();
    expect(d.category).toBe("auth");
  });
});

describe("T-L2 an explicit list", () => {
  it("5001 by list", () => {
    expect(describeError("einvoice", "5001", { list: "VITAL" })).toMatchObject({
      list: "VITAL",
      category: "retry-later",
    });
    expect(describeError("einvoice", "5001", { list: "INV" })).toMatchObject({
      list: "INV",
      category: "fix-data",
    });
  });
  it("looks only in that list", () => {
    expect(describeError("einvoice", "2150", { list: "VITAL" }).known).toBe(false);
  });
  it("a list of the other system is a programmer error", () => {
    expect(() => describeError("einvoice", "100", { list: "API" })).toThrow(TypeError);
    expect(() => describeError("ewaybill", "100", { list: "INV" })).toThrow(TypeError);
    expect(() => describeError("gstr1" as ErrorSystem, "100")).toThrow(TypeError);
  });
});

describe("T-L3 list order per op (spec §5.2)", () => {
  it("op groups", () => {
    for (const op of ["einvoice.auth", "einvoice.getGstinDetails", "einvoice.syncGstinDetails"])
      expect(listOrderForOp("einvoice", op)).toStrictEqual(["VITAL", "INV", "EWB"]);
    for (const op of [
      "einvoice.generateIrn",
      "einvoice.cancelIrn",
      "einvoice.getEinvoiceByIrn",
      "einvoice.getIrnByDocDetails",
    ])
      expect(listOrderForOp("einvoice", op)).toStrictEqual(["INV", "VITAL", "EWB"]);
    for (const op of ["einvoice.getEwbByIrn", "einvoice.generateEwbByIrn"])
      expect(listOrderForOp("einvoice", op)).toStrictEqual(["EWB", "INV", "VITAL"]);
    expect(listOrderForOp("einvoice")).toStrictEqual(["INV", "VITAL", "EWB"]);
    expect(listOrderForOp("einvoice", "einvoice.other")).toStrictEqual(["INV", "VITAL", "EWB"]);
  });
  it("5001 and 4001 follow the op; otherLists lists the rest", () => {
    const auth = describeError("einvoice", "5001", { op: "einvoice.auth" });
    expect(auth).toMatchObject({ list: "VITAL", category: "retry-later" });
    expect(auth.otherLists.map((o) => o.list)).toStrictEqual(["INV"]);
    expect(auth.notes).toStrictEqual(["X1-in-other-lists"]);
    expect(describeError("einvoice", "5001", { op: "einvoice.generateIrn" })).toMatchObject({
      list: "INV",
      category: "fix-data",
    });
    const ewb = describeError("einvoice", "4001", { op: "einvoice.generateEwbByIrn" });
    expect(ewb.list).toBe("EWB");
    expect(ewb.otherLists).toStrictEqual([
      { list: "INV", officialMessage: "Error ocurred while creating Eway Bill" },
    ]);
  });
});

describe("T-L4 no op/list", () => {
  it("multi-list code ⇒ INV first, list-guessed", () => {
    const d = describeError("einvoice", "3029");
    expect(d.list).toBe("INV");
    expect(d.notes).toContain("list-guessed");
    expect(d.notes).toContain("X1-in-other-lists");
  });
  it("single-list code ⇒ no note", () => {
    expect(describeError("einvoice", "1005").notes).toStrictEqual([]);
  });
});

describe("T-L5 systems never mix (X2)", () => {
  it("unknown in the other system", () => {
    expect(describeError("ewaybill", "2150")).toMatchObject({ known: false, category: "unknown" });
    expect(describeError("einvoice", "105")).toMatchObject({ known: false, category: "unknown" });
  });
});

describe("T-L6 unknown codes", () => {
  it.each(["99999", "", "  ", "UNKNOWN"])("%j ⇒ unknown, no throw", (code) => {
    const d = describeError("einvoice", code, { returnedMessage: " some\ttext\u0000 " });
    expect(d).toStrictEqual({
      system: "einvoice",
      list: null,
      code: code.trim(),
      known: false,
      category: "unknown",
      officialMessage: null,
      officialMessageTemplate: null,
      officialReason: null,
      officialResolution: null,
      returnedMessage: "some text",
      userMessage: USER_MESSAGES_EN.categories.unknown,
      userMessageSource: "category",
      otherLists: [],
      notes: [],
      source: null,
    });
  });
});

describe("T-L7 code matching", () => {
  it("trims ASCII whitespace only; no numeric normalisation", () => {
    expect(describeError("einvoice", " 2150 \n").known).toBe(true);
    expect(describeError("einvoice", "3109").known).toBe(false);
    expect(describeError("einvoice", "02150").known).toBe(false);
    expect(describeError("einvoice", " 2150").known).toBe(false);
  });
  it("_3109 ⇒ VITAL, throttled, X3 note", () => {
    expect(describeError("einvoice", "_3109")).toMatchObject({
      list: "VITAL",
      category: "throttled",
      notes: ["X3-underscore-code"],
    });
  });
});

describe("T-L8 ewaybill ignores op", () => {
  it("same result with and without op", () => {
    expect(describeError("ewaybill", "604", { op: "einvoice.generateIrn" })).toStrictEqual(
      describeError("ewaybill", "604"),
    );
    expect(listOrderForOp("ewaybill", "einvoice.auth")).toStrictEqual(["API"]);
  });
});

describe("T-L9 every result parses", () => {
  const all: [ErrorSystem, ErrorListId, string][] = [
    ...EINVOICE_VITAL_ERRORS.map(
      (r) => ["einvoice", "VITAL", r.code] as [ErrorSystem, ErrorListId, string],
    ),
    ...EINVOICE_INV_ERRORS.map(
      (r) => ["einvoice", "INV", r.code] as [ErrorSystem, ErrorListId, string],
    ),
    ...EINVOICE_EWB_ERRORS.map(
      (r) => ["einvoice", "EWB", r.code] as [ErrorSystem, ErrorListId, string],
    ),
    ...EWAYBILL_API_ERRORS.map(
      (r) => ["ewaybill", "API", r.code] as [ErrorSystem, ErrorListId, string],
    ),
  ];
  it("608 codes, each by its list, plus unknowns", () => {
    expect(all).toHaveLength(608);
    for (const [system, list, code] of all) {
      const d = describeError(system, code, { list });
      expect(ErrorDescriptionSchema.safeParse(d).success, `${list} ${code}`).toBe(true);
      expect(d.known).toBe(true);
      expect(d.source?.url).toBe(ERROR_LIST_SOURCES[`${system}/${list}` as ErrorListKey].url);
    }
    expect(ErrorDescriptionSchema.safeParse(describeError("ewaybill", "x")).success).toBe(true);
  });
  it("describeErrors passes message as returnedMessage", () => {
    const ds = describeErrors(
      "einvoice",
      [{ code: "2150", message: "Duplicate IRN" }, { code: "1" }],
      {
        op: "einvoice.generateIrn",
      },
    );
    expect(ds.map((d) => [d.code, d.returnedMessage, d.category])).toStrictEqual([
      ["2150", "Duplicate IRN", "already-done"],
      ["1", null, "unknown"],
    ]);
  });
});
