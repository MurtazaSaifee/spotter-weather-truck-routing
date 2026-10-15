import dayjs from 'dayjs';
import { zoneAbbreviation } from './departure';

/** At most `digits` decimals, without a pointless `.0`: `9` and `0.034`. */
export function formatNumber(value: number, digits: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** Miles to a tenth, without a pointless `.0`: `25` and `926.8`. */
export function formatMilesExact(miles: number): string {
  return formatNumber(miles, 1);
}

/** An average risk score to two decimals: `0.45`, or `n/a` for a route with nothing assessed. */
export function formatAverageRisk(score: number | null): string {
  return score === null ? 'n/a' : score.toFixed(2);
}

export function formatMiles(miles: number): string {
  return `${Math.round(miles).toLocaleString('en-US')} mi`;
}

/** `53684` becomes `14 h 55 min`; whole minutes, and no zero hours. */
export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes} min` : `${hours} h ${minutes} min`;
}

/** A moment in `zone`, labelled with the zone: `Thu Oct 15, 10:54 PM CDT`. */
export function formatInZone(iso: string, zone: string): string {
  const moment = dayjs(iso);
  return `${moment.tz(zone).format('ddd MMM D, h:mm A')} ${zoneAbbreviation(zone, moment)}`;
}
