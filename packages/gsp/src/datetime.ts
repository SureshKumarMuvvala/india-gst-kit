// Portal timestamps carry no time zone; they are read as IST, UTC+05:30 (spec D-G8, §15 V7). UNVERIFIED.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const ISO_LIKE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
// "15/12/2017 11:35:00 AM", "25/09/2018  10:30:00 AM", "17/09/2017 12.00:00 PM", "21/05/2018 23:59:00 PM".
const EWB_STYLE = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2})[:.](\d{2}):(\d{2})(?:\s*([AP]M))?$/i;

function build(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
): number | undefined {
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return undefined;
  const utc = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(utc);
  if (check.getUTCDate() !== d || check.getUTCMonth() !== mo - 1) return undefined;
  return utc - IST_OFFSET_MS;
}

/**
 * Epoch milliseconds for a portal timestamp (`yyyy-MM-dd HH:mm:ss` or `dd/MM/yyyy hh:mm:ss AM|PM`), read as
 * IST; `undefined` if it cannot be read. An hour above 12 with `PM` is taken as a 24-hour time (GD20).
 */
export function parsePortalDateTime(text: string): number | undefined {
  const t = text.trim();
  const a = ISO_LIKE.exec(t);
  if (a !== null) {
    const [, y, mo, d, h, mi, s] = a.map(Number) as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    return build(y, mo, d, h, mi, s);
  }
  const b = EWB_STYLE.exec(t);
  if (b === null) return undefined;
  const [, d, mo, y, h, mi, s] = b.slice(0, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const meridiem = b[7]?.toUpperCase();
  let hour = h;
  if (meridiem !== undefined && h <= 12) {
    if (h === 0) return undefined;
    hour = meridiem === "AM" ? h % 12 : (h % 12) + 12;
  }
  return build(y, mo, d, hour, mi, s);
}

/** `yyyy-MM-dd HH:mm:ss` in IST, for the mock server and tests. */
export function formatIst(epochMs: number): string {
  const d = new Date(epochMs + IST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(
    d.getUTCMinutes(),
  )}:${p(d.getUTCSeconds())}`;
}
