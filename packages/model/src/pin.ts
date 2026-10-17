import { z } from "zod";
import { PIN_RANGES } from "./pin-ranges.js";
import type { GstDocument } from "./schema/document.js";

const PIN = /^\d{6}$/;

/**
 * First-3-digit PIN range check (spec §6.7). `"unknown"` when the state has no row in `PIN_RANGES`;
 * `"match"` when the prefix falls in any of the state's ranges; otherwise (or for a non-6-digit
 * value) `"mismatch"`.
 */
export function pinStateCheck(
  pincode: string,
  stateCode: string,
): "match" | "mismatch" | "unknown" {
  const ranges = PIN_RANGES.filter((r) => r.stateCode === stateCode);
  if (ranges.length === 0) return "unknown";
  if (!PIN.test(pincode)) return "mismatch";
  const prefix = Number(pincode.slice(0, 3));
  return ranges.some((r) => prefix >= r.from && prefix <= r.to) ? "match" : "mismatch";
}

export const PinWarningSchema = z.strictObject({
  path: z.array(z.union([z.string(), z.number()])),
  code: z.literal("PIN_STATE_MISMATCH"),
  message: z.string(),
});
export type PinWarning = z.infer<typeof PinWarningSchema>;

/**
 * PIN-vs-state warnings for every address of a parsed document that has a PIN. Warnings only: the
 * portal matches the full PIN against its own master first (decision D-S8). `999999` in state 97 is
 * never flagged (e-invoice validations line 26).
 */
export function documentPinWarnings(doc: GstDocument): PinWarning[] {
  const addresses: [string, { pincode?: string | undefined; stateCode: string } | undefined][] = [
    ["supplier", doc.supplier.address],
    ["recipient", doc.recipient.address],
    ["shipTo", doc.shipTo?.address],
    ["dispatchFrom", doc.dispatchFrom?.address],
  ];
  const out: PinWarning[] = [];
  for (const [party, a] of addresses) {
    if (a?.pincode === undefined) continue;
    if (a.pincode === "999999" && a.stateCode === "97") continue;
    if (pinStateCheck(a.pincode, a.stateCode) === "mismatch") {
      out.push({
        path: [party, "address", "pincode"],
        code: "PIN_STATE_MISMATCH",
        message: `PIN ${a.pincode} is outside the first-3-digit ranges of state ${a.stateCode} (warning: the portal checks its full PIN master first)`,
      });
    }
  }
  return out;
}
