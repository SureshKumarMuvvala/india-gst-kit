// Synthetic GSTINs for tests. NOT real registrations: the 10-character PAN-like parts are
// obviously fake (repeated letters/digits) and the 15th character is computed with the
// mod-36 algorithm in docs/specs/model.md §6.4 (UNVERIFIED — needs CA).
// No official sample GSTINs exist (sources/README.md, finding 1).
export const GSTINS = {
  /** Karnataka (29) regular supplier */
  supplierKa: "29AAAAA0000A1ZY",
  /** Maharashtra (27) regular recipient */
  recipientMh: "27BBBBB1111B1ZN",
  /** Karnataka (29) regular recipient */
  recipientKa: "29CCCCC2222C1Z4",
  /** Delhi (07) composition supplier */
  compositionDl: "07DDDDD3333D1ZV",
  /** Chandigarh (04) recipient — a UTGST territory */
  recipientCh: "04EEEEE4444E1ZM",
  /** Maharashtra (27) SEZ unit recipient */
  sezMh: "27FFFFF5555F1ZZ",
  /** Karnataka (29) — spare, used for same-GSTIN-both-sides style tests */
  spareKa: "29GGGGG6666G1ZG",
  /** Andaman and Nicobar (35) — spare */
  spareAn: "35HHHHH7777H1Z8",
  /** Chandigarh (04) — spare, a second UTGST-territory GSTIN for intra-UT tests */
  spareCh: "04IIIII8888I1ZV",
  /** Tamil Nadu (33) — third-party ship-to consignee (Track E) */
  shipToTn: "33JJJJJ9999J1ZF",
  /** Karnataka (29) — valid under the model (mod-36) but its 13th character is 0, so it fails the PAN-structured
   *  GSTIN pattern of the GSTR-3B Save schema (Track G, gstr3b spec V4) */
  notPanStructuredKa: "29KKKKK1234K0Z0",
} as const;

export const ALLOWED_FIXTURE_GSTINS: readonly string[] = Object.values(GSTINS);
