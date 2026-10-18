// Source: validations of https://einv-apisandbox.nic.in/version1.03/{cancel-irn,get-eInvoicedetails,
//         Get_IRNdetailsbyDocDetails}.html and https://docs.ewaybillgst.gov.in/apidocs/version1.03/{cancel-eway-bill,
//         reject-eway-bill,extend-validity,vehicle-number-update,update-transporter,consolidated-eway-bill}.html —
//         sources/einvoice/api/*.txt, sources/ewaybill/api/*.txt (finding G6)
// Retrieved: 2026-10-18
// Status: UNVERIFIED — needs CA (D-G15: hours from the portal timestamp in IST; "three days" read as 72 h)
//
// Time limits are WARNINGS ONLY: they never block a request (spec §10).
import { parsePortalDateTime } from "./datetime.js";
import { warning, type GspIssue } from "./issues.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type EwbRole = "generator" | "transporter" | "other-party";

function at(field: string, value: string | undefined, out: GspIssue[]): number | undefined {
  if (value === undefined) return undefined;
  const t = parsePortalDateTime(value);
  if (t === undefined)
    out.push(warning("PRECHECK_DATE_UNPARSEABLE", `${field} "${value}" cannot be read`, [field]));
  return t;
}

/** PC1: within 24 h of generation; not while an active e-way bill exists. */
export function precheckCancelIrn(
  ctx: { ackDt?: string; activeEwbExists?: boolean },
  now: number,
): GspIssue[] {
  const out: GspIssue[] = [];
  const t = at("ackDt", ctx.ackDt, out);
  if (t !== undefined && now > t + 24 * HOUR) {
    out.push(
      warning("IRN_CANCEL_WINDOW_PASSED", "IRN can be cancelled within 24 hours of generation"),
    );
  }
  if (ctx.activeEwbExists === true) {
    out.push(
      warning("IRN_HAS_ACTIVE_EWB", "IRN cannot be cancelled while an active e-way bill exists"),
    );
  }
  return out;
}

/** PC2: get e-invoice / IRN by document details within three days (72 h) of generation. */
export function precheckIrnLookup(ctx: { ackDt?: string }, now: number): GspIssue[] {
  const out: GspIssue[] = [];
  const t = at("ackDt", ctx.ackDt, out);
  if (t !== undefined && now > t + 72 * HOUR) {
    out.push(
      warning("IRN_LOOKUP_WINDOW_PASSED", "IRN can be retrieved within three days of generation"),
    );
  }
  return out;
}

/** PC3: cancel within 24 h, by the generator only. */
export function precheckCancelEwb(
  ctx: { ewbDate?: string; role?: EwbRole },
  now: number,
): GspIssue[] {
  const out: GspIssue[] = [];
  const t = at("ewbDate", ctx.ewbDate, out);
  if (t !== undefined && now > t + 24 * HOUR) {
    out.push(
      warning(
        "EWB_CANCEL_WINDOW_PASSED",
        "e-way bill can be cancelled within 24 hours of generation",
      ),
    );
  }
  if (ctx.role !== undefined && ctx.role !== "generator") {
    out.push(
      warning("EWB_CANCEL_NOT_GENERATOR", "e-way bill can be cancelled by its generator only"),
    );
  }
  return out;
}

/** PC4: reject within 72 h, by the other party (not the generator). */
export function precheckRejectEwb(
  ctx: { ewbDate?: string; role?: EwbRole },
  now: number,
): GspIssue[] {
  const out: GspIssue[] = [];
  const t = at("ewbDate", ctx.ewbDate, out);
  if (t !== undefined && now > t + 72 * HOUR) {
    out.push(
      warning(
        "EWB_REJECT_WINDOW_PASSED",
        "e-way bill can be rejected within 72 hours of generation",
      ),
    );
  }
  if (ctx.role === "generator") {
    out.push(
      warning(
        "EWB_REJECT_BY_GENERATOR",
        "e-way bill is rejected by the other party, not its generator",
      ),
    );
  }
  return out;
}

/**
 * PC5: extend between 8 h before and 8 h after expiry; not beyond 360 days of generation; by the current
 * transporter (or the generator when none is assigned) — so `other-party` warns.
 */
export function precheckExtendValidity(
  ctx: { validUpto?: string; ewbDate?: string; role?: EwbRole },
  now: number,
): GspIssue[] {
  const out: GspIssue[] = [];
  const v = at("validUpto", ctx.validUpto, out);
  if (v !== undefined && (now < v - 8 * HOUR || now > v + 8 * HOUR)) {
    out.push(
      warning(
        "EWB_EXTEND_OUTSIDE_WINDOW",
        "validity can be extended from 8 hours before to 8 hours after expiry",
      ),
    );
  }
  const g = at("ewbDate", ctx.ewbDate, out);
  if (g !== undefined && now > g + 360 * DAY) {
    out.push(
      warning(
        "EWB_EXTEND_BEYOND_360_DAYS",
        "validity cannot be extended beyond 360 days of generation",
      ),
    );
  }
  if (ctx.role === "other-party") {
    out.push(
      warning(
        "EWB_EXTEND_ROLE",
        "validity is extended by the current transporter, or the generator if none",
      ),
    );
  }
  return out;
}

/** PC6: Part-B / transporter update and consolidation only while the e-way bill is active and valid. */
export function precheckEwbActive(
  ctx: { validUpto?: string; status?: string },
  now: number,
): GspIssue[] {
  const out: GspIssue[] = [];
  const v = at("validUpto", ctx.validUpto, out);
  if (v !== undefined && now > v)
    out.push(warning("EWB_VALIDITY_EXPIRED", "e-way bill validity has expired"));
  if (ctx.status?.trim() === "CNL") out.push(warning("EWB_CANCELLED", "e-way bill is cancelled"));
  return out;
}
