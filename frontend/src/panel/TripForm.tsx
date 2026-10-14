import { Button, Skeleton, Stack, Typography } from '@mui/material';
import type { Dayjs } from 'dayjs';
import { type FormEvent, lazy, Suspense, useMemo, useState } from 'react';
import type { PlanRequest } from '../api/plan';
import type { Place } from '../api/places';
import { useNow } from '../hooks/useNow';
import {
  browserTimeZone,
  departureError,
  nextFullHour,
  sameClockIn,
  toApiDeparture,
} from '../trip/departure';
import { parseWeight, weightError } from '../trip/weight';
import { LoadWeightField } from './LoadWeightField';
import { PlaceField } from './PlaceField';

// The date-time picker stack is the biggest part of the form and the first paint does not
// need it: the rest of the form shows at once and the picker follows.
const DeparturePicker = lazy(() => import('./DeparturePicker'));

/** The picker's height with its caption beneath, so nothing moves when it arrives. */
function DeparturePickerPlaceholder() {
  return (
    <Stack aria-hidden="true">
      <Skeleton variant="rounded" height={56} />
      <Skeleton width="55%" height={20} sx={{ mt: 0.5, ml: 1.75 }} />
    </Stack>
  );
}

interface TripFormProps {
  origin: Place | null;
  onOriginChange: (place: Place | null) => void;
  destination: Place | null;
  onDestinationChange: (place: Place | null) => void;
  /** True while a plan is being worked out; the button waits. */
  isPlanning: boolean;
  onPlan: (request: PlanRequest) => void;
}

/** Coordinates to 5 decimals (about 1 m): closer than that is the same place. */
const samePosition = (a: Place, b: Place) =>
  a.lat.toFixed(5) === b.lat.toFixed(5) && a.lng.toFixed(5) === b.lng.toFixed(5);

/**
 * The trip form: origin, destination, departure and load weight. Plan stays disabled
 * until every input is valid, so no request is sent that is bound to fail.
 */
export function TripForm({
  origin,
  onOriginChange,
  destination,
  onDestinationChange,
  isPlanning,
  onPlan,
}: TripFormProps) {
  const nowMs = useNow();
  const [browserZone] = useState(browserTimeZone);
  // Until the driver picks a time, the departure is the next full hour wherever the
  // trip starts. A picked clock time is kept as it is; the origin's zone only relabels it.
  const [picked, setPicked] = useState<Dayjs | null | undefined>(undefined);
  const [weightText, setWeightText] = useState('');

  const zone = origin?.time_zone ?? browserZone;
  const departure = useMemo(() => {
    if (picked === undefined) return nextFullHour(nowMs, zone);
    return picked?.isValid() ? sameClockIn(picked, zone) : picked;
  }, [picked, zone, nowMs]);

  const sameAsOrigin = origin !== null && destination !== null && samePosition(origin, destination);
  const pounds = parseWeight(weightText);
  const isValid =
    origin !== null &&
    destination !== null &&
    !sameAsOrigin &&
    departureError(departure, nowMs) === null &&
    weightError(pounds) === null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!isValid || !origin || !destination || departure === null || pounds === null) return;
    onPlan({
      origin,
      destination,
      departure: toApiDeparture(departure),
      load_weight_lb: pounds,
    });
  }

  return (
    <Stack component="form" spacing={2} noValidate onSubmit={handleSubmit}>
      <PlaceField label="Origin" value={origin} onChange={onOriginChange} />
      <PlaceField
        label="Destination"
        value={destination}
        onChange={onDestinationChange}
        error={sameAsOrigin ? 'Destination must be different from the origin.' : undefined}
      />
      <Suspense fallback={<DeparturePickerPlaceholder />}>
        <DeparturePicker
          value={departure}
          onChange={setPicked}
          timeZone={zone}
          zoneSource={origin ? 'origin' : 'browser'}
          nowMs={nowMs}
        />
      </Suspense>
      <LoadWeightField text={weightText} onTextChange={setWeightText} />
      <Button type="submit" variant="contained" size="large" disabled={!isValid || isPlanning}>
        Plan trip
      </Button>
      {(origin === null || destination === null) && (
        <Typography variant="caption" color="text.secondary">
          Choose an origin and a destination to plan a trip.
        </Typography>
      )}
    </Stack>
  );
}
