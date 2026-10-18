// Types for gen-error-data.mjs, so tests can import render() and readList().
export type SourceList = {
  key: string;
  file: string;
  out: string;
  exportName: string;
  url: string;
  title: string;
  header: string[];
  columns: string[];
};
export type SourceRow = { code: string; message: string; reason?: string; resolution?: string };

export const LISTS: SourceList[];
export function readChecksums(dir?: URL): Record<string, string>;
export function readList(list: SourceList, dir?: URL): { sha256: string; rows: SourceRow[] };
export function render(dir?: URL): { path: string; text: string }[];
