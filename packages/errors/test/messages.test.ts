// Spec errors §7, tests T-M1–T-M6.
import { describe, expect, it } from "vitest";
import {
  EINVOICE_EWB_ERRORS,
  EINVOICE_INV_ERRORS,
  EINVOICE_VITAL_ERRORS,
  ERROR_CATEGORIES,
  EWAYBILL_API_ERRORS,
  USER_MESSAGES_EN,
  describeError,
  type ErrorListKey,
  type OfficialErrorRow,
} from "../src/index.js";

const DATA: Record<ErrorListKey, readonly OfficialErrorRow[]> = {
  "einvoice/VITAL": EINVOICE_VITAL_ERRORS,
  "einvoice/INV": EINVOICE_INV_ERRORS,
  "einvoice/EWB": EINVOICE_EWB_ERRORS,
  "ewaybill/API": EWAYBILL_API_ERRORS,
};

const OVERRIDES = Object.entries(USER_MESSAGES_EN.codes).flatMap(([key, codes]) =>
  Object.entries(codes).map(([code, text]) => ({ key: key as ErrorListKey, code, text })),
);
const OUR_TEXTS = [...Object.values(USER_MESSAGES_EN.categories), ...OVERRIDES.map((o) => o.text)];

describe("T-M1 coverage", () => {
  it("every category has a message; every override names a listed code", () => {
    for (const c of ERROR_CATEGORIES)
      expect(USER_MESSAGES_EN.categories[c].length).toBeGreaterThan(0);
    for (const o of OVERRIDES)
      expect(
        DATA[o.key].some((r) => r.code === o.code),
        `${o.key} ${o.code}`,
      ).toBe(true);
  });
});

describe("T-M2 override rows (spec §7.2)", () => {
  it("userMessageSource is code exactly for the ten overrides", () => {
    expect(OVERRIDES.map((o) => `${o.key} ${o.code}`).sort()).toStrictEqual(
      [
        "einvoice/VITAL 1014",
        "einvoice/VITAL 3095",
        "einvoice/VITAL 3096",
        "einvoice/INV 2154",
        "einvoice/INV 2240",
        "einvoice/INV 2278",
        "einvoice/EWB 4058",
        "einvoice/EWB 4074",
        "ewaybill/API 366",
        "ewaybill/API 813",
      ].sort(),
    );
    for (const [key, rows] of Object.entries(DATA) as [
      ErrorListKey,
      readonly OfficialErrorRow[],
    ][]) {
      const [system, list] = key.split("/") as [
        "einvoice" | "ewaybill",
        "VITAL" | "INV" | "EWB" | "API",
      ];
      for (const r of rows) {
        const d = describeError(system, r.code, { list, params: ["7"] });
        const isOverride = OVERRIDES.some((o) => o.key === key && o.code === r.code);
        expect(d.userMessageSource, `${key} ${r.code}`).toBe(isOverride ? "code" : "category");
      }
    }
  });
});

describe("T-M3 no advice, no rates (spec §7.3)", () => {
  const banned = ["must pay", "liable", "penalty", "illegal", "offence", "you are required by law"];
  it.each(OUR_TEXTS)("%s", (text) => {
    expect(text).not.toMatch(/%/);
    // a placeholder is not a number we wrote
    expect(text.replace(/\{\d+\}/g, "")).not.toMatch(/rate\D{0,10}\d/i);
    expect(text).not.toContain("Standard tax Rates");
    for (const b of banned) expect(text.toLowerCase()).not.toContain(b);
  });
});

describe("T-M4 X7", () => {
  it("2240's resolution is verbatim with the note; user message has no rate", () => {
    const row = EINVOICE_INV_ERRORS.find((r) => r.code === "2240");
    const d = describeError("einvoice", "2240", { params: ["3"] });
    expect(d.officialResolution).toBe(row?.resolution);
    expect(d.officialResolution).toContain("Standard tax Rates are 0, 0.5, 1, 2, 3, 5, 12, 18, 28");
    expect(d.notes).toContain("X7-not-a-rate-list");
    expect(d.userMessage).toBe(
      "The GST rate on line 3 was not accepted by the portal. Check the rate for this item with your accountant.",
    );
    expect(d.userMessage.replace("line 3", "")).not.toMatch(/\d/);
  });
});

describe("T-M5 shape of our texts", () => {
  it.each(OUR_TEXTS)("%s", (text) => {
    expect(text.length).toBeLessThanOrEqual(200);
    const placeholders = text.match(/\{\d+\}/g) ?? [];
    expect(
      placeholders.length === 0 || text === USER_MESSAGES_EN.codes["einvoice/INV"]?.["2240"],
    ).toBe(true);
  });
});

describe("T-M6 ours, not copies", () => {
  it("no our-text contains a full official message", () => {
    // Messages of one or two words (e.g. EWB 4058 "Check") are words, not messages; skip them.
    const official = Object.values(DATA)
      .flatMap((rows) => rows.map((r) => r.message))
      .filter((m) => m.split(" ").length > 2);
    for (const text of OUR_TEXTS)
      for (const m of official) expect(text.includes(m), `${text} ⊃ ${m}`).toBe(false);
  });
});
