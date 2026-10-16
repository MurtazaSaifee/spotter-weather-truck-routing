import { Box, ButtonBase, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { createSvgIcon } from '@mui/material/utils';
import {
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { SHEET_HEADER_HEIGHT, SHEET_TOP_GAP, type SheetSnap, useBottomSheet } from './bottomSheet';
import { MapInsetsContext, type MapInsets } from './mapInsets';

const PANEL_WIDTH = 400;
/** The widest the phone layout's sheet and floating controls get, on a tablet. */
const SHEET_MAX_WIDTH = 560;
/** Gap between the phone's floating controls and the screen edges. */
const FLOAT_GAP = 8;
/** Width the map's zoom buttons take at the top right (button, margin, a little air). */
const MAP_BUTTONS_CLEARANCE = 48;

const ChevronUpIcon = createSvgIcon(
  <path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z" />,
  'ChevronUp',
);

/** Attribute the sheet scrolls to when a trip's results arrive. */
export const RESULTS_ANCHOR = 'data-results';

interface AppShellProps {
  /** Content of the planner panel: a left column on desktop, the bottom sheet on a phone. */
  panel: ReactNode;
  /** Content of the map area, which fills the rest. */
  map: ReactNode;
  /**
   * The forecast controls. Desktop: a strip under the map. Phone: a card floating over the
   * top of the map, so the layer toggle and slider stay in reach while the sheet is down.
   */
  controls: ReactNode;
  /** The phone sheet's collapsed summary: the app's name, then the recommendation. */
  sheetTitle: string;
  sheetSubtitle?: string;
  /** Changes whenever a new trip's results arrive; the sheet then rises to show them. */
  resultsKey: number;
}

const SNAP_NAMES: Record<SheetSnap, string> = {
  collapsed: 'collapsed',
  half: 'half open',
  full: 'fully open',
};

/**
 * One layout, two presentations, from the same elements so nothing remounts (and no typed
 * input is lost) when a window crosses the `md` breakpoint:
 * - desktop: a fixed-width panel beside the map, forecast controls in a strip under the map;
 * - phone: a full-screen map, the panel in a draggable bottom sheet with three snap points
 *   (collapsed, half, full), the forecast controls floating over the map's top edge.
 */
export function AppShell({
  panel,
  map,
  controls,
  sheetTitle,
  sheetSubtitle,
  resultsKey,
}: AppShellProps) {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const safeProbeRef = useRef<HTMLDivElement>(null);
  const { snap, setSnap, offset, offsets, headerProps } = useBottomSheet(isPhone, 'half', {
    root: rootRef,
    sheet: sheetRef,
    safeProbe: safeProbeRef,
  });
  const bodyRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [controlsHeight, setControlsHeight] = useState(0);

  // A new trip's results raise the sheet to half and scroll them to the top of what shows.
  const [seenKey, setSeenKey] = useState(resultsKey);
  if (seenKey !== resultsKey) {
    setSeenKey(resultsKey);
    // Show the map as well: from collapsed or full, the sheet settles at half.
    if (isPhone && snap !== 'half') setSnap('half');
  }
  useEffect(() => {
    if (!isPhone || resultsKey === 0) return;
    const body = bodyRef.current;
    const results = body?.querySelector(`[${RESULTS_ANCHOR}]`);
    if (!body || !results) return;
    const top = results.getBoundingClientRect().top - body.getBoundingClientRect().top;
    body.scrollTo({ top: body.scrollTop + top - 8, behavior: 'smooth' });
  }, [isPhone, resultsKey]);

  // Typing into a field needs room (and the keyboard takes more): open the sheet fully.
  const handleFocus = (event: FocusEvent) => {
    if (!isPhone || snap === 'full') return;
    const target = event.target as HTMLElement;
    if (target.matches('input:not([type=button]):not([type=checkbox]), textarea')) setSnap('full');
  };

  useLayoutEffect(() => {
    const element = controlsRef.current;
    if (!element) return;
    const measure = () => setControlsHeight(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const insets = useMemo<MapInsets>(() => {
    if (!isPhone) return { top: 0, bottom: 0 };
    // The sheet covers the map from the collapsed line up; beyond half it hides the map
    // altogether, so framing stops caring there.
    const covered = offsets.collapsed - Math.max(offset, offsets.half);
    return {
      top: controlsHeight > 0 ? controlsHeight + FLOAT_GAP * 2 : 0,
      bottom: Math.max(0, covered),
    };
  }, [isPhone, offset, offsets.collapsed, offsets.half, controlsHeight]);

  const peek = `calc(${SHEET_HEADER_HEIGHT}px + env(safe-area-inset-bottom))`;

  return (
    <Box
      ref={rootRef}
      sx={{
        position: 'relative',
        display: { md: 'flex' },
        height: '100dvh',
        overflow: 'hidden',
        bgcolor: 'grey.100',
      }}
    >
      <Box
        component="aside"
        ref={sheetRef}
        aria-label="Trip planner"
        style={{ '--sheet-y': `${offset}px` } as CSSProperties}
        sx={{
          // Phone: a sheet as tall as the screen, pushed down to its snap point.
          position: { xs: 'absolute', md: 'static' },
          zIndex: 2,
          left: 0,
          right: 0,
          bottom: 0,
          // On a tablet the sheet stays a comfortable width, centred.
          maxWidth: { xs: SHEET_MAX_WIDTH, md: 'none' },
          mx: { xs: 'auto', md: 0 },
          height: {
            xs: `calc(100% - ${SHEET_TOP_GAP}px - env(safe-area-inset-top))`,
            md: 'auto',
          },
          display: 'flex',
          flexDirection: 'column',
          transform: {
            xs: `translateY(var(--sheet-y, calc(100% - ${SHEET_HEADER_HEIGHT}px)))`,
            md: 'none',
          },
          transition: 'transform 320ms cubic-bezier(0.22, 0.9, 0.3, 1)',
          '&[data-dragging="true"]': { transition: 'none' },
          willChange: { xs: 'transform', md: 'auto' },
          bgcolor: 'background.paper',
          borderTopLeftRadius: { xs: 16, md: 0 },
          borderTopRightRadius: { xs: 16, md: 0 },
          boxShadow: { xs: '0 -2px 16px rgba(22, 27, 38, 0.16)', md: 'none' },
          // Desktop: a fixed column that scrolls on its own.
          flex: { md: `0 0 ${PANEL_WIDTH}px` },
          overflow: 'hidden',
          borderRight: { md: 1 },
          borderColor: 'divider',
        }}
      >
        <Box
          ref={safeProbeRef}
          aria-hidden
          sx={{
            position: 'absolute',
            width: 0,
            height: 'env(safe-area-inset-bottom)',
            visibility: 'hidden',
          }}
        />
        <ButtonBase
          {...headerProps}
          aria-expanded={snap !== 'collapsed'}
          aria-label={`${sheetTitle}${sheetSubtitle ? `. ${sheetSubtitle}` : ''}. Panel ${SNAP_NAMES[snap]}. Drag, or press Up and Down arrows, to resize.`}
          sx={{
            display: { xs: 'flex', md: 'none' },
            flex: 'none',
            flexDirection: 'column',
            alignItems: 'stretch',
            height: SHEET_HEADER_HEIGHT,
            px: 2,
            textAlign: 'left',
            touchAction: 'none',
            userSelect: 'none',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
          }}
        >
          <Box
            aria-hidden
            sx={{
              alignSelf: 'center',
              width: 36,
              height: 4,
              borderRadius: 2,
              bgcolor: 'grey.300',
              mt: 1,
            }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" noWrap component="div">
                {sheetTitle}
              </Typography>
              {sheetSubtitle && (
                <Typography variant="caption" color="text.secondary" component="div">
                  {sheetSubtitle}
                </Typography>
              )}
            </Box>
            <ChevronUpIcon
              aria-hidden
              sx={{
                color: 'text.secondary',
                transition: 'transform 200ms',
                transform: snap === 'full' ? 'rotate(180deg)' : 'none',
              }}
            />
          </Box>
        </ButtonBase>
        <Box
          ref={bodyRef}
          // Out of sight and out of the tab order while the sheet is collapsed.
          inert={isPhone && snap === 'collapsed'}
          onFocus={handleFocus}
          sx={{
            position: 'relative',
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            // The part of the sheet below the screen must stay scrollable into view.
            pb: { xs: `calc(${offset}px + env(safe-area-inset-bottom))`, md: 0 },
          }}
        >
          {panel}
        </Box>
      </Box>
      <Box
        component="main"
        sx={{
          position: { xs: 'absolute', md: 'relative' },
          inset: { xs: `0 0 ${peek} 0`, md: 'auto' },
          flex: { md: 1 },
          minWidth: 0,
          // The map's own controls and popups stay below the sheet.
          isolation: 'isolate',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
          <MapInsetsContext.Provider value={insets}>{map}</MapInsetsContext.Provider>
        </Box>
        <Box
          ref={controlsRef}
          inert={isPhone && snap === 'full'}
          sx={{
            position: { xs: 'absolute', md: 'static' },
            top: `calc(${FLOAT_GAP}px + env(safe-area-inset-top))`,
            left: FLOAT_GAP,
            // Leaves the map's own zoom buttons, at the top right, uncovered.
            right: MAP_BUTTONS_CLEARANCE,
            maxWidth: { xs: SHEET_MAX_WIDTH, md: 'none' },
            zIndex: 1,
            flex: 'none',
          }}
        >
          {controls}
        </Box>
      </Box>
    </Box>
  );
}
