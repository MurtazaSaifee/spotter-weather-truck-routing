import dayjs, { type Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

/** A departure too long ago is refused, but a few minutes late is a slow submit, not a mistake. */
export const DEPARTURE_GRACE_MINUTES = 15;
/** The forecast supports planning this far ahead and no further. */
export const DEPARTURE_HORIZON_HOURS = 48;

/** The wall-clock time, without a zone, in the format the picker works in. */
const CLOCK_FORMAT = 'YYYY-MM-DDTHH:mm';

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The first full hour after `nowMs`, in `zone`. */
export function nextFullHour(nowMs: number, zone: string): Dayjs {
  return dayjs(nowMs).tz(zone).startOf('hour').add(1, 'hour');
}

/** `value` with the same wall-clock time in `zone`. Re-labels the time, it does not shift it. */
export function sameClockIn(value: Dayjs, zone: string): Dayjs {
  return dayjs.tz(value.format(CLOCK_FORMAT), zone);
}

export function departureWindow(nowMs: number, zone: string) {
  return {
    min: dayjs(nowMs).tz(zone).subtract(DEPARTURE_GRACE_MINUTES, 'minute'),
    max: dayjs(nowMs).tz(zone).add(DEPARTURE_HORIZON_HOURS, 'hour'),
  };
}

/** What is wrong with the departure, or null when it can be planned. */
export function departureError(value: Dayjs | null, nowMs: number): string | null {
  if (value === null || !value.isValid()) return 'Enter a valid departure date and time.';
  const instant = value.valueOf();
  if (instant < nowMs - DEPARTURE_GRACE_MINUTES * 60_000) {
    return `Departure can't be more than ${DEPARTURE_GRACE_MINUTES} minutes ago.`;
  }
  if (instant > nowMs + DEPARTURE_HORIZON_HOURS * 3_600_000) {
    return `Departure can't be more than ${DEPARTURE_HORIZON_HOURS} hours ahead.`;
  }
  return null;
}

/** The zone's short name at that moment, e.g. `CDT`. */
export function zoneAbbreviation(zone: string, at: Dayjs | number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'short',
  }).formatToParts(typeof at === 'number' ? at : at.valueOf());
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? zone;
}

/** ISO-8601 with the zone's UTC offset, as the API wants it. */
export function toApiDeparture(value: Dayjs): string {
  return value.format();
}
