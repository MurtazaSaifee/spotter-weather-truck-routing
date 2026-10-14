import { MapboxOverlay, type MapboxOverlayProps } from '@deck.gl/mapbox';
import { useEffect, useRef } from 'react';
import { useControl } from 'react-map-gl/maplibre';
import type { LayerStore } from './layerStore';

type DeckGLOverlayProps = MapboxOverlayProps & {
  /** Layers drawn under `layers` that change on their own, outside React (the heatmap). */
  underlay?: LayerStore;
};

/**
 * Renders deck.gl layers inside MapLibre's own WebGL context (interleaved), so
 * layers can sit between base-map layers, e.g. a heatmap under road labels.
 *
 * There is one overlay per map (deck.gl shares a single Deck between overlays), so the
 * heatmap's layers come in through `underlay` and are merged here with the layers React owns.
 */
export function DeckGLOverlay({ underlay, ...props }: DeckGLOverlayProps) {
  const overlay = useControl<MapboxOverlay>(
    () => new MapboxOverlay({ ...props, interleaved: true }),
  );
  overlay.setProps({ ...props, layers: [underlay?.get() ?? [], props.layers] });

  const latest = useRef(props.layers);
  useEffect(() => {
    latest.current = props.layers;
  });
  useEffect(() => {
    if (!underlay) return;
    return underlay.subscribe(() => {
      overlay.setProps({ layers: [underlay.get(), latest.current] });
    });
  }, [underlay, overlay]);
  return null;
}
