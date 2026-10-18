// Source: https://developer.gst.gov.in/apiportal/taxpayer/returns — "GSTR3B – Get ITC Liability Auto Calc Details" (3183)
//         v7.1, Draft — sources/gstr3b/GSTR3B - Get ITC Liability Auto Calc Details response_schema v7.1.json (AC):
//         mapping M = AC key names under r3bautopop.liabitc (README R5; spec §4.2). Row G-numbers: spec §4.1, sourced
//         from FORM GSTR-1 (sources/gstr1/form-gstr1-excerpt-18052021.txt) except G5 (unmapped). Track A2 rows
//         G11–G14 (spec §22): Table 8 → 3.1c/3.1e, 9A, 9C, 10 (FORM GSTR-1; Notification 26/2022-CT,
//         sources/gstr1/notification-26-2022-ct-gstr1-excerpt.txt); G15 advances in a separate opt-in map (D-A14):
//         the tbl11a/b suffixes are undefined in AC (Q-H2), their signs follow FORM GSTR-3B Instruction 1.
// Retrieved: 2026-10-18
// Status: UNVERIFIED — needs CA
import type { AmountKey } from "./return-schema.js";
import type { BoxId } from "./types.js";

export type AcMapRow = {
  readonly box: Extract<
    BoxId,
    "3.1a" | "3.1b" | "3.1c" | "3.1e" | "3.2unreg" | "3.2comp" | "3.2uin"
  >;
  /** AC det key, e.g. "tbl4a". */
  readonly table: string;
  /** Path under r3bautopop.liabitc. */
  readonly acPath: string;
  /** The fields AC's det node carries (leaves minus val/form), in our names. */
  readonly fields: readonly AmountKey[];
  readonly fedBy: string;
};

const H5: readonly AmountKey[] = ["taxableValue", "igst", "cgst", "sgst", "cess"];
const ZR: readonly AmountKey[] = ["taxableValue", "igst", "cess"];
const P2: readonly AmountKey[] = ["taxableValue", "igst"];

