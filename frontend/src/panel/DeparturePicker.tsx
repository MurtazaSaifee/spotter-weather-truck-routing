import type { Dayjs } from 'dayjs';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { departureError, departureWindow, zoneAbbreviation } from '../trip/departure';

interface DeparturePickerProps {
  /** The picked moment, in `timeZone` (an invalid value is a half-typed date). */
  value: Dayjs | null;
  onChange: (value: Dayjs | null) => void;
  /** The zone the clock is read in: the origin's, or the browser's before one is chosen. */
  timeZone: string;
  /** Where that zone came from, for the caption. */
  zoneSource: 'origin' | 'browser';
  nowMs: number;
}

/**
 * A date-time picker for the departure. It blocks times outside the window the API
 * accepts and names the zone it reads the clock in.
 */
export function DeparturePicker({
  value,
  onChange,
  timeZone,
  zoneSource,
  nowMs,
}: DeparturePickerProps) {
  const { min, max } = departureWindow(nowMs, timeZone);
  const error = departureError(value, nowMs);
  const zone = zoneAbbreviation(timeZone, value?.isValid() ? value : nowMs);
  const caption = `${zone} · ${zoneSource === 'origin' ? "origin's" : "your browser's"} time zone`;

  return (
    <DateTimePicker
      label="Departure"
      value={value}
      onChange={onChange}
      timezone={timeZone}
      minDateTime={min}
      maxDateTime={max}
      // A clock's minutes are enough; the API plans to the minute.
      views={['year', 'month', 'day', 'hours', 'minutes']}
      slotProps={{
        textField: { error: error !== null, helperText: error ?? caption },
      }}
    />
  );
}
