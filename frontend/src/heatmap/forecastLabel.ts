import dayjs from 'dayjs';
import { zoneAbbreviation } from '../trip/departure';

/** What the slider shows for an hour, in the two parts the strip styles differently. */
interface ForecastLabel {
  /** The clock time a driver reads in the origin's zone, e.g. `Thu 2:00 PM EDT`. */
  clock: string;
  /** How long after departure: `+14 h`, or `Departure` for hour 0. */
  offset: string;
}

/**
 * What the slider shows: the clock time in the origin's zone on a 12-hour clock, and how far
 * past departure it is, e.g. `Thu 2:00 PM EDT` and `+14 h`. `departure` is the plan's
 * ISO-8601 departure.
 */
export function forecastLabel(departure: string, hour: number, zone: string): ForecastLabel {
  const moment = dayjs(departure).add(hour, 'hour');
  return {
    clock: `${moment.tz(zone).format('ddd h:mm A')} ${zoneAbbreviation(zone, moment)}`,
    offset: hour === 0 ? 'Departure' : `+${hour} h`,
  };
}
