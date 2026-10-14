import { Box, Typography } from '@mui/material';
import type { PlannedRoute } from '../api/plan';
import { useForecastHour } from '../heatmap/forecastHour';
import { TRUCK_COLOR } from './truckColors';
import { SECONDS_PER_HOUR, truckAt } from './truckTrack';
import { truckStateText } from './truckStateText';
import { useTruckTrack } from './useTruckTrack';

/**
 * The truck's state at the slider's hour, beside the slider. It is the only part of the truck
 * that re-renders on a tick (the dot on the map follows the hour store directly), and it is
 * one line of text.
 */
export function TruckStatus({ route }: { route: PlannedRoute | null }) {
  const track = useTruckTrack(route);
  const hour = useForecastHour();
  if (!track) return null;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Box
        aria-hidden
        sx={{
          flex: 'none',
          width: 12,
          height: 12,
          borderRadius: '50%',
          bgcolor: TRUCK_COLOR,
          border: 2,
          borderColor: 'common.white',
          boxShadow: 1,
        }}
      />
      <Typography variant="body2" noWrap sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {truckStateText(truckAt(track, hour * SECONDS_PER_HOUR))}
      </Typography>
    </Box>
  );
}
