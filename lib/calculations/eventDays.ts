import { differenceInCalendarDays, parseISO } from "date-fns";

/**
 * Pragyan runs Day -1 through Day 3. Day -1 is the day before the event
 * (setup / early-arrival day). Everything is derived from a single
 * admin-set `day_zero_date` -- this is the only place that knows the
 * festival window, so changing it later means changing two constants, not
 * hunting through the codebase.
 */
export const EVENT_FIRST_DAY_INDEX = -1;
export const EVENT_LAST_DAY_INDEX = 3;

export const PRE_EVENT_LABEL = "Pre-Event";
export const POST_EVENT_LABEL = "Post-Event";

/**
 * Returns "Day -1".."Day 3" for trips inside the festival window, or an
 * overflow label for anything outside it. We deliberately never throw the
 * trip away -- a guest arriving early or leaving late still needs to show
 * up *somewhere* on the sheet.
 */
export function getDayLabel(travelDate: string, dayZeroDate: string): string {
  const offset = differenceInCalendarDays(parseISO(travelDate), parseISO(dayZeroDate));

  if (offset < EVENT_FIRST_DAY_INDEX) {
    return PRE_EVENT_LABEL;
  }

  if (offset > EVENT_LAST_DAY_INDEX) {
    return POST_EVENT_LABEL;
  }

  return `Day ${offset}`;
}

/**
 * Sort key so tabs/sections are ordered:
 *   Pre-Event → Day -1 → Day 0 → Day 1 → Day 2 → Day 3 → Post-Event
 * instead of whatever order they happen to be created in.
 */
export function getDayLabelSortIndex(label: string): number {
  if (label === PRE_EVENT_LABEL) return EVENT_FIRST_DAY_INDEX - 1;
  if (label === POST_EVENT_LABEL) return EVENT_LAST_DAY_INDEX + 1;

  // Support negative day indices ("Day -1") as well as positive ones.
  const match = label.match(/^Day (-?\d+)$/);
  return match ? Number(match[1]) : EVENT_LAST_DAY_INDEX + 1;
}

/** All labels a fully-populated event will have, in display order. */
export function allEventDayLabels(): string[] {
  const labels: string[] = [];
  for (let i = EVENT_FIRST_DAY_INDEX; i <= EVENT_LAST_DAY_INDEX; i += 1) {
    labels.push(`Day ${i}`);
  }
  return labels;
}