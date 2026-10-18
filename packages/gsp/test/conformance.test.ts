// Conformance with the official samples (spec §12.7, G7). Each decrypted "data" sample is read from sources/ and
// run through our schema; the test asserts the EXACT outcome, including the samples' own defects.
import { readFileSync } from "node:fs";
import { isValidGstin } from "@india-gst-kit/model";
import { describe, expect, it } from "vitest";
import {
  CancelEwbResponseSchema,
  CancelIrnResponseSchema,
  ConsolidatedEwbResponseSchema,
  EINVOICE_CANCEL_REASONS,
  EinvoiceDetailsSchema,
  EWB_CANCEL_REASONS,
  EwbByIrnDetailsSchema,
  ExtendValidityResponseSchema,
  normaliseGstinDetails,
  RejectEwbResponseSchema,
  UpdateTransporterResponseSchema,
  UpdateVehicleResponseSchema,
  validateCancelEwbRequest,
  validateCancelIrnRequest,
  validateConsolidatedEwbRequest,
  validateExtendValidityRequest,
  validateRejectEwbRequest,
  validateUpdateTransporterRequest,
  validateUpdateVehicleRequest,
} from "../src/index.js";
import { parseJsonAsStrings, parseResponse } from "../src/wire.js";
import { omit } from "./helpers.js";

const root = new URL("../../../sources/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

/** The first balanced {...} after `marker` in a source file, as text. */
function sampleText(path: string, marker: string): string {
  const text = read(path);
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`marker not found in ${path}: ${marker}`);
  const start = text.indexOf("{", at + marker.length);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error("unbalanced sample");
}

function sample(path: string, marker: string, fix?: (t: string) => string): unknown {
  const t = sampleText(path, marker);
  const r = parseJsonAsStrings(fix === undefined ? t : fix(t));
  if (!r.ok) throw new Error(`sample is not JSON: ${path}`);
  return r.value;
}

const EI = "einvoice/api/";
const EW = "ewaybill/api/";
const errorPaths = (r: {
  issues: { severity: string; path?: (string | number)[] | undefined; code: string }[];
}) =>
  r.issues
    .filter((i) => i.severity === "error")
    .map((i) => `${i.code}:${(i.path ?? []).join(".")}`);

describe("request samples", () => {
  it('EI-CNL fails only on CnlRsn "1 " (trailing space)', () => {
    const s = sample(
      `${EI}v1.03-cancel-irn.txt`,
      'JSON corresponds to the "Data" element of Cancel E-Invoice Request above',
    );
    expect(errorPaths(validateCancelIrnRequest(s))).toStrictEqual(["SCHEMA:CnlRsn"]);
    expect(validateCancelIrnRequest({ ...(s as object), CnlRsn: "1" }).ok).toBe(true);
  });

  it("EW-CNL, EW-REJ, EW-CEWB pass", () => {
    expect(
      validateCancelEwbRequest(
        sample(
          `${EW}v1.03-cancel-ewaybill.txt`,
          "“data” JSON (corresponds to the data element of Cancel E-WAY BILL Request)",
        ),
      ).ok,
    ).toBe(true);
    expect(
      validateRejectEwbRequest(
        sample(
          `${EW}v1.03-reject-ewaybill.txt`,
          "“data” JSON corresponds to the data element of Reject E-WAY BILL Request above",
        ),
      ).ok,
    ).toBe(true);
    expect(
      validateConsolidatedEwbRequest(
        sample(
          `${EW}v1.03-consolidated-ewaybill.txt`,
          "“data” JSON (corresponds to the data element of Generate Consolidated E-WAY BILL Request)",
        ),
      ).ok,
    ).toBe(true);
  });

  it("EW-TRN passes (no check digit on transporter ids), but its sample GSTIN fails mod-36 and is never valid", () => {
    const s = sample(
      `${EW}v1.03-update-transporter.txt`,
      "“data” JSON corresponds to the data element of Update Transporter Request above",
    ) as { transporterId: string };
    expect(validateUpdateTransporterRequest(s).ok).toBe(true);
    expect(isValidGstin(s.transporterId)).toBe(false);
  });

  it('EW-VEH: UNEXPECTED_KEY for "transDocNo " and "transDocDate " (trailing spaces), nothing else', () => {
    const s = sample(
      `${EW}v1.03-vehicle-number-update.txt`,
      "“data” JSON corresponds to the data element of UPDATE VEHICLE Request above",
    );
    expect(errorPaths(validateUpdateVehicleRequest(s))).toStrictEqual([
      "UNEXPECTED_KEY:transDocNo ",
      "UNEXPECTED_KEY:transDocDate ",
    ]);
  });

  it("EW-EXT passes (mode 5, status T, transit R)", () => {
    const s = sample(
      `${EW}v1.03-extend-validity.txt`,
      "“data” JSON corresponds to the data element of Extend Validity Request above",
    );
    const r = validateExtendValidityRequest(s);
    expect(r.issues).toStrictEqual([]);
  });
});

