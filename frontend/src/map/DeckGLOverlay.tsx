import { MapboxOverlay, type MapboxOverlayProps } from '@deck.gl/mapbox';
import { useControl } from 'react-map-gl/maplibre';

/**
 * Renders deck.gl layers inside MapLibre's own WebGL context (interleaved), so
 * layers can sit between base-map layers, e.g. a heatmap under road labels.
 */
export function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(
    () => new MapboxOverlay({ ...props, interleaved: true }),
  );
  overlay.setProps(props);
  return null;
}
