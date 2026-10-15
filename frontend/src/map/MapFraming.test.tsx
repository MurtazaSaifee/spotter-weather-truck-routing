import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Place } from '../api/places';
import { MapFraming } from './MapFraming';
import { TOUCH_TARGET } from '../theme';
import { WORLD_BOUNDS, type Bounds } from './framing';

// MapLibre sets its control column in from the edge by this much (its own CSS margin).
const CONTROL_MARGIN_PX = 10;
const CONTROL_COLUMN_PX = TOUCH_TARGET + CONTROL_MARGIN_PX;

interface FitOptions {
  padding: Record<'top' | 'right' | 'bottom' | 'left', number>;
  maxZoom: number;
  duration: number;
}

type Handler = (event: { originalEvent?: unknown }) => void;

// A map that records how it is told to move, and lets a test resize or drag it.
const fake = vi.hoisted(() => {
  const handlers = new Map<string, Set<Handler>>();
  const size = { width: 375, height: 700 };
  const raw = {
    on: (name: string, handler: Handler) => {
      handlers.set(name, (handlers.get(name) ?? new Set()).add(handler));
    },
    off: (name: string, handler: Handler) => void handlers.get(name)?.delete(handler),
  };
  const map = {
    fitBounds: vi.fn<(bounds: Bounds, options: FitOptions) => void>(),
    easeTo: vi.fn(),
    getZoom: () => 3,
    getContainer: () => ({ clientWidth: size.width, clientHeight: size.height }),
    getMap: () => raw,
  };
  return {
    map,
    size,
    emit: (name: string, event: { originalEvent?: unknown } = {}) =>
      handlers.get(name)?.forEach((handler) => handler(event)),
    reset: () => {
      handlers.clear();
      size.width = 375;
      size.height = 700;
      map.fitBounds.mockClear();
      map.easeTo.mockClear();
    },
  };
});

vi.mock('react-map-gl/maplibre', () => ({ useMap: () => ({ current: fake.map }) }));

const chicago: Place = { label: 'Chicago', lat: 41.88, lng: -87.63, time_zone: 'America/Chicago' };
const dallas: Place = { label: 'Dallas', lat: 32.78, lng: -96.8, time_zone: 'America/Chicago' };
const route = {
  id: 'route-1',
  path: [
    [-87.63, 41.88],
    [-96.8, 32.78],
  ] as [number, number][],
};

const routes = [route];

beforeEach(() => fake.reset());

function lastFit() {
  const call = fake.map.fitBounds.mock.calls.at(-1);
  if (!call) throw new Error('The map was never fitted');
  return { bounds: call[0], ...call[1] };
}

describe('framing the map', () => {
  it('shows the whole world when there is nothing to show yet, clear of the insets', () => {
    render(
      <MapFraming
        origin={null}
        destination={null}
        routes={[]}
        insets={{ top: 150, bottom: 300 }}
      />,
    );

    const { bounds, padding } = lastFit();
    expect(bounds).toEqual(WORLD_BOUNDS);
    expect(padding.top).toBeGreaterThanOrEqual(150);
    expect(padding.bottom).toBeGreaterThanOrEqual(300);
  });

  it('fits the routes inside the insets, so none lands under a sheet or a card', () => {
    render(
      <MapFraming
        origin={chicago}
        destination={dallas}
        routes={routes}
        insets={{ top: 150, bottom: 300 }}
      />,
    );

    const { padding } = lastFit();
    expect(padding.top).toBeGreaterThanOrEqual(150);
    expect(padding.bottom).toBeGreaterThanOrEqual(300);
  });

  it('fits again when the insets change, for example as the sheet is dragged', () => {
    const { rerender } = render(
      <MapFraming origin={chicago} destination={dallas} routes={routes} insets={{ bottom: 100 }} />,
    );
    const before = fake.map.fitBounds.mock.calls.length;

    rerender(
      <MapFraming origin={chicago} destination={dallas} routes={routes} insets={{ bottom: 340 }} />,
    );

    expect(fake.map.fitBounds.mock.calls.length).toBeGreaterThan(before);
    expect(lastFit().padding.bottom).toBeGreaterThanOrEqual(340);
  });

  it('does not fit again for insets that are the same numbers in a new object', () => {
    const { rerender } = render(
      <MapFraming origin={chicago} destination={dallas} routes={routes} insets={{ bottom: 100 }} />,
    );
    const before = fake.map.fitBounds.mock.calls.length;

    rerender(
      <MapFraming origin={chicago} destination={dallas} routes={routes} insets={{ bottom: 100 }} />,
    );

    expect(fake.map.fitBounds.mock.calls.length).toBe(before);
  });

  it('fits again against the new size when the map is resized', () => {
    render(<MapFraming origin={chicago} destination={dallas} routes={routes} />);
    const before = lastFit().padding;

    fake.size.width = 1200;
    fake.emit('resize');

    expect(lastFit().padding.left).toBeGreaterThan(before.left);
  });

  it('leaves the camera alone on resize once the driver has moved it', () => {
    render(<MapFraming origin={chicago} destination={dallas} routes={routes} />);
    fake.emit('movestart', { originalEvent: {} });
    const before = fake.map.fitBounds.mock.calls.length;

    fake.emit('resize');

    expect(fake.map.fitBounds.mock.calls.length).toBe(before);
  });

  it('keeps clear of the map controls on the right, on a phone and on a desktop', () => {
    for (const width of [375, 1200]) {
      fake.size.width = width;
      render(<MapFraming origin={chicago} destination={dallas} routes={routes} />);

      expect(lastFit().padding.right).toBeGreaterThanOrEqual(CONTROL_COLUMN_PX);
    }
  });

  it('keeps clear of the controls as well as the layout insets, and the controls alone', () => {
    const { rerender } = render(
      <MapFraming origin={chicago} destination={dallas} routes={routes} insets={{ right: 80 }} />,
    );
    expect(lastFit().padding.right).toBeGreaterThanOrEqual(80 + CONTROL_COLUMN_PX);

    rerender(<MapFraming origin={null} destination={null} routes={[]} />);
    expect(lastFit().padding.right).toBeGreaterThanOrEqual(CONTROL_COLUMN_PX);
  });

  it('does not give up much of a desktop map for the controls', () => {
    fake.size.width = 1200;
    fake.size.height = 800;
    render(<MapFraming origin={chicago} destination={dallas} routes={routes} />);

    const { padding } = lastFit();
    // Without the controls the routes get 76% of the width; they keep nearly all of it.
    expect(1200 - padding.left - padding.right).toBeGreaterThan(1200 * 0.7);
  });
});
