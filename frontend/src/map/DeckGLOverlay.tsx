import { MapboxOverlay, type MapboxOverlayProps } from '@deck.gl/mapbox';
import { useEffect, useRef, useState } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import type { LayerStore } from './layerStore';

type DeckGLOverlayProps = MapboxOverlayProps & {
  /** Layers drawn under `layers` that change on their own, outside React (the heatmap). */
  underlay?: LayerStore;
  /** Layers drawn over `layers`, likewise changing outside React (the route labels). */
  labelLayers?: LayerStore;
  /** Layers drawn over everything else, likewise changing outside React (the truck). */
  topLayers?: LayerStore;
};

/**
 * Renders deck.gl layers inside MapLibre's own WebGL context (interleaved), so
 * layers can sit between base-map layers, e.g. a heatmap under road labels.
 *
 * There is one overlay per map (deck.gl shares a single Deck between overlays), so the
 * heatmap's layers come in through `underlay`, the route labels through `labelLayers` and the
 * truck's through `topLayers`, and they are merged here with the layers React owns.
 */
export function DeckGLOverlay({ underlay, labelLayers: labels, topLayers, ...props }: DeckGLOverlayProps) {
  const { current: mapRef } = useMap();
  const [overlay] = useState(() => new MapboxOverlay({ ...props, interleaved: true }));

  // Adding the control builds a Deck on the map's single WebGL context, and luma.gl cannot
  // attach two devices to one context at once. React's StrictMode (dev) mounts every effect,
  // unmounts it and mounts it again straight away, which would build two Decks in the same
  // tick and fail with "WebGL context already attached". Adding on a timer lets the throwaway
  // mount be cancelled before it builds anything.
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const timer = setTimeout(() => map.addControl(overlay), 0);
    return () => {
      clearTimeout(timer);
      if (map.hasControl(overlay)) map.removeControl(overlay);
    };
  }, [mapRef, overlay]);

  overlay.setProps({
    ...props,
    layers: [underlay?.get() ?? [], props.layers, labels?.get() ?? [], topLayers?.get() ?? []],
  });

  const latest = useRef(props.layers);
  useEffect(() => {
    latest.current = props.layers;
  });
  useEffect(() => {
    const refresh = () => {
      overlay.setProps({
        layers: [
          underlay?.get() ?? [],
          latest.current,
          labels?.get() ?? [],
          topLayers?.get() ?? [],
        ],
      });
    };
    const unsubscribes = [underlay, labels, topLayers].flatMap((store) =>
      store ? [store.subscribe(refresh)] : [],
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [underlay, labels, topLayers, overlay]);
  return null;
}
