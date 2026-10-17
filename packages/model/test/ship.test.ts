import { describe, expect, it } from "vitest";
import { GSTINS, parties } from "@india-gst-kit/fixtures";
import {
  DispatchFromSchema,
  GstDocumentSchema,
  ShipAddressSchema,
  ShipToSchema,
  documentPinWarnings,
  parseGstDocument,
  pinStateCheck,
  shipmentPattern,
  type GstDocument,
} from "../src/index.js";
import { doc, expectIssueAt, expectValid } from "./helpers.js";

const chennai = { line1: "9 Warehouse Road", city: "Chennai", pincode: "600001", stateCode: "33" };

function withoutPin<T extends { pincode: string }>(a: T): Omit<T, "pincode"> {
  const copy: Partial<T> = { ...a };
  delete copy.pincode;
  return copy as Omit<T, "pincode">;
}

function paths(schema: { safeParse: (v: unknown) => unknown }, input: unknown): string[] {
  const r = schema.safeParse(input) as {
    success: boolean;
    error?: { issues: { path: PropertyKey[] }[] };
  };
  return r.success ? [] : (r.error?.issues ?? []).map((i) => i.path.join("."));
}

function messages(schema: { safeParse: (v: unknown) => unknown }, input: unknown): string[] {
  const r = schema.safeParse(input) as {
    success: boolean;
    error?: { issues: { message: string }[] };
  };
  return r.success ? [] : (r.error?.issues ?? []).map((i) => i.message);
}

function parsed(input: unknown): GstDocument {
  const r = parseGstDocument(input);
  if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  return r.data;
}

describe("ShipToSchema", () => {
  it("accepts legal name + address with PIN, with a trade name, and with a synthetic GSTIN", () => {
    expect(paths(ShipToSchema, { legalName: "Ship Site", address: chennai })).toEqual([]);
    expect(
      paths(ShipToSchema, { legalName: "Ship Site", tradeName: "Site", address: chennai }),
    ).toEqual([]);
    expect(
      paths(ShipToSchema, { legalName: "Ship Site", gstin: GSTINS.shipToTn, address: chennai }),
    ).toEqual([]);
  });
  it("rejects a missing legalName", () => {
    expect(paths(ShipToSchema, { address: chennai })).toContain("legalName");
  });
  it("rejects a missing pincode", () => {
    const noPin = withoutPin(chennai);
    expect(paths(ShipToSchema, { legalName: "S", address: noPin })).toContain("address.pincode");
  });
  it("rejects state codes 96 and 99 and a non-IN country", () => {
    for (const stateCode of ["96", "99"]) {
      expect(paths(ShipToSchema, { legalName: "S", address: { ...chennai, stateCode } })).toContain(
        "address.stateCode",
      );
    }
    expect(
      paths(ShipToSchema, { legalName: "S", address: { ...chennai, country: "US" } }),
    ).toContain("address.country");
  });
  it("rejects a wrong check digit, a temporary ID (own message), URP and unknown keys", () => {
    const bad = GSTINS.shipToTn.slice(0, 14) + (GSTINS.shipToTn.endsWith("A") ? "B" : "A");
    expect(paths(ShipToSchema, { legalName: "S", gstin: bad, address: chennai })).toContain(
      "gstin",
    );
    expect(
      messages(ShipToSchema, { legalName: "S", gstin: "331234567890TMP", address: chennai }),
    ).toContain("looks like a temporary ID, not a GSTIN");
    expect(paths(ShipToSchema, { legalName: "S", gstin: "URP", address: chennai })).toContain(
      "gstin",
    );
    expect(paths(ShipToSchema, { legalName: "S", phone: "1", address: chennai })).toEqual([""]);
  });
});

