import dayjs from 'dayjs';
import { zoneAbbreviation } from '../trip/departure';

/**
 * What the slider shows: the offset and the clock time in the origin's zone, e.g.
 * `T+14h · Wed 02:00 CDT`. `departure` is the plan's ISO-8601 departure.
 */
export function forecastLabel(departure: string, hour: number, zone: string): string {
  const moment = dayjs(departure).add(hour, 'hour');
  return `T+${hour}h · ${moment.tz(zone).format('ddd HH:mm')} ${zoneAbbreviation(zone, moment)}`;
}
