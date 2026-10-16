// Source: https://einvoice1.gst.gov.in/Others/MasterCodes (table "state / first 3 digits of PIN code");
//         copy in sources/einvoice/master-codes/state-pincode-ranges.csv
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
// A state may have several rows (several ranges); ranges of different states overlap
// (e.g. Telangana 500–509 lies inside Andhra Pradesh 500–535). Used only for warning V12.

export const PIN_RANGES: readonly {
  readonly stateCode: string;
  readonly from: number;
  readonly to: number;
}[] = [
  { stateCode: "01", from: 180, to: 194 }, // JAMMU AND KASHMIR
  { stateCode: "02", from: 171, to: 177 }, // HIMACHAL PRADESH
  { stateCode: "03", from: 140, to: 160 }, // PUNJAB
  { stateCode: "04", from: 160, to: 160 }, // CHANDIGARH
  { stateCode: "05", from: 244, to: 263 }, // UTTARAKHAND
  { stateCode: "06", from: 121, to: 136 }, // HARYANA
  { stateCode: "07", from: 110, to: 110 }, // DELHI
  { stateCode: "08", from: 301, to: 345 }, // RAJASTHAN
  { stateCode: "09", from: 201, to: 285 }, // UTTAR PRADESH
  { stateCode: "10", from: 800, to: 855 }, // BIHAR
  { stateCode: "11", from: 737, to: 737 }, // SIKKIM
  { stateCode: "12", from: 790, to: 792 }, // ARUNACHAL PRADESH
  { stateCode: "13", from: 797, to: 798 }, // NAGALAND
  { stateCode: "14", from: 795, to: 795 }, // MANIPUR
  { stateCode: "15", from: 796, to: 796 }, // MIZORAM
  { stateCode: "16", from: 799, to: 799 }, // TRIPURA
  { stateCode: "17", from: 793, to: 794 }, // MEGHALAYA
  { stateCode: "18", from: 781, to: 788 }, // ASSAM
  { stateCode: "19", from: 700, to: 743 }, // WEST BENGAL
  { stateCode: "20", from: 813, to: 835 }, // JHARKHAND
  { stateCode: "21", from: 751, to: 770 }, // ODISHA
  { stateCode: "22", from: 490, to: 497 }, // CHHATTISGARH
  { stateCode: "23", from: 450, to: 488 }, // MADHYA PRADESH
  { stateCode: "24", from: 360, to: 396 }, // GUJARAT
  { stateCode: "25", from: 362, to: 362 }, // DAMAN AND DIU
  { stateCode: "25", from: 396, to: 396 }, // DAMAN AND DIU
  { stateCode: "26", from: 396, to: 396 }, // DADRA AND NAGAR HAVELI
  { stateCode: "26", from: 362, to: 362 }, // DADRA AND NAGAR HAVELI
  { stateCode: "27", from: 400, to: 445 }, // MAHARASHTRA
  { stateCode: "29", from: 560, to: 591 }, // KARNATAKA
  { stateCode: "30", from: 403, to: 403 }, // GOA
  { stateCode: "31", from: 682, to: 682 }, // LAKSHADWEEP
  { stateCode: "32", from: 670, to: 695 }, // KERALA
  { stateCode: "33", from: 600, to: 643 }, // TAMIL NADU
  { stateCode: "34", from: 533, to: 533 }, // PUDUCHERRY
  { stateCode: "34", from: 605, to: 605 }, // PUDUCHERRY
  { stateCode: "34", from: 607, to: 607 }, // PUDUCHERRY
  { stateCode: "34", from: 609, to: 609 }, // PUDUCHERRY
  { stateCode: "35", from: 744, to: 744 }, // ANDAMAN AND NICOBAR
  { stateCode: "36", from: 500, to: 509 }, // TELANGANA
  { stateCode: "37", from: 500, to: 535 }, // ANDHRA PRADESH
  { stateCode: "38", from: 194, to: 194 }, // LADAKH
];