describe("DispatchFromSchema", () => {
  it("accepts legal name + address", () => {
    expect(paths(DispatchFromSchema, { legalName: "Depot", address: chennai })).toEqual([]);
  });
  it("rejects a missing pincode, state 96, and gstin / tradeName as unknown keys", () => {
    const noPin = withoutPin(chennai);
    expect(paths(DispatchFromSchema, { legalName: "D", address: noPin })).toContain(
      "address.pincode",
    );
    expect(
      paths(DispatchFromSchema, { legalName: "D", address: { ...chennai, stateCode: "96" } }),
    ).toContain("address.stateCode");
    for (const extra of [{ gstin: GSTINS.shipToTn }, { tradeName: "T" }]) {
      expect(
        DispatchFromSchema.safeParse({ legalName: "D", address: chennai, ...extra }).success,
      ).toBe(false);
    }
  });
});

describe("ShipAddressSchema", () => {
  it("city of 50 characters accepted, 51 rejected", () => {
    expect(paths(ShipAddressSchema, { ...chennai, city: "C".repeat(50) })).toEqual([]);
    expect(paths(ShipAddressSchema, { ...chennai, city: "C".repeat(51) })).toContain("city");
  });
  it("accepts state code 25", () => {
    expect(paths(ShipAddressSchema, { ...chennai, pincode: "396210", stateCode: "25" })).toEqual(
      [],
    );
  });
  it("defaults country to IN", () => {
    expect(ShipAddressSchema.parse(chennai).country).toBe("IN");
  });
});

describe("documents with ship-to / dispatch-from", () => {
  it("valid: bill-to–ship-to, bill-from–dispatch-from, combination, export with port ship-to", () => {
    for (const n of [
      "billToShipTo",
      "billToShipToUnregistered",
      "billFromDispatchFrom",
      "shipDispatchCombination",
      "exportPortShipTo",
    ] as const) {
      expectValid(doc(n));
    }
  });
  it("valid: credit note with shipTo; bill of supply with dispatchFrom", () => {
    const cn = doc("creditNote");
    expectValid({ ...cn, shipTo: { legalName: "Ship Site", address: chennai } });
    const bos = doc("billOfSupply");
    expectValid({ ...bos, dispatchFrom: { legalName: "Depot", address: chennai } });
  });
  it("export with port ship-to stays INTER with POS 96", () => {
    const d = parsed(doc("exportPortShipTo"));
    expect(d.placeOfSupply).toBe("96");
    expect(d.recipient.registrationType).toBe("OVERSEAS");
    expect(d.shipTo?.address.stateCode).toBe("27");
  });
  it("place of supply is untouched: supplier 29, POS 29, shipTo in 33 → INTRA", () => {
    const d = doc("intraInvoice");
    const withShip = { ...d, shipTo: { legalName: "Ship Site", address: chennai } };
    expectValid(withShip);
    expect(parsed(withShip).placeOfSupply).toBe("29");
    const igst = structuredClone(withShip);
    const l0 = igst.lines[0];
    if (l0 === undefined) throw new Error("no line");
    Object.assign(l0, { cgst: "0.00", sgst: "0.00", igst: "180.00" });
    expectIssueAt(igst, "lines.0.igst");
  });
  it("supplier 29, POS in another state (27), shipTo in 29 → INTER", () => {
    const d = doc("interInvoice");
    const withShip = {
      ...d,
      shipTo: {
        legalName: "Local Site",
        address: { line1: "1 Local", city: "Bengaluru", pincode: "560002", stateCode: "29" },
      },
    };
    expectValid(withShip); // interInvoice: supplier 29, POS 27, IGST
    expect(parsed(withShip).placeOfSupply).toBe("27");
  });
  it("supplier 29, dispatchFrom in 33, POS 29 → INTRA", () => {
    const d = { ...doc("intraInvoice"), dispatchFrom: { legalName: "Depot", address: chennai } };
    expectValid(d);
    expect(parsed(d).placeOfSupply).toBe("29");
  });
  it("shipTo identical to the recipient is valid", () => {
    const d = doc("intraInvoice");
    expectValid({
      ...d,
      shipTo: {
        legalName: parties.recipientKa.legalName,
        gstin: parties.recipientKa.gstin,
        address: parties.recipientKa.address,
      },
    });
  });
  it("reports ship-to issues at document paths", () => {
    const d = doc("billToShipTo") as Record<string, unknown>;
    const noPin = withoutPin(chennai);
    expectIssueAt({ ...d, shipTo: { legalName: "S", address: noPin } }, "shipTo.address.pincode");
    expectIssueAt(
      { ...d, dispatchFrom: { legalName: "D", address: { ...chennai, stateCode: "99" } } },
      "dispatchFrom.address.stateCode",
    );
  });
  it("unknown keys on the document are still rejected", () => {
    expect(GstDocumentSchema.safeParse({ ...doc("intraInvoice"), consignee: {} }).success).toBe(
      false,
    );
  });
});

