import { GSTINS, fixtures, type FixtureName } from "@india-gst-kit/fixtures";
import { toIrnRequest, type IrnRequest } from "@india-gst-kit/einvoice";
import {
  toEwbByIrnRequest,
  toEwbRequest,
  type EwbByIrnRequest,
  type EwbRequest,
} from "@india-gst-kit/ewaybill";
import { parseGstDocument, type GstDocument } from "@india-gst-kit/model";
import { expect } from "vitest";
import {
  createGspClient,
  createNicDirectProvider,
  type GspClientConfig,
  type GspLogEvent,
  type GspResult,
  type NicDirectOptions,
} from "../src/index.js";
import { CREDENTIALS, EI_BASE, EWB_BASE, MockNic, type MockOptions } from "./mock-nic.js";
import { seededRandom, testKeys } from "./nic-crypto.js";

export { GSTINS };
export const GSTIN = GSTINS.supplierKa;
/** 2026-10-18 10:00 IST. */
export const T0 = Date.UTC(2026, 9, 18, 4, 30, 0);
export const MIN = 60_000;
export const HOUR = 60 * MIN;

export class TestClock {
  t: number;
  constructor(t = T0) {
    this.t = t;
  }
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

export type Setup = {
  clock: TestClock;
  mock: MockNic;
  client: ReturnType<typeof createGspClient>;
  logs: GspLogEvent[];
  sleeps: number[];
};

export function setup(
  opts: {
    mock?: Partial<MockOptions>;
    provider?: Partial<NicDirectOptions>;
    client?: Partial<GspClientConfig>;
    clock?: TestClock;
  } = {},
): Setup {
  const clock = opts.clock ?? new TestClock();
  const mock = new MockNic({ now: clock.now, ...opts.mock });
  const logs: GspLogEvent[] = [];
  const sleeps: number[] = [];
  const provider = createNicDirectProvider({
    baseUrls: { einvoice: EI_BASE, ewaybill: EWB_BASE },
    ...opts.provider,
  });
  const client = createGspClient({
    provider,
    credentials: () => ({ ...CREDENTIALS, publicKey: testKeys().publicPem }),
    fetch: mock.fetch,
    clock,
    sleep: (ms) => {
      sleeps.push(ms);
      clock.advance(ms);
      return Promise.resolve();
    },
    randomBytes: seededRandom(7),
    logger: (e) => logs.push(e),
    ...opts.client,
  });
  return { clock, mock, client, logs, sleeps };
}

export function expectOk<T>(r: GspResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

export function expectErr<T>(r: GspResult<T>) {
  if (r.ok) throw new Error(`expected an error, got ${JSON.stringify(r.value)}`);
  return r.error;
}

export function codes(r: { warnings: { code: string }[] }): string[] {
  return r.warnings.map((w) => w.code);
}

export function doc(name: FixtureName): GstDocument {
  const r = parseGstDocument(structuredClone(fixtures[name]));
  if (!r.success) throw new Error("fixture does not parse");
  return r.data;
}

export function irnRequest(name: FixtureName = "interInvoice"): IrnRequest {
  const r = toIrnRequest(doc(name));
  if (!r.ok) throw new Error(`fixture does not map: ${JSON.stringify(r.issues)}`);
  return r.value;
}

const road = {
  transport: { distanceKm: "150", mode: "ROAD", vehicleNo: "KA01AB1234", vehicleType: "REGULAR" },
} as const;

export function ewbRequest(name: FixtureName = "interInvoice"): EwbRequest {
  const r = toEwbRequest(doc(name), road, { supplierEInvoiceEnabled: false });
  if (!r.ok) throw new Error(`fixture does not map: ${JSON.stringify(r.issues)}`);
  return r.value;
}

export function ewbByIrnRequest(): EwbByIrnRequest {
  const r = toEwbByIrnRequest("0f2a".repeat(16), road);
  if (!r.ok) throw new Error(`does not map: ${JSON.stringify(r.issues)}`);
  return r.value;
}

/** The URL of a fetch input. */
export function urlOf(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/** A copy of `obj` without `key`. */
export function omit<T extends object>(obj: T, key: keyof T): Partial<T> {
  const copy: Partial<T> = { ...obj };
  Reflect.deleteProperty(copy, key);
  return copy;
}

/** Collects every string in a value, deeply. */
export function allText(value: unknown): string {
  return JSON.stringify(value);
}

export { expect };
