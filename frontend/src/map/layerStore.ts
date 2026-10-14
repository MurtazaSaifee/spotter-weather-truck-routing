import type { LayersList } from '@deck.gl/core';

/**
 * A set of deck.gl layers that changes outside React: the heatmap fades by swapping its layers
 * every animation frame, and re-rendering the map's component tree sixty times a second for
 * that would cost far more than the layers do.
 */
export interface LayerStore {
  get: () => LayersList;
  set: (layers: LayersList) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createLayerStore(): LayerStore {
  let layers: LayersList = [];
  const listeners = new Set<() => void>();
  return {
    get: () => layers,
    set(next) {
      layers = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
