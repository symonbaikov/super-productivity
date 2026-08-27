const pad = (n: number): string => String(n).padStart(2, '0');

const toDayStr = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const daysInMonth = (year: number, monthIdx: number): number =>
  new Date(year, monthIdx + 1, 0).getDate();

const ABSOLUTE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// "+3d", "3 days", "-1w", "+1month", "+1y" — unit is matched by its first letter.
const RELATIVE_RE = /^([+-]?\d{1,4})\s*(d|w|m|y)[a-z]*$/i;

/**
 * Resolves an automation date value to a local ISO day string (YYYY-MM-DD).
 *
 * Accepts either an absolute `YYYY-MM-DD` or an offset relative to `now`:
 * `+3d` / `+2w` / `+1m` / `+1y` (negative offsets allowed too).
 *
 * All arithmetic runs on local calendar parts rather than on timestamps, so a
 * DST transition inside the offset window cannot shift the result by a day.
 *
 * Returns null when the value cannot be parsed or is not a real date.
 */
export const resolveDateValue = (value: string, now: Date = new Date()): string | null => {
  const raw = value.trim();

  const absolute = ABSOLUTE_RE.exec(raw);
  if (absolute) {
    const year = Number(absolute[1]);
    const monthIdx = Number(absolute[2]) - 1;
    const day = Number(absolute[3]);
    const parsed = new Date(year, monthIdx, day);
    // Rejects 2026-02-30 & friends, which Date would silently roll over.
    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== monthIdx ||
      parsed.getDate() !== day
    ) {
      return null;
    }
    return toDayStr(parsed);
  }

  const relative = RELATIVE_RE.exec(raw);
  if (!relative) {
    return null;
  }

  const amount = Number(relative[1]);
  const unit = relative[2].toLowerCase();
  const year = now.getFullYear();
  const monthIdx = now.getMonth();
  const day = now.getDate();

  if (unit === 'd' || unit === 'w') {
    return toDayStr(new Date(year, monthIdx, day + amount * (unit === 'w' ? 7 : 1)));
  }

  // Month/year offsets clamp to the last day of the target month, so
  // Jan 31 +1m is Feb 28/29 rather than rolling into March.
  const monthTarget = new Date(year, monthIdx + (unit === 'm' ? amount : amount * 12), 1);
  const clampedDay = Math.min(day, daysInMonth(monthTarget.getFullYear(), monthTarget.getMonth()));
  return toDayStr(new Date(monthTarget.getFullYear(), monthTarget.getMonth(), clampedDay));
};