/** Mapping M as quoted from AC (spec §4.2). Only these rows are applied by `outwardFromGstr1`. */
export const AC_GSTR1_MAP: readonly AcMapRow[] = [
  {
    box: "3.1a",
    table: "tbl4a",
    acPath: "sup_details.osup_3_1a.det.tbl4a",
    fields: H5,
    fedBy: "G1",
  },
  {
    box: "3.1a",
    table: "tbl4b",
    acPath: "sup_details.osup_3_1a.det.tbl4b",
    fields: ["taxableValue"],
    fedBy: "G2",
  },
  {
    box: "3.1a",
    table: "tbl5a",
    acPath: "sup_details.osup_3_1a.det.tbl5a",
    fields: ZR,
    fedBy: "G6",
  },
  {
    box: "3.1a",
    table: "tbl6c",
    acPath: "sup_details.osup_3_1a.det.tbl6c",
    fields: H5,
    fedBy: "G4",
  },
  {
    box: "3.1a",
    table: "tbl7a_1",
    acPath: "sup_details.osup_3_1a.det.tbl7a_1",
    fields: ["taxableValue", "cgst", "sgst", "cess"],
    fedBy: "G8",
  },
  {
    box: "3.1a",
    table: "tbl7b_1",
    acPath: "sup_details.osup_3_1a.det.tbl7b_1",
    fields: ZR,
    fedBy: "G9",
  },
  {
    box: "3.1a",
    table: "tbl9b",
    acPath: "sup_details.osup_3_1a.det.tbl9b",
    fields: H5,
    fedBy: "G10 (R, DE, B2CL)",
  },
  {
    box: "3.1b",
    table: "tbl6a",
    acPath: "sup_details.osup_3_1b.det.tbl6a",
    fields: ZR,
    fedBy: "G7",
  },
  {
    box: "3.1b",
    table: "tbl6b",
    acPath: "sup_details.osup_3_1b.det.tbl6b",
    fields: ZR,
    fedBy: "G3",
  },
  {
    box: "3.1b",
    table: "tbl9b",
    acPath: "sup_details.osup_3_1b.det.tbl9b",
    fields: ZR,
    fedBy: "G10 (SEWP, SEWOP, EXPWP, EXPWOP)",
  },
  {
    box: "3.2comp",
    table: "tbl4a",
    acPath: "inter_sup.osup_comp_3_2.det.tbl4a",
    fields: P2,
    fedBy: "G1, COMPOSITION",
  },
  {
    box: "3.2comp",
    table: "tbl9b",
    acPath: "inter_sup.osup_comp_3_2.det.tbl9b",
    fields: P2,
    fedBy: "G10 cdnr R, COMPOSITION",
  },
  {
    box: "3.2uin",
    table: "tbl4a",
    acPath: "inter_sup.osup_uin_3_2.det.tbl4a",
    fields: P2,
    fedBy: "G1, UIN_HOLDER",
  },
  {
    box: "3.2uin",
    table: "tbl9b",
    acPath: "inter_sup.osup_uin_3_2.det.tbl9b",
    fields: P2,
    fedBy: "G10 cdnr R, UIN_HOLDER",
  },
  {
    box: "3.2unreg",
    table: "tbl5a",
    acPath: "inter_sup.osup_unreg_3_2.det.tbl5a",
    fields: P2,
    fedBy: "G6",
  },
  {
    box: "3.2unreg",
    table: "tbl7b_1",
    acPath: "inter_sup.osup_unreg_3_2.det.tbl7b_1",
    fields: P2,
    fedBy: "G9",
  },
  {
    box: "3.2unreg",
    table: "tbl9b",
    acPath: "inter_sup.osup_unreg_3_2.det.tbl9b",
    fields: P2,
    fedBy: "G10 cdnur B2CL",
  },
  // ---- Track A2 (spec §22.2) ----
  {
    box: "3.1c",
    table: "tbl8",
    acPath: "sup_details.osup_3_1c.det.tbl8",
    fields: ["taxableValue"],
    fedBy: "G11 nil rated + exempted",
  },
  {
    box: "3.1e",
    table: "tbl8",
    acPath: "sup_details.osup_3_1e.det.tbl8",
    fields: ["taxableValue"],
    fedBy: "G11 non-GST",
  },
  {
    box: "3.1a",
    table: "tbl9a",
    acPath: "sup_details.osup_3_1a.det.tbl9a",
    fields: H5,
    fedBy: "G12 (R, DE, B2CL)",
  },
  {
    box: "3.1a",
    table: "tbl9c",
    acPath: "sup_details.osup_3_1a.det.tbl9c",
    fields: H5,
    fedBy: "G13 (R, DE, B2CL)",
  },
  {
    box: "3.1a",
    table: "tbl10a",
    acPath: "sup_details.osup_3_1a.det.tbl10a",
    fields: ["taxableValue", "cgst", "sgst", "cess"],
    fedBy: "G14 INTRA",
  },
  {
    box: "3.1a",
    table: "tbl10b",
    acPath: "sup_details.osup_3_1a.det.tbl10b",
    fields: ZR,
    fedBy: "G14 INTER",
  },
  {
    box: "3.1b",
    table: "tbl9a",
    acPath: "sup_details.osup_3_1b.det.tbl9a",
    fields: ZR,
    fedBy: "G12 (SEWP, SEWOP, WPAY, WOPAY)",
  },
  {
    box: "3.1b",
    table: "tbl9c",
    acPath: "sup_details.osup_3_1b.det.tbl9c",
    fields: ZR,
    fedBy: "G13 (SEWP, SEWOP, EXPWP, EXPWOP)",
  },
  ...(["3.2comp", "3.2uin"] as const).flatMap((box) =>
    (["tbl9a", "tbl9c"] as const).map((table) => ({
      box,
      table,
      acPath: `inter_sup.${box === "3.2comp" ? "osup_comp_3_2" : "osup_uin_3_2"}.det.${table}`,
      fields: P2,
      fedBy: `${table === "tbl9a" ? "G12 b2ba" : "G13 cdnra"} R, ${box === "3.2comp" ? "COMPOSITION" : "UIN_HOLDER"}`,
    })),
  ),
  ...(["tbl9a", "tbl9c", "tbl10b"] as const).map((table) => ({
    box: "3.2unreg" as const,
    table,
    acPath: `inter_sup.osup_unreg_3_2.det.${table}`,
    fields: P2,
    fedBy: table === "tbl9a" ? "G12 b2cla" : table === "tbl9c" ? "G13 cdnura B2CL" : "G14 INTER",
  })),
];

/**
 * G15, advances (spec §22.2, D-A14): applied only with `confirmAdvanceMapping: true`. Received (`tbl11a_*`) adds,
 * adjusted (`tbl11b_*`) subtracts (FORM GSTR-3B Instruction 1; AC `#negtxamt`). The suffix meanings are inferred.
 */
export const AC_ADVANCE_MAP: readonly AcMapRow[] = (["a", "b"] as const).flatMap((ab) => {
  const what = ab === "a" ? "at (received)" : "txpd (adjusted)";
  return [
    {
      box: "3.1a" as const,
      table: `tbl11${ab}_1_2_4`,
      acPath: `sup_details.osup_3_1a.det.tbl11${ab}_1_2_4`,
      fields: H5,
      fedBy: `G15 ${what} B2B / B2C`,
    },
    {
      box: "3.1b" as const,
      table: `tbl11${ab}_3`,
      acPath: `sup_details.osup_3_1b.det.tbl11${ab}_3`,
      fields: ZR,
      fedBy: `G15 ${what} EXPORT`,
    },
    {
      box: "3.2unreg" as const,
      table: `tbl11${ab}_4_5`,
      acPath: `inter_sup.osup_unreg_3_2.det.tbl11${ab}_4_5`,
      fields: P2,
      fedBy: `G15 ${what} INTER B2C`,
    },
    ...(["3.2comp", "3.2uin"] as const).map((box) => ({
      box,
      table: `tbl11${ab}_1_5`,
      acPath: `inter_sup.${box === "3.2comp" ? "osup_comp_3_2" : "osup_uin_3_2"}.det.tbl11${ab}_1_5`,
      fields: P2,
      fedBy: `G15 ${what} INTER B2B, ${box === "3.2comp" ? "COMPOSITION" : "UIN_HOLDER"}`,
    })),
  ];
});