describe("malformed-schema intents (D-G17)", () => {
  const veh = {
    ewbNo: "111000609282",
    vehicleNo: "PQR1234",
    fromPlace: "B",
    fromState: "29",
    reasonCode: "1",
    reasonRem: "x",
    transMode: "1",
  };
  it("vehicle update without ewbNo fails", () => {
    expect(errorPaths(validateUpdateVehicleRequest(omit(veh, "ewbNo")))).toStrictEqual([
      "SCHEMA:ewbNo",
    ]);
  });
  it("extend without transMode fails", () => {
    const r = validateExtendValidityRequest({
      ewbNo: "111000609282",
      fromPlace: "B",
      fromState: "29",
      remainingDistance: "5",
      extnRsnCode: "1",
      extnRemarks: "x",
      fromPincode: "560090",
      consignmentStatus: "M",
      transitType: "",
    });
    expect(errorPaths(r)).toStrictEqual(["SCHEMA:transMode"]);
  });
  it("consolidated: a bad SECOND item fails (draft-04 tuple form checks only the first)", () => {
    const r = validateConsolidatedEwbRequest({
      fromPlace: "B",
      fromState: "29",
      vehicleNo: "KA12AB1234",
      transMode: "1",
      tripSheetEwbBills: [{ ewbNo: "111000609282" }, { ewbNo: "12" }],
    });
    expect(errorPaths(r)).toStrictEqual(["SCHEMA:tripSheetEwbBills.1.ewbNo"]);
  });
  it("transporter id with | fails (anchored, no literal |)", () => {
    expect(
      validateUpdateTransporterRequest({ ewbNo: "111000609282", transporterId: "29|AAAA0000A1ZY0" })
        .ok,
    ).toBe(false);
  });
  it("cancel IRN without CnlRsn fails", () => {
    expect(errorPaths(validateCancelIrnRequest({ Irn: "a".repeat(64) }))).toStrictEqual([
      "SCHEMA:CnlRsn",
    ]);
  });
});

describe("cross-field transport rules (D-G27)", () => {
  const base = {
    ewbNo: "111000609282",
    fromPlace: "B",
    fromState: "29",
    reasonCode: "1",
    reasonRem: "x",
  };
  it.each([
    ["1", {}, ["RULE:vehicleNo"]],
    ["1", { vehicleNo: "KA12AB1234" }, []],
    ["2", {}, ["RULE:transDocNo"]],
    ["3", { transDocNo: "AWB1" }, []],
    ["4", { vehicleNo: "KA12AB1234" }, ["RULE:transDocNo"]],
  ])("vehicle update mode %s %j", (mode, extra, expected) => {
    expect(
      errorPaths(validateUpdateVehicleRequest({ ...base, transMode: mode, ...extra })),
    ).toStrictEqual(expected);
  });

  const ext = {
    ewbNo: "111000609282",
    vehicleNo: "PQR1234",
    fromPlace: "B",
    fromState: "29",
    remainingDistance: "5",
    extnRsnCode: "1",
    extnRemarks: "x",
    fromPincode: "560090",
  };
  it.each([
    ["1", "M", "", []],
    ["1", "T", "", ["RULE:consignmentStatus"]],
    ["1", "M", "R", ["RULE:transitType"]],
    ["5", "T", "W", []],
    ["5", "M", "O", ["RULE:consignmentStatus"]],
    ["5", "T", "", ["RULE:transitType"]],
  ])("extend mode %s status %s transit %j", (mode, status, transit, expected) => {
    expect(
      errorPaths(
        validateExtendValidityRequest({
          ...ext,
          transMode: mode,
          consignmentStatus: status,
          transitType: transit,
        }),
      ),
    ).toStrictEqual(expected);
  });
});

