// Source: https://docs.ewaybillgst.gov.in/apidocs/sub-docType-mapping.html (source K3);
//         copy in sources/ewaybill/master-codes/sub-supply-doc-type-mapping.csv
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
//
// Which document types are allowed for a (supply type, sub-type), and who the parties are ("Self" = the
// requester's own GSTIN). Used by rule V-G3. A party column of exactly "Self" on both sides means
// fromGstin = toGstin; exactly one "Self" and the other side without "Self" (e.g. "Other GSTIN/URP", "URP")
// means they differ; anything else (e.g. "Self/Other/URP") puts no constraint on the pair.

export interface DocTypeRow {
  readonly supplyType: "O" | "I";
  readonly subSupplyType: string;
  readonly docType: string;
  readonly from: string;
  readonly to: string;
}

export const DOC_TYPE_MAPPING: readonly DocTypeRow[] = [
  { supplyType: "O", subSupplyType: "1", docType: "INV", from: "Self", to: "Other GSTIN/URP" },
  { supplyType: "O", subSupplyType: "1", docType: "BIL", from: "Self", to: "Other GSTIN/URP" },
  { supplyType: "O", subSupplyType: "3", docType: "INV", from: "Self", to: "Other GSTIN/URP" },
  { supplyType: "O", subSupplyType: "3", docType: "BIL", from: "Self", to: "Other GSTIN/URP" },
  { supplyType: "O", subSupplyType: "4", docType: "CHL", from: "Self", to: "Other GSTIN/URP" },
  { supplyType: "O", subSupplyType: "9", docType: "INV", from: "Self", to: "Other GSTIN/URP" },
  { supplyType: "O", subSupplyType: "9", docType: "BIL", from: "Self", to: "Other GSTIN/URP" },
  { supplyType: "O", subSupplyType: "9", docType: "CHL", from: "Self", to: "Other GSTIN/URP" },
  { supplyType: "O", subSupplyType: "11", docType: "CHL", from: "Self", to: "Self" },
  { supplyType: "O", subSupplyType: "11", docType: "OTH", from: "Self", to: "Self" },
  { supplyType: "O", subSupplyType: "5", docType: "CHL", from: "Self", to: "Self" },
  { supplyType: "O", subSupplyType: "12", docType: "CHL", from: "Self", to: "Self" },
  { supplyType: "O", subSupplyType: "10", docType: "CHL", from: "Self", to: "Self" },
  { supplyType: "O", subSupplyType: "8", docType: "CHL", from: "Self", to: "Self/Other/URP" },
  { supplyType: "O", subSupplyType: "8", docType: "OTH", from: "Self", to: "Self/Other/URP" },
  { supplyType: "I", subSupplyType: "1", docType: "INV", from: "Other GSTIN/URP", to: "Self" },
  { supplyType: "I", subSupplyType: "1", docType: "BIL", from: "Other GSTIN/URP", to: "Self" },
  { supplyType: "I", subSupplyType: "2", docType: "BOE", from: "Other GSTIN/URP", to: "Self" },
  { supplyType: "I", subSupplyType: "9", docType: "BOE", from: "URP", to: "Self" },
  { supplyType: "I", subSupplyType: "9", docType: "INV", from: "Other GSTIN/URP", to: "Self" },
  { supplyType: "I", subSupplyType: "9", docType: "BIL", from: "Other GSTIN/URP", to: "Self" },
  { supplyType: "I", subSupplyType: "9", docType: "CHL", from: "Other GSTIN/URP", to: "Self" },
  { supplyType: "I", subSupplyType: "6", docType: "CHL", from: "Other GSTIN/URP", to: "Self" },
  { supplyType: "I", subSupplyType: "7", docType: "CHL", from: "Other GSTIN/URP", to: "Self" },
  { supplyType: "I", subSupplyType: "12", docType: "CHL", from: "Self", to: "Self" },
  { supplyType: "I", subSupplyType: "5", docType: "CHL", from: "Self", to: "Self" },
  { supplyType: "I", subSupplyType: "8", docType: "CHL", from: "Self/Other/URP", to: "Self" },
  { supplyType: "I", subSupplyType: "8", docType: "OTH", from: "Self/Other/URP", to: "Self" },
];

export type PartyRelation = "same" | "differ" | "any";

/** The row for a combination, or `undefined` if K3 does not list it. */
export function findDocTypeRow(
  supplyType: string,
  subSupplyType: string,
  docType: string,
): DocTypeRow | undefined {
  return DOC_TYPE_MAPPING.find(
    (r) =>
      r.supplyType === supplyType && r.subSupplyType === subSupplyType && r.docType === docType,
  );
}

/** What K3 says about `fromGstin` versus `toGstin` for a row. */
export function partyRelation(row: DocTypeRow): PartyRelation {
  const fromSelf = row.from === "Self";
  const toSelf = row.to === "Self";
  if (fromSelf && toSelf) return "same";
  const selfIn = (s: string) => s.split("/").includes("Self");
  if ((fromSelf && !selfIn(row.to)) || (toSelf && !selfIn(row.from))) return "differ";
  return "any";
}
