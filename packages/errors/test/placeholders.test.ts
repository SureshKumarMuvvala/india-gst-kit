// Spec errors §5.3, tests T-P1–T-P7.
import { describe, expect, it } from "vitest";
import {
  EINVOICE_EWB_ERRORS,
  EINVOICE_INV_ERRORS,
  EINVOICE_VITAL_ERRORS,
  EWAYBILL_API_ERRORS,
  USER_MESSAGES_EN,
  describeError,
  fillPlaceholders,
  sanitizeText,
} from "../src/index.js";

describe("T-P1 one placeholder", () => {
  it("INV 2176", () => {
    expect(describeError("einvoice", "2176", { params: ["1234"] }).officialMessage).toBe(
      "HSN code(s)-1234 is invalid",
    );
  });
});

describe("T-P2 by index, any order", () => {
  it("INV 3039 {1} … {0} … {2}", () => {
    const d = describeError("einvoice", "3039", { params: ["Buyer", "560001", "29"] });
    expect(d.officialMessage).toBe(
      "Pincode -560001 of Buyer does not belong to his/her State - 29",
    );
    expect(d.notes).toStrictEqual([]);
  });
});

describe("T-P3 safe values", () => {
  it("no re-expansion", () => {
    expect(fillPlaceholders("a {0} b {1}", ["{1}", "x"]).text).toBe("a {1} b x");
  });
  it("control and bidi characters removed, whitespace collapsed", () => {
    const rlo = String.fromCodePoint(0x202e);
    const rlm = String.fromCodePoint(0x200f);
    expect(fillPlaceholders("[{0}]", [`a${rlo}b\u0007c\n\n d${rlm}`]).text).toBe("[abc d]");
    expect(sanitizeText("\u0085x\u009f", 10)).toBe("x");
  });
  it("cut at 100 with …", () => {
    const text = fillPlaceholders("{0}", ["y".repeat(300)]).text;
    expect(text).toBe(`${"y".repeat(100)}…`);
    expect(fillPlaceholders("{0}", ["y".repeat(100)]).text).toBe("y".repeat(100));
  });
});

describe("T-P4 missing params", () => {
  it("literal kept, note set, user message has no placeholder", () => {
    const d = describeError("einvoice", "2240");
    expect(d.officialMessage).toBe(
      "For Sl. No {0}, GST rate of tax is incorrect or not as notified",
    );
    expect(d.notes).toContain("missing-params");
    expect(d.userMessage).toBe(USER_MESSAGES_EN.categories["fix-data"]);
    expect(d.userMessageSource).toBe("category");
    expect(d.userMessage).not.toContain("{");
  });
  it("extra params are ignored", () => {
    expect(fillPlaceholders("{0}", ["a", "b"])).toStrictEqual({ text: "a", missing: false });
    expect(fillPlaceholders("{1}", ["a"])).toStrictEqual({ text: "{1}", missing: true });
  });
});

describe("T-P5 malformed placeholder (X8)", () => {
  it("EWB 4074 {0) is literal; override message", () => {
    const d = describeError("einvoice", "4074", { params: ["2"] });
    expect(d.officialMessage).toBe("Ship-to GSTIN is mandatory for the transaction type {0)");
    expect(d.notes).toContain("X8-malformed-placeholder");
    expect(d.notes).not.toContain("missing-params");
    expect(d.userMessage).toBe("A ship-to GSTIN is required for this transaction type.");
    expect(d.userMessageSource).toBe("code");
  });
  it("only 4074 is malformed in the data", () => {
    const flagged = [
      ...EINVOICE_VITAL_ERRORS.map((r) => ["einvoice", r.code] as const),
      ...EINVOICE_INV_ERRORS.map((r) => ["einvoice", r.code] as const),
      ...EINVOICE_EWB_ERRORS.map((r) => ["einvoice", r.code] as const),
      ...EWAYBILL_API_ERRORS.map((r) => ["ewaybill", r.code] as const),
    ].filter(([s, c]) => describeError(s, c).notes.includes("X8-malformed-placeholder"));
    expect(flagged).toStrictEqual([["einvoice", "4074"]]);
  });
});

describe("T-P6 template is verbatim", () => {
  it("with and without params", () => {
    for (const r of EINVOICE_INV_ERRORS) {
      expect(
        describeError("einvoice", r.code, { list: "INV", params: ["P", "Q", "R"] })
          .officialMessageTemplate,
      ).toBe(r.message);
    }
  });
});

describe("T-P7 returnedMessage", () => {
  it("cut at 500 with …", () => {
    const d = describeError("einvoice", "2150", { returnedMessage: "z".repeat(600) });
    expect(d.returnedMessage).toBe(`${"z".repeat(500)}…`);
  });
  it("empty after cleaning ⇒ null", () => {
    expect(
      describeError("einvoice", "2150", { returnedMessage: " \u0000 " }).returnedMessage,
    ).toBeNull();
  });
});
