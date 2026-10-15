import { Box, ButtonBase, Chip } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import type { CheckpointRiskLevel, PlannedRoute } from '../api/plan';
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
  /** `Route 1`, `Route 2`… by rank. */
  label: string;
  recommended: boolean;
  /** The origin's zone: the arrival time is shown, and labelled, in it. */
  timeZone: string;
  selected: boolean;
  onSelect: () => void;
}

const LABEL_SX = {
  display: 'block',
  fontSize: '0.78rem',
  fontWeight: 600,
  lineHeight: 1.4,
  color: 'text.secondary',
};

/**
 * One route's summary: a header bar with the name and its status, four large figures, and the
 * risk miles. It is a toggle button: pressing it selects the route on the map too. The selected
 * card fills its header with the blue of the selected route on the map; a blocked card has a
 * dashed border, as a blocked route has on the map.
 */
export function RouteCard({
  route,
  label,
  recommended,
  timeZone,
  selected,
  onSelect,
}: RouteCardProps) {
  const { risk_miles: miles, blocked } = route;
  const [arrivalDate, arrivalTime] = splitArrival(formatInZone(route.arrival, timeZone));
  return (
    <ButtonBase
      onClick={onSelect}
      aria-pressed={selected}
      sx={{
        typography: 'body1',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        width: '100%',
        textAlign: 'left',
        overflow: 'hidden',
        borderRadius: '12px',
        border: 2,
        borderStyle: blocked ? 'dashed' : 'solid',
        borderColor: selected ? 'primary.main' : blocked ? 'grey.400' : 'divider',
        bgcolor: 'background.paper',
        fontVariantNumeric: 'tabular-nums',
        transition: 'border-color 120ms',
        '&:hover': { borderColor: selected ? 'primary.main' : 'grey.400' },
        // MUI's button base draws no outline of its own.
        '&.Mui-focusVisible': {
          outline: (theme: Theme) => `2px solid ${theme.palette.primary.main}`,
          outlineOffset: '3px',
        },
      }}
    >
      <Box
        component="span"
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: 1.25,
          rowGap: 0.5,
          px: 2,
          py: 1.5,
          borderBottom: 1,
          borderColor: selected ? 'primary.main' : 'divider',
          bgcolor: selected ? 'primary.main' : 'grey.100',
          color: selected ? 'primary.contrastText' : 'text.primary',
          transition: 'background-color 120ms',
        }}
      >
        <Box
          component="span"
          sx={{ mr: 'auto', fontSize: '1.125rem', fontWeight: 700, lineHeight: '24px' }}
        >
          {label}
        </Box>
        {recommended && (
          <Chip
            component="span"
            size="small"
            color="success"
            label="Recommended"
            sx={selected ? { bgcolor: 'common.white', color: 'success.main' } : undefined}
          />
        )}
        {blocked && (
          <Chip
            component="span"
            size="small"
            color="error"
            label="Blocked by No Travel"
            sx={selected ? { bgcolor: 'common.white', color: 'error.main' } : undefined}
          />
        )}
      </Box>

      <Box
        component="span"
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          columnGap: 2,
          rowGap: 2,
          p: 2,
        }}
      >
        <Figure label="Distance">
          <Reading text={formatMiles(route.distance_miles)} />
        </Figure>
        <Figure label="Travel time">
          <Reading text={formatDuration(route.duration_seconds)} />
        </Figure>
        <Figure label="Arrives" sub={arrivalDate}>
          <Reading text={arrivalTime} />
        </Figure>
        <Figure label="Average risk">{formatAverageRisk(route.average_risk)}</Figure>
      </Box>

      <Box
        component="span"
        sx={{
          display: 'block',
          px: 2,
          pt: 1.5,
          pb: 1.75,
          borderTop: 1,
          borderColor: 'divider',
          bgcolor: 'grey.50',
        }}
      >
        <Box
          component="span"
          sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
        >
          <RiskMiles level="severe" miles={miles.severe} />
          <RiskMiles level="high" miles={miles.high} />
          <RiskMiles level="no_travel" miles={miles.no_travel} />
        </Box>
        <Box
          component="span"
          sx={{ display: 'block', mt: 0.75, fontSize: '0.84rem', color: 'text.secondary' }}
        >
          Unassessed{' '}
          <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
            {`${formatMilesExact(miles.unassessed)} mi`}
          </Box>
        </Box>
      </Box>
    </ButtonBase>
  );
}

/** A small label over a large figure, and an optional line under it. */
function Figure({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <Box component="span" sx={{ display: 'block', minWidth: 0 }}>
      <Box component="span" sx={LABEL_SX}>
        {label}
      </Box>{' '}
      <Box
        component="span"
        sx={{ display: 'block', fontSize: '1.625rem', fontWeight: 700, lineHeight: 1.15 }}
      >
        {children}
      </Box>
      {sub && (
        <>
          {' '}
          <Box
            component="span"
            sx={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'text.secondary' }}
          >
            {sub}
          </Box>
        </>
      )}
    </Box>
  );
}

/** Miles at one level, with the level's palette colour beside its name. */
function RiskMiles({ level, miles }: { level: CheckpointRiskLevel; miles: number }) {
  const { label, color } = riskStyle(level);
  return (
    <Box
      component="span"
      sx={{
        display: 'block',
        minWidth: 0,
        pl: 1.5,
        borderLeft: 1,
        borderColor: 'grey.300',
        '&:first-of-type': { pl: 0, borderLeft: 0 },
      }}
    >
      <Box
        component="span"
        sx={{
          ...LABEL_SX,
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          whiteSpace: 'nowrap',
        }}
      >
        <Box
          component="span"
          aria-hidden="true"
          sx={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', bgcolor: color }}
        />
        {label}
      </Box>{' '}
      <Box
        component="span"
        sx={{ display: 'block', fontSize: '1.125rem', fontWeight: 700, lineHeight: 1.3 }}
      >
        <Reading text={`${formatMilesExact(miles)} mi`} />
      </Box>
    </Box>
  );
}

const isNumber = (word: string) => /^\d/.test(word);

/**
 * A reading such as `14 h 55 min` or `10:54 PM CDT` with its numbers large and its units
 * small. A number keeps its first unit on the same line, and each unit carries the space before
 * it, so the gap is in the unit's size; the text reads the same as the formatter's.
 */
function Reading({ text }: { text: string }) {
  const words = text.split(' ');
  const parts: ReactNode[] = [];
  for (let i = 0; i < words.length; i++) {
    if (!isNumber(words[i])) {
      parts.push(<Unit key={i}>{words[i]}</Unit>);
      continue;
    }
    const hasUnit = words[i + 1] !== undefined && !isNumber(words[i + 1]);
    if (i > 0) parts.push(' ');
    parts.push(
      <Box key={i} component="span" sx={{ whiteSpace: 'nowrap' }}>
        {words[i]}
        {hasUnit && <Unit>{words[i + 1]}</Unit>}
      </Box>,
    );
    if (hasUnit) i++;
  }
  return <>{parts}</>;
}

/** A unit and the space before it, in the unit's small size. */
function Unit({ children }: { children: string }) {
  return (
    <Box
      component="span"
      sx={{ fontSize: '0.8125rem', fontWeight: 600, letterSpacing: 0, color: 'text.secondary' }}
    >
      {` ${children}`}
    </Box>
  );
}

/** `Thu Oct 15, 10:54 PM CDT` is the date, and the time with its zone. */
function splitArrival(text: string): [date: string, time: string] {
  const at = text.indexOf(', ');
  return at < 0 ? ['', text] : [text.slice(0, at), text.slice(at + 2)];
}