describe("cancel reason codes (GD1, D-G14)", () => {
  it("the same code means different things in the two systems", () => {
    expect(EINVOICE_CANCEL_REASONS["2"]).toBe("Data entry mistake");
    expect(EWB_CANCEL_REASONS["2"]).toBe("Order Cancelled");
    expect(EINVOICE_CANCEL_REASONS["3"]).toBe("Order Cancelled");
    expect(EWB_CANCEL_REASONS["3"]).toBe("Data Entry mistake");
  });
  it("match the source files", () => {
    expect(read(`${EI}v1.03-cancel-irn.txt`)).toContain(
      "1- Duplicate, 2 - Data entry mistake, 3- Order Cancelled, 4 - Others",
    );
    expect(read("ewaybill/master-codes/cancellation-reason-codes.csv")).toBe(
      "code,description\n1,Duplicate\n2,Order Cancelled\n3,Data Entry mistake\n4,Others\n",
    );
  });
});

describe("response samples", () => {
  const ok = (r: ReturnType<typeof parseResponse>) => {
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    return r;
  };
  it("EI-GSTIN sample is invalid JSON (DtDReg); with only that fixed it normalises", () => {
    const marker = '"data" JSON (corresponds to the data element of GetGSTIN Response(Success))';
    expect(parseJsonAsStrings(sampleText(`${EI}v1.04-get-gstin-details.txt`, marker)).ok).toBe(
      false,
    );
    const s = sample(`${EI}v1.04-get-gstin-details.txt`, marker, (t) =>
      t.replace('"DtDReg":2021-05-04"', '"DtDReg":"2021-05-04"'),
    );
    const r = normaliseGstinDetails(s, "einvoice");
    expect(r.ok && r.value).toMatchObject({
      stateCode: "29",
      pincode: "562160",
      status: "ACT",
      isActive: true,
      blockStatus: "UNKNOWN",
      deregistrationDate: "2021-05-04",
    });
    expect(r.warnings).toStrictEqual([]);
  });
  it("EI-SYNC sample normalises", () => {
    const s = sample(
      `${EI}v1.04-sync-gstin-details-from-cp.txt`,
      '"data" JSON (corresponds to the data element of GetGSTIN Response(Success))',
    );
    expect(normaliseGstinDetails(s, "einvoice-sync").ok).toBe(true);
  });
  it("EW-GSTIN sample lacks two commas; with only those fixed it normalises", () => {
    const marker = '"data" JSON (corresponds to the data element of GetGSTIN Response(Success))';
    const raw = sampleText(`${EW}v1.03-get-gstin-details.txt`, marker);
    expect(parseJsonAsStrings(raw).ok).toBe(false);
    const s = sample(`${EW}v1.03-get-gstin-details.txt`, marker, (t) =>
      t.replace(/("txpType":" ")\s*\n/, "$1,\n").replace(/("status":"ACT")\s*\n/, "$1,\n"),
    );
    const r = normaliseGstinDetails(s, "ewaybill");
    expect(r.ok && r.value).toMatchObject({
      taxpayerType: null,
      isActive: true,
      blockStatus: "BLOCKED",
    });
  });
  it("EI-GET, EI-DOC, EI-GEN parse as EinvoiceDetails; EI-EWBGET as EwbByIrnDetails", () => {
    ok(
      parseResponse(
        sampleText(
          `${EI}v1.03-get-einvoice-details.txt`,
          "JSON corresponds to the data element of GET e- Invoice Response(Success) above",
        ),
        EinvoiceDetailsSchema,
      ),
    );
    ok(
      parseResponse(
        sampleText(
          `${EI}v1.03-get-irn-by-doc-details.txt`,
          "JSON corresponds to the data element of Get e-Waybill Details by IRN Response(Success) above",
        ),
        EinvoiceDetailsSchema,
      ),
    );
    const gen = ok(
      parseResponse(
        sampleText(
          `${EI}v1.03-generate-irn.txt`,
          "JSON corresponds to the data element of Generate IRN Response(Success) above",
        ),
        EinvoiceDetailsSchema,
      ),
    );
    expect(gen.warnings).toStrictEqual([]); // Remarks accepted (GD27)
    ok(
      parseResponse(
        sampleText(
          `${EI}v1.03-get-ewaybill-details-by-irn.txt`,
          "JSON corresponds to the data element of Get e-Waybill Details by IRN Response(Success) above",
        ),
        EwbByIrnDetailsSchema,
      ),
    );
    ok(
      parseResponse(
        sampleText(
          `${EI}v1.03-cancel-irn.txt`,
          "JSON (corresponds to the data element of Cancelled e-Invoice Response(Success))",
        ),
        CancelIrnResponseSchema,
      ),
    );
  });
  it("EW-* response samples parse; odd dates are kept as strings", () => {
    ok(
      parseResponse(
        sampleText(
          `${EW}v1.03-cancel-ewaybill.txt`,
          "“data” JSON (corresponds to the data element of Cancelled EWB Response(Success))",
        ),
        CancelEwbResponseSchema,
      ),
    );
    ok(
      parseResponse(
        sampleText(
          `${EW}v1.03-reject-ewaybill.txt`,
          "“data” JSON (corresponds to the data element of Reject EWB Response(Success))",
        ),
        RejectEwbResponseSchema,
      ),
    );
    const veh = ok(
      parseResponse(
        sampleText(
          `${EW}v1.03-vehicle-number-update.txt`,
          "“data” JSON corresponds to the data element of UPDATE VEHICLE Response(Success) above",
        ),
        UpdateVehicleResponseSchema,
      ),
    );
    expect(veh.value).toMatchObject({ validUpto: "17/09/2017 12.00:00 PM" });
    const ext = ok(
      parseResponse(
        sampleText(
          `${EW}v1.03-extend-validity.txt`,
          "“data” JSON (corresponds to the data element of Extend Validity Response(Success))",
        ),
        ExtendValidityResponseSchema,
      ),
    );
    expect(ext.value).toMatchObject({ validUpto: "21/05/2018 23:59:00 PM" });
    ok(
      parseResponse(
        sampleText(
          `${EW}v1.03-consolidated-ewaybill.txt`,
          "“data” JSON corresponds to the data element of Generate Consolidated EWB Response(Success) above",
        ),
        ConsolidatedEwbResponseSchema,
      ),
    );
    ok(
      parseResponse(
        sampleText(
          `${EW}v1.03-update-transporter.txt`,
          "“data” JSON (corresponds to the data element of Update Transporter Response(Success))",
        ),
        UpdateTransporterResponseSchema,
      ),
    );
  });
  it("the samples' Base64 'data' strings are plain Base64 of JSON, not ciphertext (GD8)", () => {
    const env = sampleText(`${EW}v1.03-reject-ewaybill.txt`, "Sample JSON (Response)");
    const data = (JSON.parse(env) as { data: string }).data.trim();
    expect(Buffer.from(data, "base64").toString("utf8")).toContain('"ewayBillNo": 181000609270');
  });
});
