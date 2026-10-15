import type { Dayjs } from 'dayjs';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { departureError, departureWindow, zoneAbbreviation } from '../trip/departure';

interface DeparturePickerProps {
  /** The picked moment, in `timeZone` (an invalid value is a half-typed date). */
  value: Dayjs | null;
  onChange: (value: Dayjs | null) => void;
  /** The zone the clock is read in: the origin's, or the browser's before one is chosen. */
  timeZone: string;
  /** Name the zone (for example "CDT") under the field: only once an origin has set it. */
  showZone: boolean;
  nowMs: number;
}

/**
 * A date-time picker for the departure. It blocks times outside the window the API
 * accepts and, once an origin sets the zone, names it. The picker stack is a big part of the
 * app's code and nothing else uses it, so it lives here, with its own localisation provider,
 * and the form loads this module lazily.
 */
export default function DeparturePicker({
  value,
  onChange,
  timeZone,
  showZone,
  nowMs,
}: DeparturePickerProps) {
  const { min, max } = departureWindow(nowMs, timeZone);
  const error = departureError(value, nowMs);
  const zone = showZone ? zoneAbbreviation(timeZone, value?.isValid() ? value : nowMs) : undefined;

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
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
          textField: { error: error !== null, helperText: error ?? zone },
        }}
      />
    </LocalizationProvider>
  );
}
