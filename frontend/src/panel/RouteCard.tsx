import { Box, ButtonBase, Typography } from '@mui/material';
import type { PlannedRoute } from '../api/plan';
import { formatDuration, formatInZone, formatMiles } from '../trip/format';

interface RouteCardProps {
  route: PlannedRoute;
  label: string;
  /** The origin's zone: the arrival time is shown, and labelled, in it. */
  timeZone: string;
  selected: boolean;
  onSelect: () => void;
}

/** One route's summary. It is a toggle button: pressing it selects the route on the map too. */
export function RouteCard({ route, label, timeZone, selected, onSelect }: RouteCardProps) {
  return (
    <ButtonBase
      onClick={onSelect}
      aria-pressed={selected}
      sx={{
        display: 'block',
        textAlign: 'left',
        p: 2,
        borderRadius: 2,
        border: 2,
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? 'action.hover' : 'background.paper',
      }}
    >
      <Typography component="span" variant="subtitle2" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1.5, mt: 0.5, flexWrap: 'wrap' }}>
        <Typography component="span" variant="body2">
          {formatMiles(route.distance_miles)}
        </Typography>
        <Typography component="span" variant="body2">
          {formatDuration(route.duration_seconds)}
        </Typography>
      </Box>
      <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block' }}>
        Arrives {formatInZone(route.arrival, timeZone)}
      </Typography>
    </ButtonBase>
  );
}
