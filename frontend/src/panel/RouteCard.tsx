import { Box, ButtonBase, Chip, Typography } from '@mui/material';
import type { PlannedRoute } from '../api/plan';
import { riskStyle } from '../risk/palette';
import {
  formatAverageRisk,
  formatDuration,
  formatInZone,
  formatMiles,
  formatMilesExact,
} from '../trip/format';

interface RouteCardProps {
  route: PlannedRoute;
  label: string;
  /** How many routes were ranked: the card says "Rank 1 of 3". */
  routeCount: number;
  recommended: boolean;
  /** The origin's zone: the arrival time is shown, and labelled, in it. */
  timeZone: string;
  selected: boolean;
  onSelect: () => void;
}

/** One route's summary. It is a toggle button: pressing it selects the route on the map too. */
export function RouteCard({
  route,
  label,
  routeCount,
  recommended,
  timeZone,
  selected,
  onSelect,
}: RouteCardProps) {
  const { risk_miles: miles } = route;
  return (
    <ButtonBase
      onClick={onSelect}
      aria-pressed={selected}
      sx={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        p: 2,
        borderRadius: 3,
        border: 2,
        // A blocked route is dashed here as it is on the map.
        borderStyle: route.blocked ? 'dashed' : 'solid',
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? 'rgba(26, 69, 144, 0.05)' : 'background.paper',
        transition: 'background-color 120ms, border-color 120ms',
        '&:hover': { borderColor: selected ? 'primary.main' : 'grey.400' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minHeight: 24 }}>
        <Typography component="span" variant="subtitle1">
          {label}
        </Typography>
        {recommended && <Chip size="small" color="success" label="Recommended" />}
        {route.blocked && <Chip size="small" color="error" label="Blocked by No Travel" />}
        <Typography
          component="span"
          variant="caption"
          color="text.secondary"
          sx={{ ml: 'auto' }}
        >{`Rank ${route.rank} of ${routeCount}`}</Typography>
      </Box>
      <Box sx={{ display: 'flex', columnGap: 1.5, mt: 0.5, flexWrap: 'wrap' }}>
        <Typography component="span" variant="body1" sx={{ fontWeight: 600 }}>
          {formatMiles(route.distance_miles)}
        </Typography>
        <Typography component="span" variant="body1" sx={{ fontWeight: 600 }}>
          {formatDuration(route.duration_seconds)}
        </Typography>
      </Box>
      <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block' }}>
        Arrives {formatInZone(route.arrival, timeZone)}
      </Typography>
      <Box sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5 }}>
          <RiskMiles level="severe" label="Severe" miles={miles.severe} />
          <RiskMiles level="high" label="High" miles={miles.high} />
          <RiskMiles level="no_travel" label="No Travel" miles={miles.no_travel} />
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.25, mt: 0.75 }}>
          <Typography component="span" variant="body2" color="text.secondary" noWrap>
            {`Unassessed ${formatMilesExact(miles.unassessed)} mi`}
          </Typography>
          <Typography component="span" variant="body2" color="text.secondary" noWrap>
            {`Average risk ${formatAverageRisk(route.average_risk)}`}
          </Typography>
        </Box>
      </Box>
    </ButtonBase>
  );
}

/** Miles at one level, with the level's palette colour beside the words. */
function RiskMiles({
  level,
  label,
  miles,
}: {
  level: 'severe' | 'high' | 'no_travel';
  label: string;
  miles: number;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, whiteSpace: 'nowrap' }}>
      <Box
        aria-hidden="true"
        sx={{ flex: 'none', width: 10, height: 10, borderRadius: '50%', bgcolor: riskStyle(level).color }}
      />
      <Typography component="span" variant="body2">
        {`${label} ${formatMilesExact(miles)} mi`}
      </Typography>
    </Box>
  );
}
