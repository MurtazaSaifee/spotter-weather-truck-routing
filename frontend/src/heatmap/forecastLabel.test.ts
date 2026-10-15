import { describe, expect, it } from 'vitest';
import { forecastLabel } from './forecastLabel';

// Thursday 8:00 AM in Chicago.
const DEPARTURE = '2026-10-15T13:00:00Z';

describe('forecastLabel', () => {
  it('names the departure hour as the departure, with its clock time', () => {
    expect(forecastLabel(DEPARTURE, 0, 'America/Chicago')).toEqual({
      clock: 'Thu 8:00 AM CDT',
      offset: 'Departure',
    });
  });

  it('shows an afternoon hour on a 12-hour clock with hours after departure', () => {
    expect(forecastLabel(DEPARTURE, 6, 'America/Chicago')).toEqual({
      clock: 'Thu 2:00 PM CDT',
      offset: '+6 h',
    });
  });

  it('reads noon as PM and midnight as AM', () => {
    expect(forecastLabel(DEPARTURE, 4, 'America/Chicago').clock).toBe('Thu 12:00 PM CDT');
    expect(forecastLabel(DEPARTURE, 16, 'America/Chicago').clock).toBe('Fri 12:00 AM CDT');
  });

  it('moves to the next weekday when the clock crosses midnight', () => {
    expect(forecastLabel(DEPARTURE, 17, 'America/Chicago')).toEqual({
      clock: 'Fri 1:00 AM CDT',
      offset: '+17 h',
    });
  });

  it('shows the last hour of the window', () => {
    expect(forecastLabel(DEPARTURE, 48, 'America/Chicago')).toEqual({
      clock: 'Sat 8:00 AM CDT',
      offset: '+48 h',
    });
  });

  it('switches the zone abbreviation where daylight saving ends', () => {
    // The clocks fall back at 2:00 AM CDT on Sunday 1 November 2026.
    const midnight = '2026-11-01T05:00:00Z';
    expect(forecastLabel(midnight, 1, 'America/Chicago').clock).toBe('Sun 1:00 AM CDT');
    expect(forecastLabel(midnight, 3, 'America/Chicago').clock).toBe('Sun 2:00 AM CST');
  });

  it('keeps the minutes of a zone with a half-hour offset', () => {
    expect(forecastLabel(DEPARTURE, 0, 'Asia/Kolkata')).toEqual({
      clock: 'Thu 6:30 PM GMT+5:30',
      offset: 'Departure',
    });
    expect(forecastLabel(DEPARTURE, 6, 'Asia/Kolkata').clock).toBe('Fri 12:30 AM GMT+5:30');
  });
});
