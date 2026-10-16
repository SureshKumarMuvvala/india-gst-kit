// Source: https://docs.ewaybillgst.gov.in/apidocs/version1.03/generate-eway-bill.html#validations (source H):
//         "Generation of E Way Bill using the E Way Bill API System will be blocked … where the Supplier is
//         enabled for E Invoice … B2B and Export transactions where document date is equal to or greater than
//         01/10/2020 … Tax Invoice"; sources/ewaybill/generate-ewaybill-validations.txt. Credit/debit notes and
//         all-service documents: H, I, C validations.
// Retrieved: 2026-10-16
// Status: UNVERIFIED — needs CA
import type { GstDocument } from "@india-gst-kit/model";
import { EINVOICE_EWB_BLOCK_FROM } from "./rules.js";
import { issue, type EwbIssue } from "./types.js";

export type EwbRouteName = "GENERATE" | "IRN" | "NONE";
export interface EwbRouteResult {
  route: EwbRouteName;
  reasons: EwbIssue[];
}
export interface EwbRouteOptions {
  /** Whether the supplier is enabled for e-invoicing. Portal data: it cannot be derived offline. */
  supplierEInvoiceEnabled?: boolean;
}

const isExport = (doc: GstDocument): boolean =>
  doc.supplyCategory === "EXPORT_WITH_PAYMENT" || doc.supplyCategory === "EXPORT_WITHOUT_PAYMENT";

/** Which of the three e-way bill routes applies to a document (spec §4). Does not decide whether one is required. */
export function ewbRoute(doc: GstDocument, options: EwbRouteOptions = {}): EwbRouteResult {
  if (doc.kind === "CREDIT_NOTE" || doc.kind === "DEBIT_NOTE") {
    return {
      route: "NONE",
      reasons: [
        issue(
          ["kind"],
          "NOT_EWB_DOCUMENT",
          "R-NONE",
          "an e-way bill is not generated for credit or debit notes",
        ),
      ],
    };
  }
  if (doc.lines.every((l) => l.isService || l.hsnSac.startsWith("99"))) {
    return {
      route: "NONE",
      reasons: [
        issue(
          ["lines"],
          "NOT_EWB_DOCUMENT",
          "R-NONE",
          "an e-way bill needs at least one line with a goods HSN",
        ),
      ],
    };
  }
  const irnShape =
    doc.kind === "TAX_INVOICE" &&
    (doc.recipient.gstin !== undefined || isExport(doc)) &&
    doc.date >= EINVOICE_EWB_BLOCK_FROM;
  if (!irnShape) return { route: "GENERATE", reasons: [] };
  if (options.supplierEInvoiceEnabled === true) return { route: "IRN", reasons: [] };
  if (options.supplierEInvoiceEnabled === undefined) {
    return {
      route: "GENERATE",
      reasons: [
        issue(
          [],
          "EINVOICE_STATUS_UNKNOWN",
          "R-EINVOICE-STATUS",
          "whether the supplier is enabled for e-invoicing is unknown: if it is, use the IRN route",
          "warning",
        ),
      ],
    };
  }
  return { route: "GENERATE", reasons: [] };
}
