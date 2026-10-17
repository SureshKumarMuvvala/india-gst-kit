import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_EARLIEST_DOC_DATE, IRN_SCHEMA_VERSION, validateIrnRequest } from "../src/index.js";
import { PIN_RANGES } from "../src/pin-ranges.js";
import { RULE_IDS } from "../src/rules.js";
import { edit, expectHit, GSTINS, hits, mapped, type Edit } from "./helpers.js";

interface Case {
  rule: string;
  title: string;
  from?: Parameters<typeof mapped>[0];
  fail: Edit[];
  path: (string | number)[];
  pass?: Edit[];
  severity?: "error" | "warning";
  options?: Parameters<typeof validateIrnRequest>[1];
}

// Valid pattern and state, wrong check digit / a state code that cannot prefix a GSTIN — derived, not literals.
const BAD_CHECK = `${GSTINS.supplierKa.slice(0, 14)}Z`;
const STATE_96 = `96${GSTINS.supplierKa.slice(2)}`;

const CASES: Case[] = [
  {
    rule: "S-SCHEMA",
    title: "LglNm too short",
    fail: [[["SellerDtls", "LglNm"], "ab"]],
    path: ["SellerDtls", "LglNm"],
    pass: [[["SellerDtls", "LglNm"], "abc"]],
  },
  {
    rule: "S-TEXT",
    title: "backslash in PrdDesc",
    fail: [[["ItemList", 0, "PrdDesc"], "bad\\desc"]],
    path: ["ItemList", 0, "PrdDesc"],
    pass: [[["ItemList", 0, "PrdDesc"], "good desc"]],
  },
  { rule: "V1", title: "Version must be 1.1", fail: [[["Version"], "1.01"]], path: ["Version"] },
  { rule: "V2", title: "Irn must be absent", fail: [[["Irn"], "a".repeat(64)]], path: ["Irn"] },
  {
    rule: "V3",
    title: "document number starting with 0",
    fail: [[["DocDtls", "No"], "0ABC"]],
    path: ["DocDtls", "No"],
    pass: [[["DocDtls", "No"], "A0BC"]],
  },
  {
    rule: "V3",
    title: "document number starting with /",
    fail: [[["DocDtls", "No"], "/ABC"]],
    path: ["DocDtls", "No"],
  },
  {
    rule: "V3",
    title: "document number starting with -",
    fail: [[["DocDtls", "No"], "-ABC"]],
    path: ["DocDtls", "No"],
  },
  {
    rule: "V4",
    title: "31/03/2025 is before the default earliest date",
    fail: [[["DocDtls", "Dt"], "31/03/2025"]],
    path: ["DocDtls", "Dt"],
    pass: [[["DocDtls", "Dt"], "01/04/2025"]],
  },
  {
    rule: "V4",
    title: "31/02/2026 is not a calendar date",
    fail: [[["DocDtls", "Dt"], "31/02/2026"]],
    path: ["DocDtls", "Dt"],
  },
  {
    rule: "V4",
    title: "after asOf",
    fail: [[["DocDtls", "Dt"], "20/04/2026"]],
    path: ["DocDtls", "Dt"],
    options: { asOf: "2026-04-19" },
    pass: [[["DocDtls", "Dt"], "19/04/2026"]],
  },
  {
    rule: "V5",
    title: "seller check digit",
    fail: [[["SellerDtls", "Gstin"], BAD_CHECK]],
    path: ["SellerDtls", "Gstin"],
  },
  {
    rule: "V5",
    title: "buyer GSTIN with a non-GSTIN state code (96)",
    fail: [[["BuyerDtls", "Gstin"], STATE_96]],
    path: ["BuyerDtls", "Gstin"],
  },
  {
    rule: "V5",
    title: "ship-to GSTIN check digit",
    fail: [
      [
        ["ShipDtls"],
        { Gstin: BAD_CHECK, LglNm: "Ship To", Addr1: "x", Loc: "Pune", Pin: "411001", Stcd: "29" },
      ],
    ],
    path: ["ShipDtls", "Gstin"],
  },
  {
    rule: "V5",
    title: "e-commerce GSTIN check digit",
    fail: [[["TranDtls", "EcmGstin"], BAD_CHECK]],
    path: ["TranDtls", "EcmGstin"],
  },
  {
    rule: "V6",
    title: "seller Stcd differs from the GSTIN",
    fail: [[["SellerDtls", "Stcd"], "27"]],
    path: ["SellerDtls", "Stcd"],
  },
  {
    rule: "V6",
    title: "buyer Stcd differs from the GSTIN",
    fail: [[["BuyerDtls", "Stcd"], "29"]],
    path: ["BuyerDtls", "Stcd"],
  },
  {
    rule: "V7",
    title: "Stcd 28 does not exist",
    fail: [[["SellerDtls", "Stcd"], "28"]],
    path: ["SellerDtls", "Stcd"],
  },
  {
    rule: "V7",
    title: "Pos 25 is withdrawn",
    fail: [[["BuyerDtls", "Pos"], "25"]],
    path: ["BuyerDtls", "Pos"],
    pass: [[["BuyerDtls", "Pos"], "27"]],
  },
  {
    rule: "V8",
    title: "export to a GSTIN holder",
    fail: [[["TranDtls", "SupTyp"], "EXPWP"]],
    path: ["BuyerDtls", "Gstin"],
  },
  {
    rule: "V8",
    title: "export buyer Stcd must be 96",
    from: "exportWithoutPayment",
    fail: [[["BuyerDtls", "Stcd"], "27"]],
    path: ["BuyerDtls", "Stcd"],
  },
  {
    rule: "V8",
    title: "export Pos must be 96",
    from: "exportWithoutPayment",
    fail: [[["BuyerDtls", "Pos"], "27"]],
    path: ["BuyerDtls", "Pos"],
  },
  {
    rule: "V8",
    title: "export PIN must be 999999 when present",
    from: "exportWithoutPayment",
    fail: [[["BuyerDtls", "Pin"], "560001"]],
    path: ["BuyerDtls", "Pin"],
  },
  {
    rule: "V9",
    title: "reverse charge with DEXP",
    fail: [
      [["TranDtls", "SupTyp"], "DEXP"],
      [["TranDtls", "RegRev"], "Y"],
    ],
    path: ["TranDtls", "RegRev"],
    pass: [[["TranDtls", "RegRev"], "Y"]],
  },
  {
    rule: "V10",
    title: "IgstOnIntra on an inter-state supply",
    fail: [[["TranDtls", "IgstOnIntra"], "Y"]],
    path: ["TranDtls", "IgstOnIntra"],
  },
  {
    rule: "V10",
    title: "IgstOnIntra needs reverse charge",
    from: "intraInvoice",
    fail: [[["TranDtls", "IgstOnIntra"], "Y"]],
    path: ["TranDtls", "IgstOnIntra"],
    pass: [
      [["TranDtls", "IgstOnIntra"], "Y"],
      [["TranDtls", "RegRev"], "Y"],
    ],
  },
  {
    rule: "V11",
    title: "IGST on an intra-state supply",
    from: "intraInvoice",
    fail: [[["ItemList", 0, "IgstAmt"], "162.00"]],
    path: ["ItemList", 0, "IgstAmt"],
  },
  {
    rule: "V11",
    title: "CGST on an inter-state supply",
    fail: [[["ItemList", 0, "CgstAmt"], "1.00"]],
    path: ["ItemList", 0, "CgstAmt"],
  },
  {
    rule: "V11",
    title: "SGST on an inter-state supply",
    fail: [[["ItemList", 0, "SgstAmt"], "1.00"]],
    path: ["ItemList", 0, "SgstAmt"],
  },
  {
    rule: "V11",
    title: "exports are always inter-state",
    from: "exportWithoutPayment",
    fail: [
      [["SellerDtls", "Stcd"], "29"],
      [["BuyerDtls", "Pos"], "29"],
      [["ItemList", 0, "CgstAmt"], "90.00"],
    ],
    path: ["ItemList", 0, "CgstAmt"],
  },
  {
    rule: "V12",
    title: "PIN prefix outside the state's range (warning)",
    fail: [[["SellerDtls", "Pin"], "110001"]],
    path: ["SellerDtls", "Pin"],
    severity: "warning",
  },
  {
    rule: "V12",
    title: "buyer PIN prefix outside the state's range (warning)",
    fail: [[["BuyerDtls", "Pin"], "560001"]],
    path: ["BuyerDtls", "Pin"],
    severity: "warning",
  },
  { rule: "V13", title: "no items", fail: [[["ItemList"], []]], path: ["ItemList"] },
  {
    rule: "V14",
    title: "duplicate SlNo",
    fail: [[["ItemList", 1, "SlNo"], "1"]],
    path: ["ItemList", 1, "SlNo"],
  },
  {
    rule: "V15",
    title: "goods without Qty",
    fail: [[["ItemList", 0, "Qty"], undefined]],
    path: ["ItemList", 0, "Qty"],
  },
  {
    rule: "V15",
    title: "goods without Unit",
    fail: [[["ItemList", 0, "Unit"], undefined]],
    path: ["ItemList", 0, "Unit"],
  },
  {
    rule: "V15",
    title: "goods with an unknown UQC",
    fail: [[["ItemList", 0, "Unit"], "XXX"]],
    path: ["ItemList", 0, "Unit"],
    pass: [[["ItemList", 0, "Unit"], "KGS"]],
  },
  {
    rule: "V16",
    title: "service with a goods HSN",
    fail: [[["ItemList", 1, "HsnCd"], "8471"]],
    path: ["ItemList", 1, "HsnCd"],
  },
  {
    rule: "V17",
    title: "tax rate 0.5% is withdrawn",
    fail: [[["ItemList", 0, "GstRt"], "0.5"]],
    path: ["ItemList", 0, "GstRt"],
    pass: [[["ItemList", 0, "GstRt"], "0.25"]],
  },
  {
    rule: "V20",
    title: "AssAmt vs TotAmt − Discount",
    fail: [[["ItemList", 0, "AssAmt"], "950.00"]],
    path: ["ItemList", 0, "AssAmt"],
    pass: [[["ItemList", 0, "AssAmt"], "901.00"]],
  },
  {
    rule: "V21",
    title: "CGST vs AssAmt × r / 200",
    from: "intraInvoice",
    fail: [[["ItemList", 0, "CgstAmt"], "92.00"]],
    path: ["ItemList", 0, "CgstAmt"],
    pass: [[["ItemList", 0, "CgstAmt"], "91.00"]],
  },
  {
    rule: "V21",
    title: "SGST vs AssAmt × r / 200",
    from: "intraInvoice",
    fail: [[["ItemList", 0, "SgstAmt"], "88.99"]],
    path: ["ItemList", 0, "SgstAmt"],
    pass: [[["ItemList", 0, "SgstAmt"], "89.00"]],
  },
  {
    rule: "V22",
    title: "IGST vs AssAmt × r / 100",
    fail: [[["ItemList", 0, "IgstAmt"], "165.00"]],
    path: ["ItemList", 0, "IgstAmt"],
    pass: [[["ItemList", 0, "IgstAmt"], "163.00"]],
  },
  {
    rule: "V23",
    title: "CesAmt vs AssAmt × CesRt / 100",
    from: "cessInvoice",
    fail: [[["ItemList", 0, "CesAmt"], "130.00"]],
    path: ["ItemList", 0, "CesAmt"],
    pass: [[["ItemList", 0, "CesAmt"], "121.00"]],
  },
  {
    rule: "V24",
    title: "StateCesAmt vs AssAmt × StateCesRt / 100",
    fail: [[["ItemList", 0, "StateCesRt"], "10"]],
    path: ["ItemList", 0, "StateCesAmt"],
    pass: [
      [["ItemList", 0, "StateCesRt"], "10"],
      [["ItemList", 0, "StateCesAmt"], "90.00"],
    ],
  },
  {
    rule: "V25",
    title: "TotItemVal vs the sum of its parts",
    fail: [[["ItemList", 0, "TotItemVal"], "1.00"]],
    path: ["ItemList", 0, "TotItemVal"],
    pass: [[["ItemList", 0, "TotItemVal"], "1063.00"]],
  },
  {
    rule: "V26",
    title: "AssVal vs ΣAssAmt",
    fail: [[["ValDtls", "AssVal"], "5000.00"]],
    path: ["ValDtls", "AssVal"],
    pass: [[["ValDtls", "AssVal"], "1401.00"]],
  },
  {
    rule: "V26",
    title: "IgstVal vs ΣIgstAmt",
    fail: [[["ValDtls", "IgstVal"], "300.00"]],
    path: ["ValDtls", "IgstVal"],
  },
  {
    rule: "V26",
    title: "CgstVal vs ΣCgstAmt",
    from: "intraInvoice",
    fail: [[["ValDtls", "CgstVal"], "300.00"]],
    path: ["ValDtls", "CgstVal"],
  },
  {
    rule: "V26",
    title: "SgstVal vs ΣSgstAmt",
    from: "intraInvoice",
    fail: [[["ValDtls", "SgstVal"], "300.00"]],
    path: ["ValDtls", "SgstVal"],
  },
  {
    rule: "V26",
    title: "CesVal vs Σ(CesAmt + CesNonAdvlAmt)",
    from: "cessInvoice",
    fail: [[["ValDtls", "CesVal"], "300.00"]],
    path: ["ValDtls", "CesVal"],
    pass: [[["ValDtls", "CesVal"], "120.00"]],
  },
  {
    rule: "V26",
    title: "StCesVal vs Σ(StateCesAmt + StateCesNonAdvlAmt)",
    fail: [[["ValDtls", "StCesVal"], "300.00"]],
    path: ["ValDtls", "StCesVal"],
  },
  {
    rule: "V27",
    title: "RndOffAmt above 99.99",
    fail: [[["ValDtls", "RndOffAmt"], "100.00"]],
    path: ["ValDtls", "RndOffAmt"],
    pass: [[["ValDtls", "RndOffAmt"], "99.99"]],
  },
  {
    rule: "V27",
    title: "RndOffAmt below −99.99",
    fail: [[["ValDtls", "RndOffAmt"], "-100.00"]],
    path: ["ValDtls", "RndOffAmt"],
    pass: [[["ValDtls", "RndOffAmt"], "-99.99"]],
  },
  {
    rule: "V28",
    title: "TotInvVal vs the sum of the items",
    fail: [[["ValDtls", "TotInvVal"], "9999.00"]],
    path: ["ValDtls", "TotInvVal"],
  },
  // Track E (spec §5.2, §9): ship-to / dispatch-from.
  {
    rule: "V12",
    title: "ShipDtls PIN prefix outside the state's range (warning)",
    from: "billToShipTo",
    fail: [[["ShipDtls", "Pin"], "560001"]],
    path: ["ShipDtls", "Pin"],
    severity: "warning",
  },
  {
    rule: "V12",
    title: "DispDtls PIN prefix outside the state's range (warning)",
    from: "billFromDispatchFrom",
    fail: [[["DispDtls", "Pin"], "560001"]],
    path: ["DispDtls", "Pin"],
    severity: "warning",
  },
  {
    rule: "V5",
    title: "ShipDtls GSTIN check digit",
    from: "billToShipTo",
    fail: [[["ShipDtls", "Gstin"], `${GSTINS.shipToTn.slice(0, 14)}A`]],
    path: ["ShipDtls", "Gstin"],
    pass: [[["ShipDtls", "Gstin"], "URP"]],
  },
  {
    rule: "V29",
    title: "EwbDtls without ShipDtls needs the buyer PIN (warning)",
    from: "intraInvoice",
    fail: [
      [["EwbDtls"], { Distance: "100" }],
      [["BuyerDtls", "Pin"], undefined],
    ],
    path: ["BuyerDtls", "Pin"],
    pass: [[["EwbDtls"], { Distance: "100" }]],
    severity: "warning",
  },
  {
    rule: "V30",
    title: "export EwbDtls without a port ShipDtls (warning)",
    from: "exportWithoutPayment",
    fail: [[["EwbDtls"], { Distance: "100" }]],
    path: ["ShipDtls"],
    pass: [
      [["EwbDtls"], { Distance: "100" }],
      [
        ["ShipDtls"],
        { LglNm: "Port Terminal", Addr1: "Gate 3", Loc: "Mumbai", Pin: "400001", Stcd: "27" },
      ],
    ],
    severity: "warning",
  },
  {
    rule: "V30",
    title: "export EwbDtls with ShipDtls outside India (warning)",
    from: "exportPortShipTo",
    fail: [
      [["EwbDtls"], { Distance: "100" }],
      [["ShipDtls", "Stcd"], "96"],
    ],
    path: ["ShipDtls", "Stcd"],
    pass: [[["EwbDtls"], { Distance: "100" }]],
    severity: "warning",
  },
];

