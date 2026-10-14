import { GlobalStyles, useTheme } from '@mui/material';
import { useEffect } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import { TOUCH_TARGET } from '../theme';

/**
 * Restyles the parts of MapLibre we cannot reach through props: the attribution gets a solid
 * enough background to read over the basemap's labels (and keeps every credit, collapsing to
 * an info button on a narrow map), its button and the popup's get touch-sized, and the corner
 * controls sit clear of whatever the layout lays over the map. Lives with the map chunk.
 */
export function MapStyles() {
  const theme = useTheme();
  return (
    <GlobalStyles
      styles={{
        '.maplibregl-ctrl-bottom-right, .maplibregl-ctrl-bottom-left': {
          bottom: 'var(--map-inset-bottom, 0px)',
        },
        '.maplibregl-ctrl-top-right, .maplibregl-ctrl-top-left': {
          top: 'var(--map-inset-top, 0px)',
        },
        '.maplibregl-ctrl.maplibregl-ctrl-attrib': {
          boxSizing: 'border-box',
          backgroundColor: 'rgba(255, 255, 255, 0.94)',
          color: theme.palette.text.primary,
          fontFamily: theme.typography.fontFamily,
          fontSize: 11,
          lineHeight: 1.5,
          borderRadius: `${theme.shape.borderRadius}px 0 0 0`,
          boxShadow: '0 0 0 1px rgba(28, 36, 51, 0.08)',
        },
        '.maplibregl-ctrl-attrib a': {
          color: theme.palette.primary.dark,
          textDecoration: 'underline',
        },
        '.maplibregl-ctrl.maplibregl-ctrl-attrib.maplibregl-compact': {
          borderRadius: theme.shape.borderRadius,
          margin: 8,
        },
        '.maplibregl-ctrl.maplibregl-ctrl-attrib.maplibregl-compact-show': {
          padding: '4px 36px 4px 10px',
          // On a narrow map the open credits are as wide as the map allows, and wrap.
          maxWidth: 'calc(100vw - 16px)',
        },
        '.maplibregl-ctrl-attrib-button': {
          borderRadius: theme.shape.borderRadius,
        },
        '@media (pointer: coarse)': {
          '.maplibregl-ctrl.maplibregl-ctrl-attrib.maplibregl-compact:not(.maplibregl-compact-show)': {
            boxSizing: 'border-box',
            width: TOUCH_TARGET,
            height: TOUCH_TARGET,
            padding: 0,
          },
          '.maplibregl-ctrl.maplibregl-ctrl-attrib.maplibregl-compact-show': { padding: '4px 48px 4px 10px', minHeight: TOUCH_TARGET },
          '.maplibregl-ctrl-attrib.maplibregl-compact .maplibregl-ctrl-attrib-button': {
            width: TOUCH_TARGET,
            height: TOUCH_TARGET,
            // The icon is drawn for a 24 px button: keep it one icon, centred in the bigger one.
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
          },
          '.maplibregl-ctrl-group button': { width: TOUCH_TARGET, height: TOUCH_TARGET },
          '.maplibregl-popup-close-button': { width: TOUCH_TARGET, height: TOUCH_TARGET, fontSize: 24 },
        },
        // The popup's content sets its own padding and size, which the placement relies on.
        '.maplibregl-popup-content': {
          padding: 0,
          borderRadius: theme.shape.borderRadius,
          boxShadow: '0 4px 16px rgba(28, 36, 51, 0.22)',
          fontFamily: theme.typography.fontFamily,
        },
      }}
    />
  );
}

/**
 * Starts the attribution collapsed on a narrow map. MapLibre opens its compact attribution on
 * the first frame, over the corner of a map that has little to spare, and only closes it once
 * the driver drags. Collapsing it is the info button's own toggle; it is done again only when
 * a resize makes the map newly narrow, never to close credits the driver has opened. Must sit
 * inside a `Map`, after its `AttributionControl`.
 */
export function CollapsedAttribution() {
  const { current: map } = useMap();
  useEffect(() => {
    if (!map) return;
    const raw = map.getMap();
    let wasCompact = false;
    const collapse = () => {
      const control = raw.getContainer().querySelector('.maplibregl-ctrl-attrib');
      const compact = !!control?.classList.contains('maplibregl-compact');
      if (compact && !wasCompact && control?.classList.contains('maplibregl-compact-show')) {
        control.querySelector<HTMLElement>('.maplibregl-ctrl-attrib-button')?.click();
      }
      wasCompact = compact;
    };
    collapse();
    raw.on('resize', collapse);
    return () => void raw.off('resize', collapse);
  }, [map]);
  return null;
}
