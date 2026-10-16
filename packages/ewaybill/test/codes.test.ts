import { describe, expect, it } from "vitest";
import { PIN_RANGES, UQC_CODES } from "@india-gst-kit/model";
import * as einvoice from "@india-gst-kit/einvoice";
import { EWB_STATE_CODES } from "../src/index.js";
import {
  EWB_DOC_TYPES,
  EWB_SUB_SUPPLY_TYPES,
  EWB_SUPPLY_TYPES,
  EWB_TRANSACTION_TYPES,
  EWB_TRANSPORT_MODES,
  EWB_VEHICLE_TYPES,
} from "../src/codes.js";
import { DOC_TYPE_MAPPING, findDocTypeRow, partyRelation } from "../src/doc-type-mapping.js";
import { ewbStateFromInt, ewbStateInt, isEwbStateCode } from "../src/states.js";
import { VEHICLE_NUMBER_SHAPES, matchesVehicleShape } from "../src/vehicle-formats.js";
import { csv } from "./sources.js";

describe("K2 state list", () => {
  it("is the source list, codes zero-padded to 2 digits", () => {
    expect(EWB_STATE_CODES.map((s) => [Number(s.code), s.name])).toEqual(
      csv("ewaybill/master-codes/state-codes.csv").map(([c, n]) => [Number(c), n]),
    );
    expect(EWB_STATE_CODES.every((s) => /^\d{2}$/.test(s.code))).toBe(true);
  });
  it("has no 25 and no 96, and 26 is the merged territory (spec §13 D7)", () => {
    expect(isEwbStateCode("25")).toBe(false);
    expect(isEwbStateCode("96")).toBe(false);
    expect(EWB_STATE_CODES.find((s) => s.code === "26")?.name).toBe(
      "DADRA AND NAGAR HAVELI & DAMAN AND DIU",
    );
    expect(isEwbStateCode("99")).toBe(true);
  });
  it("converts to and from the integer form; 96 reads as 99", () => {
    expect(ewbStateInt("03")).toBe("3");
    expect(ewbStateInt("29")).toBe("29");
    expect(ewbStateFromInt("3")).toBe("03");
    expect(ewbStateFromInt("96")).toBe("99");
    expect(ewbStateFromInt("25")).toBeUndefined();
    expect(ewbStateFromInt("028")).toBeUndefined();
    expect(ewbStateFromInt("x")).toBeUndefined();
  });
});

describe("K1 code lists", () => {
  const pairs = (list: readonly { code: string; name: string }[]) => list.map((c) => c.code);
  it("match the source files", () => {
    expect(pairs(EWB_SUPPLY_TYPES)).toEqual(
      csv("ewaybill/master-codes/supply-type.csv").map(([c]) => c),
    );
    expect(pairs(EWB_SUB_SUPPLY_TYPES)).toEqual(
      csv("ewaybill/master-codes/sub-supply-type.csv").map(([c]) => c),
    );
    expect([...pairs(EWB_DOC_TYPES)].sort()).toEqual(
      csv("ewaybill/master-codes/document-type.csv")
        .map(([c]) => c)
        .sort(),
    );
    expect(pairs(EWB_VEHICLE_TYPES)).toEqual(
      csv("ewaybill/master-codes/vehicle-type.csv").map(([c]) => c),
    );
    expect(pairs(EWB_TRANSACTION_TYPES)).toEqual(
      csv("ewaybill/master-codes/transaction-types.csv").map(([c]) => c),
    );
  });
  it("transport modes are 1–4; K1's mode 5 (inTransit) is in no schema enum and is not supported", () => {
    const source = csv("ewaybill/master-codes/transportation-mode.csv").map(([c]) => c);
    expect(source).toEqual(["1", "2", "3", "4", "5"]);
    expect(pairs(EWB_TRANSPORT_MODES)).toEqual(["1", "2", "3", "4"]);
  });
  it("the unit codes are identical to the model's UQC codes", () => {
    const sorted = (xs: string[]) => [...xs].sort();
    expect(sorted(csv("ewaybill/master-codes/unit.csv").map(([c]) => c ?? ""))).toEqual(
      sorted(UQC_CODES.map((u) => u.code)),
    );
  });
});

describe("K3 sub-type × document-type mapping", () => {
  it("has the 28 rows of the source", () => {
    const rows = csv("ewaybill/master-codes/sub-supply-doc-type-mapping.csv");
    expect(rows).toHaveLength(28);
    expect(DOC_TYPE_MAPPING).toHaveLength(28);
    DOC_TYPE_MAPPING.forEach((r, i) => {
      const src = rows[i];
      expect(src?.[0]).toBe(r.supplyType === "O" ? "Outward" : "Inward");
      expect(src?.[3]).toBe(r.from);
      expect(src?.[4]).toBe(r.to);
    });
  });
  it("finds rows and says what they require of the parties", () => {
    const supply = findDocTypeRow("O", "1", "INV");
    expect(supply && partyRelation(supply)).toBe("differ");
    const own = findDocTypeRow("O", "5", "CHL");
    expect(own && partyRelation(own)).toBe("same");
    const others = findDocTypeRow("O", "8", "OTH");
    expect(others && partyRelation(others)).toBe("any");
    const inward = findDocTypeRow("I", "1", "INV");
    expect(inward && partyRelation(inward)).toBe("differ");
    expect(findDocTypeRow("O", "1", "OTH")).toBeUndefined();
  });
});

describe("vehicle-number shapes", () => {
  it("accept the source's examples", () => {
    for (const ok of [
      "AB121234",
      "AB12A1234",
      "AB12AB1234",
      "ABC1234",
      "AB123A1234",
      "AB12ABC1234",
      "DFAB1234",
      "TM1234567",
      "BP1234567",
      "NP1234567",
    ]) {
      expect(matchesVehicleShape(ok), ok).toBe(true);
    }
    expect(VEHICLE_NUMBER_SHAPES).toHaveLength(8);
  });
  it("reject lower case, spaces, too short temporary numbers and other shapes", () => {
    for (const bad of ["ka01ab1234", "KA 01 AB 1234", "TM12", "ABCD", "A1B2C3D4", ""]) {
      expect(matchesVehicleShape(bad), bad).toBe(false);
    }
  });
});

describe("PIN_RANGES", () => {
  it("lives in the model; einvoice re-exports the same list", async () => {
    const shim = await import("../../einvoice/src/pin-ranges.js");
    expect(shim.PIN_RANGES).toBe(PIN_RANGES);
    expect(PIN_RANGES.length).toBeGreaterThan(30);
    expect(einvoice.IRN_SCHEMA_VERSION).toBe("1.1");
  });
});
