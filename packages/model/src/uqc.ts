// Source: https://einvoice1.gst.gov.in/Others/MasterCodes (table "Unit Code"; copy in sources/einvoice/master-codes/uqc.csv)
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA

export const UQC_CODES: readonly { readonly code: string; readonly description: string }[] = [
  { code: "BAG", description: "BAGS" },
  { code: "BAL", description: "BALE" },
  { code: "BDL", description: "BUNDLES" },
  { code: "BKL", description: "BUCKLES" },
  { code: "BOU", description: "BILLION OF UNITS" },
  { code: "BOX", description: "BOX" },
  { code: "BTL", description: "BOTTLES" },
  { code: "BUN", description: "BUNCHES" },
  { code: "CAN", description: "CANS" },
  { code: "CBM", description: "CUBIC METERS" },
  { code: "CCM", description: "CUBIC CENTIMETERS" },
  { code: "CMS", description: "CENTIMETERS" },
  { code: "CTN", description: "CARTONS" },
  { code: "DOZ", description: "DOZENS" },
  { code: "DRM", description: "DRUMS" },
  { code: "GGK", description: "GREAT GROSS" },
  { code: "GMS", description: "GRAMMES" },
  { code: "GRS", description: "GROSS" },
  { code: "GYD", description: "GROSS YARDS" },
  { code: "KGS", description: "KILOGRAMS" },
  { code: "KLR", description: "KILOLITRE" },
  { code: "KME", description: "KILOMETRE" },
  { code: "LTR", description: "LITRES" },
  { code: "MLT", description: "MILILITRE" },
  { code: "MTR", description: "METERS" },
  { code: "MTS", description: "METRIC TON" },
  { code: "NOS", description: "NUMBERS" },
  { code: "OTH", description: "OTHERS" },
  { code: "PAC", description: "PACKS" },
  { code: "PCS", description: "PIECES" },
  { code: "PRS", description: "PAIRS" },
  { code: "QTL", description: "QUINTAL" },
  { code: "ROL", description: "ROLLS" },
  { code: "SET", description: "SETS" },
  { code: "SQF", description: "SQUARE FEET" },
  { code: "SQM", description: "SQUARE METERS" },
  { code: "SQY", description: "SQUARE YARDS" },
  { code: "TBS", description: "TABLETS" },
  { code: "TGM", description: "TEN GROSS" },
  { code: "THD", description: "THOUSANDS" },
  { code: "TON", description: "TONNES" },
  { code: "TUB", description: "TUBES" },
  { code: "UGS", description: "US GALLONS" },
  { code: "UNT", description: "UNITS" },
  { code: "YDS", description: "YARDS" },
];

const CODES: ReadonlySet<string> = new Set(UQC_CODES.map((u) => u.code));

export function isUqcCode(code: string): boolean {
  return CODES.has(code);
}