describe("validateIrnRequest — rules", () => {
  it("V29 / V30: no warning without EwbDtls; V29 none when ShipDtls is present", () => {
    const noPin = edit(mapped("billToShipTo"), [[["BuyerDtls", "Pin"], undefined]]);
    expect(hits(validateIrnRequest(noPin).issues, "V29")).toEqual([]);
    const withEwb = edit(noPin, [[["EwbDtls"], { Distance: "100" }]]);
    expect(hits(validateIrnRequest(withEwb).issues, "V29")).toEqual([]);
    expect(hits(validateIrnRequest(mapped("exportWithoutPayment")).issues, "V30")).toEqual([]);
  });

  it("passes every mapped fixture with no issues at all", () => {
    for (const name of [
      "intraInvoice",
      "interInvoice",
      "cessInvoice",
      "creditNote",
      "exportWithoutPayment",
      "sezWithoutPayment",
      "utPlaceOfSupply",
    ] as const) {
      const r = validateIrnRequest(mapped(name));
      expect(r.issues, name).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });

  it.each(CASES.map((c) => [`${c.rule}: ${c.title}`, c] as const))("%s", (_t, c) => {
    const base = mapped(c.from ?? "interInvoice");
    const failing = validateIrnRequest(edit(base, c.fail), c.options);
    expectHit(failing.issues, c.rule, c.path, c.severity ?? "error");
    if (c.severity === "warning") expect(failing.ok).toBe(true);
    else expect(failing.ok).toBe(false);

    const passing = validateIrnRequest(edit(base, c.pass ?? []), c.options);
    expect(
      hits(passing.issues, c.rule).filter((i) => i.path.join(".") === c.path.join(".")),
    ).toEqual([]);
  });

  it("every rule id has at least one failing case", () => {
    const covered = new Set(CASES.map((c) => c.rule).concat(["S-SIZE"]));
    expect([...RULE_IDS].filter((r) => !covered.has(r))).toEqual([]);
    expect([...covered].filter((r) => !(RULE_IDS as readonly string[]).includes(r))).toEqual([]);
  });

  it("V13: more than 1000 items is rejected, exactly 1000 is not", () => {
    const base = mapped("zeroRateInvoice");
    const item = base.ItemList[0];
    const many = (n: number) =>
      edit(base, [
        [["ItemList"], Array.from({ length: n }, (_, i) => ({ ...item, SlNo: String(i + 1) }))],
      ]);
    expectHit(validateIrnRequest(many(1001)).issues, "V13", ["ItemList"]);
    expect(hits(validateIrnRequest(many(1000)).issues, "V13")).toEqual([]);
  });

  it("S-SIZE: a payload over 2 MB is rejected", () => {
    const attrib = Array.from({ length: 120_000 }, () => ({ Nm: "a", Val: "b" }));
    const big = edit(mapped("intraInvoice"), [[["ItemList", 0, "AttribDtls"], attrib]]);
    const r = validateIrnRequest(big);
    expect(r.ok).toBe(false);
    expectHit(r.issues, "S-SIZE", []);
    const small = edit(mapped("intraInvoice"), [
      [["ItemList", 0, "AttribDtls"], attrib.slice(0, 100)],
    ]);
    expect(hits(validateIrnRequest(small).issues, "S-SIZE")).toEqual([]);
  });

  it("returns the typed value when the structure is valid and none when it is not", () => {
    expect(validateIrnRequest(mapped("intraInvoice")).value?.DocDtls.No).toBe("INV/2026-27/0001");
    expect(validateIrnRequest({ nope: 1 }).value).toBeUndefined();
    expect(validateIrnRequest(null).ok).toBe(false);
    expect(validateIrnRequest("x").ok).toBe(false);
  });

  it("does not run the rules on a payload that fails the schema", () => {
    const r = validateIrnRequest(edit(mapped("intraInvoice"), [[["SellerDtls", "LglNm"], "ab"]]));
    expect(
      r.issues.every((i) => i.rule.startsWith("S-") || i.rule === "V3" || i.rule === "V27"),
    ).toBe(true);
  });
});

describe("validateIrnRequest — options", () => {
  const withDate = (dt: string) => edit(mapped("intraInvoice"), [[["DocDtls", "Dt"], dt]]);
  it("exports the documented constants", () => {
    expect(IRN_SCHEMA_VERSION).toBe("1.1");
    expect(DEFAULT_EARLIEST_DOC_DATE).toBe("2025-04-01");
  });
  it("default earliestDocDate: 31/03/2025 rejected, 01/04/2025 accepted", () => {
    expect(hits(validateIrnRequest(withDate("31/03/2025")).issues, "V4")).toHaveLength(1);
    expect(hits(validateIrnRequest(withDate("01/04/2025")).issues, "V4")).toHaveLength(0);
  });
  it("earliestDocDate override: 2020-01-01 accepts 05/08/2020; 2025-05-01 rejects 30/04/2025", () => {
    expect(
      hits(
        validateIrnRequest(withDate("05/08/2020"), { earliestDocDate: "2020-01-01" }).issues,
        "V4",
      ),
    ).toHaveLength(0);
    expect(
      hits(
        validateIrnRequest(withDate("30/04/2025"), { earliestDocDate: "2025-05-01" }).issues,
        "V4",
      ),
    ).toHaveLength(1);
  });
  it("year 2030 is rejected by the source pattern (D2)", () => {
    const r = validateIrnRequest(withDate("01/01/2030"));
    expectHit(r.issues, "S-SCHEMA", ["DocDtls", "Dt"]);
  });
  it("gstinCheckDigit: off drops only the check-digit failures", () => {
    const bad = edit(mapped("intraInvoice"), [[["SellerDtls", "Gstin"], BAD_CHECK]]);
    expect(hits(validateIrnRequest(bad).issues, "V5")).toHaveLength(1);
    expect(hits(validateIrnRequest(bad, { gstinCheckDigit: "off" }).issues, "V5")).toHaveLength(0);
    const badState = edit(mapped("intraInvoice"), [[["SellerDtls", "Gstin"], STATE_96]]);
    expect(
      hits(validateIrnRequest(badState, { gstinCheckDigit: "off" }).issues, "V5"),
    ).toHaveLength(1);
  });
});

describe("V12 PIN ranges", () => {
  it("allows 999999 for exports (no state range applies to 96)", () => {
    expect(hits(validateIrnRequest(mapped("exportWithoutPayment")).issues, "V12")).toEqual([]);
  });
  it("matches any of a state's ranges (Daman and Diu has two)", () => {
    expect(PIN_RANGES.filter((r) => r.stateCode === "25")).toHaveLength(2);
  });
  it("the embedded table equals sources/einvoice/master-codes/state-pincode-ranges.csv", () => {
    const csv = readFileSync(
      new URL("../../../sources/einvoice/master-codes/state-pincode-ranges.csv", import.meta.url),
      "utf8",
    )
      .trim()
      .split("\n")
      .slice(1)
      .map((l) => l.split(","));
    const expected = csv.map(([code, , range]) => {
      const [lo, hi] = (range ?? "").split(" - ").map(Number);
      return { stateCode: (code ?? "").padStart(2, "0"), from: lo, to: hi };
    });
    expect([...PIN_RANGES]).toEqual(expected);
  });
});
