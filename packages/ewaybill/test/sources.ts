import { readFileSync } from "node:fs";

/** A file under `sources/` (the repository root), as text. */
export function source(path: string): string {
  return readFileSync(new URL(`../../../sources/${path}`, import.meta.url), "utf8");
}

/** Rows of a simple CSV (no quoted commas). */
export function csv(path: string): string[][] {
  return source(path)
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.split(","));
}
