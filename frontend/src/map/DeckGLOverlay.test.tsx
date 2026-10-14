import type { Layer } from '@deck.gl/core';
import { act, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeckGLOverlay } from './DeckGLOverlay';
import { createLayerStore } from './layerStore';

// deck.gl and MapLibre need WebGL, which jsdom lacks. What matters here is how many overlays
// are added to the map, so both are replaced by recorders.
const added: unknown[] = [];
const shown: unknown[] = [];
const fakeMap = {
  controls: new Set<unknown>(),
  hasControl: (control: unknown) => fakeMap.controls.has(control),
  addControl(control: unknown) {
    fakeMap.controls.add(control);
    added.push(control);
  },
  removeControl: (control: unknown) => void fakeMap.controls.delete(control),
};

vi.mock('@deck.gl/mapbox', () => ({
  MapboxOverlay: class {
    setProps(props: { layers?: unknown }) {
      shown.push(props.layers);
    }
  },
}));
vi.mock('react-map-gl/maplibre', () => ({
  useMap: () => ({ current: { getMap: () => fakeMap } }),
}));

afterEach(() => {
  vi.useRealTimers();
  added.length = 0;
  shown.length = 0;
  fakeMap.controls.clear();
});

// Stand-ins for deck.gl layers: only their identity matters here.
const layers = new Map<string, Layer>();
function layer(id: string): Layer {
  if (!layers.has(id)) layers.set(id, { id } as unknown as Layer);
  return layers.get(id)!;
}

describe('DeckGLOverlay', () => {
  it('adds one overlay to the map even though StrictMode mounts it twice', () => {
    // Every overlay added builds a deck.gl Deck on the map's one WebGL context, and two Decks
    // built in the same tick cannot both attach to it ("WebGL context already attached").
    vi.useFakeTimers();
    render(
      <StrictMode>
        <DeckGLOverlay layers={[]} />
      </StrictMode>,
    );
    vi.runAllTimers();

    expect(added).toHaveLength(1);
    expect(fakeMap.controls.size).toBe(1);
  });

  it('takes the overlay off the map when it unmounts', () => {
    vi.useFakeTimers();
    const { unmount } = render(<DeckGLOverlay layers={[]} />);
    vi.runAllTimers();
    unmount();

    expect(fakeMap.controls.size).toBe(0);
  });

  it('draws the underlay, the layers, the labels, then the top layers, and follows the stores', () => {
    // The heatmap, the labels and the truck change outside React; none may need the map to
    // re-render.
    const underlay = createLayerStore();
    const labels = createLayerStore();
    const topLayers = createLayerStore();
    underlay.set([layer('heatmap')]);
    render(
      <DeckGLOverlay
        layers={[layer('routes')]}
        underlay={underlay}
        labelLayers={labels}
        topLayers={topLayers}
      />,
    );
    expect(shown.at(-1)).toEqual([[layer('heatmap')], [layer('routes')], [], []]);

    act(() => labels.set([layer('labels')]));
    act(() => topLayers.set([layer('truck')]));
    expect(shown.at(-1)).toEqual([
      [layer('heatmap')],
      [layer('routes')],
      [layer('labels')],
      [layer('truck')],
    ]);

    act(() => underlay.set([layer('next heatmap')]));
    expect(shown.at(-1)).toEqual([
      [layer('next heatmap')],
      [layer('routes')],
      [layer('labels')],
      [layer('truck')],
    ]);
  });
});
