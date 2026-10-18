// Source: sources/errors/README.md finding X4, from the VITAL list (https://einvoice1.gst.gov.in/others/geterrorcodes/VITAL)
//         and the e-way bill API list (https://docs.ewaybillgst.gov.in/apidocs/api-error-codes-list.html)
// Retrieved: 2026-10-18
// Status: UNVERIFIED — needs CA; also UNVERIFIED until a live call (gsp spec V11).
// Invalid / expired token codes, for gsp's `authErrorCodes` (opt-in, spec errors §8.3, D-E10). A subset of the `auth`
// category: wrong passwords or client secrets are `auth` too but must not trigger a re-login loop.

export const SESSION_ERROR_CODES = {
  einvoice: ["1005"],
  ewaybill: ["105", "106", "238"],
} as const satisfies Readonly<Record<"einvoice" | "ewaybill", readonly string[]>>;
