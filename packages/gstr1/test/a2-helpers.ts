import { expect } from "vitest";
import type { GstDocument } from "@india-gst-kit/model";
import type { Gstr1Input } from "../src/index.js";
import * as h from "./helpers.js";

// Spec §17.13: every output (a) in the Track A2 tests validates against S5, every output (b) against S4.

export function api(
  documents: readonly GstDocument[],
  extra: Partial<Gstr1Input> = {},
): Record<string, unknown> {
  const j = h.api(documents, extra);
  expect(h.validateS5(j) || JSON.stringify(h.validateS5.errors)).toBe(true);
  return j;
}

export function offline(
  documents: readonly GstDocument[],
  extra: Partial<Gstr1Input> = {},
): Record<string, unknown> {
  const j = h.offline(documents, extra);
  expect(h.validateS4(j) || JSON.stringify(h.validateS4.errors)).toBe(true);
  return j;
}