/**
 * AC det keys that feed these boxes but that `gstr1` cannot produce (spec §4.3, §22.3); caller input when they
 * apply. With `confirmAdvanceMapping` the keys of {@link AC_ADVANCE_MAP} are taken out (spec §22.3).
 */
export const AC_NOT_COVERED: Readonly<
  Record<"3.1a" | "3.1b" | "3.1c" | "3.1e" | "3.2unreg" | "3.2comp" | "3.2uin", readonly string[]>
> = {
  "3.1a": [
    "tbl4c",
    "tbl4f",
    "tbl5b",
    "tbl11a_1_2_4",
    "tbl11b_1_2_4",
    "tbl11c_1_2_4",
    "tbl11d_1_2_4",
    "tbl11_i_a_1",
    "tbl11_i_a_2",
    "tbl11_i_b_1",
    "tbl11_i_b_2",
    "tbl11_ii",
    "ims_9b_cn",
    "ims_9c_cn",
    "ims_9a_9c_dn",
  ],
  "3.1b": [
    "tbl9bSezEco",
    "tbl9cSezEco",
    "tbl9bSezEcourp2b",
    "tbl9cSezEcourp2b",
    "tbl11a_3",
    "tbl11a_5",
    "tbl11b_3",
    "tbl11b_5",
    "tbl11c_3",
    "tbl11c_5",
    "tbl11d_3",
    "tbl11d_5",
    "tbl15b2b",
    "tbl15urp2b",
    "tbl15b2ba",
    "tbl15urp2ba",
    "ims_9b_cn",
    "ims_9c_cn",
    "ims_9a_9c_dn",
    "ims_9b_cn_eb2b",
    "ims_9b_cn_ec2b",
    "ims_9c_cn_eb2b",
    "ims_9c_cn_ec2b",
    "ims_9a_9c_dn_eb2b",
    "ims_9a_9c_dn_ec2b",
    "ims_15_b2ba",
    "ims_15_urp2ba",
  ],
  "3.1c": [],
  "3.1e": [],
  "3.2unreg": [
    "tbl11_i_a_2",
    "tbl11_i_b_2",
    "tbl11_ii",
    "tbl11a_4_5",
    "tbl11b_4_5",
    "tbl11c_4_5",
    "tbl11d_4_5",
    "tbl15b2c",
    "tbl15urp2c",
    "tbl15b2ca",
    "tbl15urp2ca",
  ],
  "3.2comp": [
    "tbl4c",
    "tbl11a_1_5",
    "tbl11b_1_5",
    "tbl11c_1_5",
    "tbl11d_1_5",
    "tbl15b2b",
    "tbl15urp2b",
    "tbl15b2ba",
    "tbl15urp2ba",
  ],
  "3.2uin": [
    "tbl4c",
    "tbl11a_1_5",
    "tbl11b_1_5",
    "tbl11c_1_5",
    "tbl11d_1_5",
    "tbl15b2b",
    "tbl15urp2b",
    "tbl15b2ba",
    "tbl15urp2ba",
  ],
};

/** AC box node (under the block) holding each box's subtotal (spec §3.2, §9.2). */
export const AC_BOX_PATH: Readonly<Partial<Record<BoxId, string>>> = {
  "3.1a": "sup_details.osup_3_1a",
  "3.1b": "sup_details.osup_3_1b",
  "3.1c": "sup_details.osup_3_1c",
  "3.1d": "sup_details.isup_3_1d",
  "3.1e": "sup_details.osup_3_1e",
  "3.1.1i": "sup_details.esup_3_1_1a",
  "3.1.1ii": "sup_details.esup_3_1_1b",
  "3.2unreg": "inter_sup.osup_unreg_3_2",
  "3.2comp": "inter_sup.osup_comp_3_2",
  "3.2uin": "inter_sup.osup_uin_3_2",
};

/** The ITC pairings proposed by D-H8; compared only with `confirmItcMapping: true`. */
export const AC_ITC_PAIRING: Readonly<Partial<Record<BoxId, string>>> = {
  "4A.IMPG": "elgitc.itc4a1",
  "4A.ISRC": "elgitc.itc4a3",
  "4A.ISD": "elgitc.itc4a4",
  "4A.OTH": "elgitc.itc4a5",
};
/** AC ITC nodes never paired (D-H8). */
export const AC_ITC_UNPAIRED = ["elgitc.itc4b2", "elgitc.itc4d2"] as const;
