import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeckGLOverlay } from './DeckGLOverlay';

// deck.gl and MapLibre need WebGL, which jsdom lacks. What matters here is how many overlays
// are added to the map, so both are replaced by recorders.
const added: unknown[] = [];
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
    setProps() {}
  },
}));
vi.mock('react-map-gl/maplibre', () => ({
  useMap: () => ({ current: { getMap: () => fakeMap } }),
}));

afterEach(() => {
  vi.useRealTimers();
  added.length = 0;
  fakeMap.controls.clear();
});

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
});
