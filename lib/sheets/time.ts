const TIMEZONE = () => process.env.APP_TIMEZONE || "Asia/Kolkata";

function toValidDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 24-hour clock, time only (e.g. "14:30"). No date component -- the date
 * already has its own column / its own tab, so repeating it inside every
 * time cell just adds noise the ops team has to read past.
 */
export function formatTime(value: string | null | undefined): string {
  const date = toValidDate(value);
  if (!date) {
    return "";
  }

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIMEZONE(),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

/** DD/MM/YYYY, for the Travel Date column. */
export function formatDate(value: string | null | undefined): string {
  const date = toValidDate(value);
  if (!date) {
    return "";
  }

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIMEZONE(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

/** Raw Date for sorting/comparison -- never displayed directly. */
export function toComparableDate(value: string | null | undefined): Date | null {
  return toValidDate(value);
}

/**
 * Combined date + 24hr time, for in-app UI previews (trip form, trip
 * table) where there's no separate date column/tab to lean on like there
 * is in the sheet output.
 */
export function formatDateTime(value: string | null | undefined): string {
  const date = toValidDate(value);
  if (!date) {
    return "";
  }

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIMEZONE(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}
