// Our wording — NOT official text. No legal or tax advice. Never suggests a tax rate (X7).
// Spec errors §7 (D-E7 accepted for v0.1; D-E8 needs CA). The official text is always returned alongside.
import type { ErrorCategory, ErrorListKey, ErrorNote } from "./schemas.js";

export type UserMessages = {
  categories: Readonly<Record<ErrorCategory, string>>;
  /** Per-code overrides, only where the official text is unclear or misleading (spec §7.2). */
  codes: Readonly<Partial<Record<ErrorListKey, Readonly<Record<string, string>>>>>;
};

export const USER_MESSAGES_EN: UserMessages = {
  categories: {
    "fix-data": "Some details were not accepted by the portal. Correct them and try again.",
    "gstin-status":
      "The portal reports a problem with a GSTIN in this request, such as inactive, cancelled, blocked or not enabled. Check the GSTIN's status on the GST portal.",
    "not-allowed":
      "The portal does not allow this action for this document now. Sending it again will not help.",
    "already-done":
      "The portal says this was already done. Fetch the existing record instead of sending it again.",
    "not-found": "The portal could not find this record. Check the number and date.",
    auth: "Signing in to the government portal failed or has expired. Sign in again, or ask your administrator to check the API login details.",
    throttled: "The portal is limiting requests right now. Wait a few minutes before trying again.",
    "retry-later": "The portal had a temporary problem. Try again later.",
    "contact-helpdesk":
      "The portal could not complete this request and asks you to contact its helpdesk. Note the error code and the time.",
    integration:
      "The request was not in the format the portal expects. This is a software problem; please contact your software provider.",
    unknown:
      "The portal returned an error that is not in its published list. Note the error code and contact your software provider.",
    "outcome-unknown":
      "We could not confirm whether the portal received this request. Check its status before sending it again.",
  },
  codes: {
    "einvoice/VITAL": {
      "1014": "This GSTIN is inactive or not enabled for e-invoicing on the portal.",
      "3095":
        "The portal has temporarily stopped e-invoice requests from this software because it received many requests with errors. Stop sending and contact your software provider.",
      "3096":
        "The portal has temporarily stopped e-invoice requests for this user or GSTIN because it received many requests with errors. Stop sending and contact your software provider.",
    },
    "einvoice/INV": {
      "2154": "No IRN details were found for this request.",
      "2240":
        "The GST rate on line {0} was not accepted by the portal. Check the rate for this item with your accountant.",
      "2278":
        "An IRN was generated for this document number and later cancelled. The portal will not accept the same document number again.",
    },
    "einvoice/EWB": {
      "4058":
        'The portal returned code 4058 with only the word "Check". The published list gives no other meaning.',
      "4074": "A ship-to GSTIN is required for this transaction type.",
    },
    "ewaybill/API": {
      "366": "E-way bills generated today cannot be fetched with this request; earlier days' can.",
      "813":
        "The same request was sent twice at the same moment. Wait, then check whether the first one went through before sending again.",
    },
  },
};

/** Notes fixed per code (the others are computed by `describeError`). */
export const CODE_NOTES: Readonly<
  Partial<Record<ErrorListKey, Readonly<Record<string, readonly ErrorNote[]>>>>
> = {
  // The resolution lists rates; it is not a rate list and must never be used as one (X7).
  "einvoice/INV": { "2240": ["X7-not-a-rate-list"] },
};
