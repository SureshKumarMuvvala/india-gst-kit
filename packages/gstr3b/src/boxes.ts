import type { AmountKey, Gstr3bReturn, PosRow } from "./return-schema.js";
import type { BoxId } from "./types.js";

const H5 = ["taxableValue", "igst", "cgst", "sgst", "cess"] as const;
const H4 = ["igst", "cgst", "sgst", "cess"] as const;

/** The fields each box carries (SV field sets, spec §3.2). */
export const BOX_FIELDS: Readonly<Record<BoxId, readonly AmountKey[]>> = {
  "3.1a": H5,
  "3.1b": ["taxableValue", "igst", "cess"],
  "3.1c": ["taxableValue"],
  "3.1d": H5,
  "3.1e": ["taxableValue"],
  "3.1.1i": H5,
  "3.1.1ii": ["taxableValue"],
  "3.2unreg": ["taxableValue", "igst"],
  "3.2comp": ["taxableValue", "igst"],
  "3.2uin": ["taxableValue", "igst"],
  "4A.IMPG": H4,
  "4A.IMPS": H4,
  "4A.ISRC": H4,
  "4A.ISD": H4,
  "4A.OTH": H4,
  "4B.RUL": H4,
  "4B.OTH": H4,
  "4C": H4,
  "4D.RUL": H4,
  "4D.OTH": H4,
  "5.GST": ["inter", "intra"],
  "5.NONGST": ["inter", "intra"],
  "5.1": H4,
};

export const POS_BOXES = ["3.2unreg", "3.2comp", "3.2uin"] as const;
export type PosBox = (typeof POS_BOXES)[number];
export function isPosBox(box: BoxId): box is PosBox {
  return (POS_BOXES as readonly string[]).includes(box);
}

export function posList(ret: Gstr3bReturn, box: PosBox): PosRow[] {
  if (box === "3.2unreg") return ret.t32.unregistered;
  if (box === "3.2comp") return ret.t32.composition;
  return ret.t32.uinHolders;
}

/** The object holding a non-3.2 box's fields. */
export function boxObject(
  ret: Gstr3bReturn,
  box: Exclude<BoxId, PosBox>,
): Partial<Record<AmountKey, string>> {
  switch (box) {
    case "3.1a":
      return ret.t31.a;
    case "3.1b":
      return ret.t31.b;
    case "3.1c":
      return ret.t31.c;
    case "3.1d":
      return ret.t31.d;
    case "3.1e":
      return ret.t31.e;
    case "3.1.1i":
      return ret.t311.i;
    case "3.1.1ii":
      return ret.t311.ii;
    case "4A.IMPG":
      return ret.t4.available.IMPG;
    case "4A.IMPS":
      return ret.t4.available.IMPS;
    case "4A.ISRC":
      return ret.t4.available.ISRC;
    case "4A.ISD":
      return ret.t4.available.ISD;
    case "4A.OTH":
      return ret.t4.available.OTH;
    case "4B.RUL":
      return ret.t4.reversed.RUL;
    case "4B.OTH":
      return ret.t4.reversed.OTH;
    case "4C":
      return ret.t4.net;
    case "4D.RUL":
      return ret.t4.ineligible.RUL;
    case "4D.OTH":
      return ret.t4.ineligible.OTH;
    case "5.GST":
      return ret.t5.GST;
    case "5.NONGST":
      return ret.t5.NONGST;
    case "5.1":
      return ret.t51.interest;
  }
}

const Z = "0.00";
const h5 = () => ({ taxableValue: Z, igst: Z, cgst: Z, sgst: Z, cess: Z });
const h4 = () => ({ igst: Z, cgst: Z, sgst: Z, cess: Z });

/** A return with every box present and zero (D-H1). */
export function emptyReturn(gstin: string, period: string): Gstr3bReturn {
  return {
    gstin,
    period,
    t31: {
      a: h5(),
      b: { taxableValue: Z, igst: Z, cess: Z },
      c: { taxableValue: Z },
      d: h5(),
      e: { taxableValue: Z },
    },
    t311: { i: h5(), ii: { taxableValue: Z } },
    t32: { unregistered: [], composition: [], uinHolders: [] },
    t4: {
      available: { IMPG: h4(), IMPS: h4(), ISRC: h4(), ISD: h4(), OTH: h4() },
      reversed: { RUL: h4(), OTH: h4() },
      net: h4(),
      ineligible: { RUL: h4(), OTH: h4() },
    },
    t5: { GST: { inter: Z, intra: Z }, NONGST: { inter: Z, intra: Z } },
    t51: { interest: h4() },
  };
}
