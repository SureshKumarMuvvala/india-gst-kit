import { inspect } from "node:util";

export const REDACTED = "[REDACTED]";

/** Holds a secret value; `toString`, `toJSON` and `util.inspect` never show it. */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}

export type SecretInput = string | Secret;

export function reveal(value: SecretInput): string {
  return typeof value === "string" ? value : value.reveal();
}

/** Values shorter than this are not registered: replacing them everywhere would garble unrelated text. */
const MIN_REDACT_LENGTH = 6;

/**
 * Replaces every registered secret value with `[REDACTED]` in strings, arrays and plain objects. Every string
 * placed in an error, warning, log event or `raw` field passes through it (spec §6.4).
 */
export class Redactor {
  readonly #values = new Set<string>();

  add(...values: readonly (string | undefined)[]): void {
    for (const v of values)
      if (v !== undefined && v.length >= MIN_REDACT_LENGTH) this.#values.add(v);
  }

  /** Registers the bytes in Base64, Base64url and hex. */
  addBytes(bytes: Uint8Array): void {
    const b = Buffer.from(bytes);
    this.add(b.toString("base64"), b.toString("base64url"), b.toString("hex"));
  }

  text(s: string): string {
    let out = s;
    // Longest first, so a secret that contains another is replaced whole.
    for (const v of [...this.#values].sort((a, b) => b.length - a.length)) {
      out = out.split(v).join(REDACTED);
    }
    return out;
  }

  deep(value: unknown): unknown {
    if (typeof value === "string") return this.text(value);
    if (Array.isArray(value)) return value.map((v: unknown) => this.deep(v));
    if (typeof value === "object" && value !== null) {
      if (value instanceof Secret) return REDACTED;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.deep(v);
      return out;
    }
    return value;
  }
}
