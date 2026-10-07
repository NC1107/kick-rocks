const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const RELATIVE_STEPS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * DAY],
  ["month", 30 * DAY],
  ["week", 7 * DAY],
  ["day", DAY],
  ["hour", HOUR],
  ["minute", MINUTE],
];

export interface FormatOptions {
  locale?: string | undefined;
}

export function formatDate(iso: string, { locale }: FormatOptions = {}): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));
}

export function formatDateTime(iso: string, { locale }: FormatOptions = {}): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/** "3 hours ago" or "in 2 days"; anything under a minute reads as "just now". */
export function formatRelative(
  iso: string,
  { now = Date.now(), locale }: FormatOptions & { now?: number } = {},
): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  if (abs < MINUTE) return "just now";
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of RELATIVE_STEPS) {
    if (abs >= size) return formatter.format(Math.round(diff / size), unit);
  }
  return "just now";
}

export function formatCount(value: number, { locale }: FormatOptions = {}): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** "1 request", "3 requests". */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}