describe("shipmentPattern", () => {
  const ship = { legalName: "S", address: ShipAddressSchema.parse(chennai) };
  it("classifies the four patterns", () => {
    expect(shipmentPattern({})).toBe("REGULAR");
    expect(shipmentPattern({ shipTo: ship })).toBe("BILL_TO_SHIP_TO");
    expect(shipmentPattern({ dispatchFrom: ship })).toBe("BILL_FROM_DISPATCH_FROM");
    expect(shipmentPattern({ shipTo: ship, dispatchFrom: ship })).toBe("COMBINATION");
  });
  it("matches the fixtures", () => {
    expect(shipmentPattern(parsed(doc("intraInvoice")))).toBe("REGULAR");
    expect(shipmentPattern(parsed(doc("billToShipTo")))).toBe("BILL_TO_SHIP_TO");
    expect(shipmentPattern(parsed(doc("billFromDispatchFrom")))).toBe("BILL_FROM_DISPATCH_FROM");
    expect(shipmentPattern(parsed(doc("shipDispatchCombination")))).toBe("COMBINATION");
  });
});

describe("pinStateCheck", () => {
  it("match, mismatch, overlap and unknown", () => {
    expect(pinStateCheck("560001", "29")).toBe("match");
    expect(pinStateCheck("560001", "33")).toBe("mismatch");
    expect(pinStateCheck("500001", "36")).toBe("match");
    expect(pinStateCheck("500001", "37")).toBe("match");
    expect(pinStateCheck("999999", "97")).toBe("unknown");
    expect(pinStateCheck("110001", "07")).toBe("match");
  });
});

describe("documentPinWarnings", () => {
  it("a clean document gives none", () => {
    expect(documentPinWarnings(parsed(doc("shipDispatchCombination")))).toEqual([]);
  });
  it("flags a shipTo PIN outside its state's range, while parsing still succeeds", () => {
    const input = { ...doc("billToShipTo") } as Record<string, unknown>;
    input["shipTo"] = { legalName: "S", address: { ...chennai, pincode: "560001" } };
    const d = parsed(input);
    const w = documentPinWarnings(d);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({
      path: ["shipTo", "address", "pincode"],
      code: "PIN_STATE_MISMATCH",
    });
  });
  it("checks dispatchFrom, supplier and recipient too", () => {
    const input = structuredClone(doc("intraInvoice")) as Record<string, unknown> & {
      supplier: { address: { pincode?: string } };
      recipient: { address: { pincode?: string } };
    };
    input.supplier.address.pincode = "600001";
    input.recipient.address.pincode = "600002";
    input["dispatchFrom"] = { legalName: "D", address: { ...chennai, pincode: "110001" } };
    const w = documentPinWarnings(parsed(input)).map((x) => x.path.join("."));
    expect(w).toEqual([
      "supplier.address.pincode",
      "recipient.address.pincode",
      "dispatchFrom.address.pincode",
    ]);
  });
  it("skips an address without a PIN and 999999 in state 97", () => {
    expect(documentPinWarnings(parsed(doc("b2cInvoice")))).toEqual([]);
    const d = parsed(doc("billToShipTo"));
    const other = {
      ...d,
      shipTo: {
        legalName: "S",
        address: { line1: "x", city: "y", pincode: "999999", stateCode: "97", country: "IN" },
      },
    } as GstDocument;
    expect(documentPinWarnings(other)).toEqual([]);
  });
});
