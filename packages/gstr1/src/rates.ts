// Source: GST Offline Tool 3.2.4, data/rate.json "CommGST" — sources/gstr1/offline-tool/data/rate.json (T §4);
//         S5 `rt`: number, multipleOf 0.01, 0..999.99 — sources/gstr1/gstr1-save-v5.0-schema.json
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA

/** The GST rates the GSTR-1 builder accepts, as decimal strings without trailing zeros. */
export const GSTR1_RATES: readonly string[] = [
  "0",
  "0.1",
  "0.25",
  "1",
  "1.5",
  "3",
  "5",
  "6",
  "7.5",
  "12",
  "18",
  "28",
  "40",
];
