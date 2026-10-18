import { describe, expect, it } from "vitest";
import {
  parsePortalDateTime,
  precheckCancelEwb,
  precheckCancelIrn,
  precheckEwbActive,
  precheckExtendValidity,
  precheckIrnLookup,
  precheckRejectEwb,
} from "../src/index.js";
import { codes, expectOk, GSTIN, HOUR, MIN, setup } from "./helpers.js";

const gen = "2026-10-18 10:00:00"; // IST
const genEwb = "18/10/2026 10:00:00 AM";
const t = parsePortalDateTime(gen) ?? 0;
const c = (ws: { code: string }[]) => ws.map((w) => w.code);
const DAY = 24 * HOUR;

describe("parsePortalDateTime (IST, D-G8)", () => {
  it("reads both portal formats as IST", () => {
    expect(t).toBe(Date.UTC(2026, 9, 18, 4, 30));
    expect(parsePortalDateTime(genEwb)).toBe(t);
    expect(parsePortalDateTime("18/10/2026 12:00:00 AM")).toBe(Date.UTC(2026, 9, 17, 18, 30));
    expect(parsePortalDateTime("18/10/2026 12:00:00 PM")).toBe(Date.UTC(2026, 9, 18, 6, 30));
    expect(parsePortalDateTime("21/05/2018 23:59:00 PM")).toBe(Date.UTC(2018, 4, 21, 18, 29));
    expect(parsePortalDateTime("17/09/2017 12.00:00 PM")).toBe(Date.UTC(2017, 8, 17, 6, 30));
    expect(parsePortalDateTime("25/09/2018  10:30:00 AM")).toBe(Date.UTC(2018, 8, 25, 5, 0));
  });
  it("rejects nonsense", () => {
    for (const s of [
      "",
      "2026-02-30 10:00:00",
      "16 / 09 / 2017 10: 30: 00 AM",
      "32/01/2026 10:00:00",
      "2026-10-18T10:00:00",
    ]) {
      expect(parsePortalDateTime(s)).toBeUndefined();
    }
  });
});

describe("pre-checks: boundary not warned, one minute past warned (G6, D-G15)", () => {
  it("PC1 cancel IRN 24 h; active EWB", () => {
    expect(precheckCancelIrn({ ackDt: gen }, t + DAY)).toStrictEqual([]);
    expect(c(precheckCancelIrn({ ackDt: gen }, t + DAY + MIN))).toStrictEqual([
      "IRN_CANCEL_WINDOW_PASSED",
    ]);
    expect(c(precheckCancelIrn({ activeEwbExists: true }, t))).toStrictEqual([
      "IRN_HAS_ACTIVE_EWB",
    ]);
  });
  it("PC2 IRN lookup 72 h", () => {
    expect(precheckIrnLookup({ ackDt: gen }, t + 3 * DAY)).toStrictEqual([]);
    expect(c(precheckIrnLookup({ ackDt: gen }, t + 3 * DAY + MIN))).toStrictEqual([
      "IRN_LOOKUP_WINDOW_PASSED",
    ]);
  });
  it("PC3 cancel EWB 24 h, generator only", () => {
    expect(precheckCancelEwb({ ewbDate: genEwb, role: "generator" }, t + DAY)).toStrictEqual([]);
    expect(
      c(precheckCancelEwb({ ewbDate: genEwb, role: "transporter" }, t + DAY + MIN)),
    ).toStrictEqual(["EWB_CANCEL_WINDOW_PASSED", "EWB_CANCEL_NOT_GENERATOR"]);
  });
  it("PC4 reject 72 h, not by the generator", () => {
    expect(precheckRejectEwb({ ewbDate: genEwb, role: "other-party" }, t + 3 * DAY)).toStrictEqual(
      [],
    );
    expect(c(precheckRejectEwb({ ewbDate: genEwb }, t + 3 * DAY + MIN))).toStrictEqual([
      "EWB_REJECT_WINDOW_PASSED",
    ]);
    expect(c(precheckRejectEwb({ role: "generator" }, t))).toStrictEqual([
      "EWB_REJECT_BY_GENERATOR",
    ]);
  });
  it("PC5 extend ±8 h around expiry, 360 days, role", () => {
    const valid = "18/10/2026 11:59:00 PM";
    const v = parsePortalDateTime(valid) ?? 0;
    expect(precheckExtendValidity({ validUpto: valid }, v - 8 * HOUR)).toStrictEqual([]);
    expect(precheckExtendValidity({ validUpto: valid }, v + 8 * HOUR)).toStrictEqual([]);
    expect(c(precheckExtendValidity({ validUpto: valid }, v - 8 * HOUR - MIN))).toStrictEqual([
      "EWB_EXTEND_OUTSIDE_WINDOW",
    ]);
    expect(c(precheckExtendValidity({ validUpto: valid }, v + 8 * HOUR + MIN))).toStrictEqual([
      "EWB_EXTEND_OUTSIDE_WINDOW",
    ]);
    expect(precheckExtendValidity({ ewbDate: genEwb }, t + 360 * DAY)).toStrictEqual([]);
    expect(c(precheckExtendValidity({ ewbDate: genEwb }, t + 360 * DAY + MIN))).toStrictEqual([
      "EWB_EXTEND_BEYOND_360_DAYS",
    ]);
    expect(c(precheckExtendValidity({ role: "other-party" }, t))).toStrictEqual([
      "EWB_EXTEND_ROLE",
    ]);
    expect(precheckExtendValidity({ role: "transporter" }, t)).toStrictEqual([]);
  });
  it("PC6 active and valid", () => {
    expect(precheckEwbActive({ validUpto: genEwb, status: "ACT" }, t)).toStrictEqual([]);
    expect(c(precheckEwbActive({ validUpto: genEwb, status: "CNL" }, t + MIN))).toStrictEqual([
      "EWB_VALIDITY_EXPIRED",
      "EWB_CANCELLED",
    ]);
  });
  it("an unparseable date warns; no context ⇒ no warnings", () => {
    expect(c(precheckCancelIrn({ ackDt: "yesterday" }, t))).toStrictEqual([
      "PRECHECK_DATE_UNPARSEABLE",
    ]);
    expect(precheckExtendValidity({}, t)).toStrictEqual([]);
  });
  it("pre-check warnings never stop the request", async () => {
    const s = setup();
    s.clock.t = t + 5 * DAY;
    const r = await s.client.einvoice.cancelIrn({
      gstin: GSTIN,
      request: { Irn: "c".repeat(64), CnlRsn: "4", CnlRem: "Others" },
      context: { ackDt: gen, activeEwbExists: true },
    });
    expectOk(r);
    expect(codes(r)).toStrictEqual(["IRN_CANCEL_WINDOW_PASSED", "IRN_HAS_ACTIVE_EWB"]);
    expect(s.mock.count("einvoice.cancelIrn")).toBe(1);
  });
});
