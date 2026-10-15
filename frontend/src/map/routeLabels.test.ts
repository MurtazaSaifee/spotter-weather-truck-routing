import { describe, expect, it } from 'vitest';
import { routeOne, routeThree, routeTwo } from '../test/fixtures/plan';
import { theme } from '../theme';
import { rgb } from './colour';
import type { LngLat } from './polyline';
import {
  createRouteLabelLayer,
  labelSize,
  placeLabels,
  routeLabelText,
  type LabelTone,
  type LabelView,
  type RouteLabel,
} from './routeLabels';
import { RECOMMENDED_ROUTE_COLOR } from './routeStyle';

describe('route label text', () => {
  it('names the route, its time and that it is recommended, with the average risk', () => {
    expect(routeLabelText(routeOne, 'Route 1', { recommended: true, detail: 'full' })).toBe(
      'Route 1 · 14 h 55 min\nRecommended · Avg risk 0.45',
    );
  });

  it('gives an alternative its time and average risk', () => {
    expect(routeLabelText(routeTwo, 'Route 2', { recommended: false, detail: 'full' })).toBe(
      'Route 2 · 14 h 48 min\nAvg risk 0.90',
    );
  });

  it('says Blocked, with the No Travel miles, for a blocked route', () => {
    expect(routeLabelText(routeThree, 'Route 3', { recommended: false, detail: 'full' })).toBe(
      'Route 3 · 16 h 13 min\nBlocked · No Travel 29.4 mi',
    );
  });

  it('keeps only the name, time and status when the map is narrow', () => {
    expect(routeLabelText(routeOne, 'Route 1', { recommended: true, detail: 'brief' })).toBe(
      'Route 1 · 14 h 55 min\nRecommended',
    );
    expect(routeLabelText(routeTwo, 'Route 2', { recommended: false, detail: 'brief' })).toBe(
      'Route 2 · 14 h 48 min',
    );
    expect(routeLabelText(routeThree, 'Route 3', { recommended: false, detail: 'brief' })).toBe(
      'Route 3 · 16 h 13 min\nBlocked',
    );
  });

  it('shows n/a for a route without an average risk', () => {
    expect(
      routeLabelText({ ...routeOne, average_risk: null }, 'Route 1', {
        recommended: false,
        detail: 'full',
      }),
    ).toContain('Avg risk n/a');
  });
});

describe('the border of a label', () => {
  const borderOf = (tone: LabelTone) => {
    const { getBorderColor } = createRouteLabelLayer([], () => undefined).props;
    return Array.from(
      (getBorderColor as unknown as (label: RouteLabel) => number[])({ tone } as RouteLabel),
    );
  };

  it('is the blue of the selection for the selected route only', () => {
    const blue = [theme.palette.primary.main, theme.palette.primary.dark].map(rgb);

    expect(borderOf('selected')).toEqual(rgb(theme.palette.primary.main));
    for (const tone of ['recommended', 'blocked', 'plain'] as const)
      expect(blue).not.toContainEqual(borderOf(tone));
  });

  it('matches the line of a recommended route that is not selected', () => {
    expect(borderOf('recommended')).toEqual(rgb(RECOMMENDED_ROUTE_COLOR));
  });
});

describe('the size of a label', () => {
  it('grows with the longest line and the number of lines', () => {
    const one = labelSize('Route 1 · 14 h 55 min');
    const two = labelSize('Route 1 · 14 h 55 min\nRecommended · Avg risk 0.45');

    expect(two[0]).toBeGreaterThan(one[0]);
    expect(two[1]).toBeGreaterThan(one[1]);
  });
});

// A flat "screen": one degree is ten pixels, north is up, and latitude 0 is halfway down.
const view = (overrides: Partial<LabelView> = {}): LabelView => ({
  project: ([lng, lat]) => [lng * 10, 150 - lat * 10],
  width: 400,
  height: 300,
  ...overrides,
});
const SIZE: [number, number] = [120, 34];
const screen = ([lng, lat]: LngLat) => [lng * 10, 150 - lat * 10];

function rectOf(position: LngLat, size = SIZE) {
  const [x, y] = screen(position);
  return {
    left: x - size[0] / 2,
    right: x + size[0] / 2,
    top: y - size[1] / 2,
    bottom: y + size[1] / 2,
  };
}
function overlap(a: LngLat, b: LngLat) {
  const [r, s] = [rectOf(a), rectOf(b)];
  return r.left < s.right && s.left < r.right && r.top < s.bottom && s.top < r.bottom;
}

// Two routes that share their first and last stretch and part in the middle, as roads do.
const straight: LngLat[] = [
  [2, 0],
  [38, 0],
];
const bulging: LngLat[] = [
  [2, 0],
  [10, 0],
  [20, 8],
  [30, 0],
  [38, 0],
];

describe('placing labels', () => {
  it('puts each label where its route is clear of the others, not on the shared road', () => {
    const placed = placeLabels(
      [
        { id: 'a', path: straight, size: SIZE, priority: 0 },
        { id: 'b', path: bulging, size: SIZE, priority: 0 },
      ],
      view(),
    );

    // The middle is the only stretch where the two lines are apart (by at least 40 px).
    for (const id of ['a', 'b']) {
      const [x] = screen(placed[id]);
      expect(x).toBeGreaterThan(110);
      expect(x).toBeLessThan(290);
    }
    expect(overlap(placed.a, placed.b)).toBe(false);
  });

  it('never lets two labels cover each other, even on routes that are one and the same', () => {
    const placed = placeLabels(
      [
        { id: 'a', path: straight, size: SIZE, priority: 1 },
        { id: 'b', path: straight, size: SIZE, priority: 0 },
        { id: 'c', path: straight, size: SIZE, priority: 0 },
      ],
      view(),
    );

    const ids = Object.keys(placed);
    expect(ids).toContain('a');
    for (const first of ids)
      for (const second of ids)
        if (first < second) expect(overlap(placed[first], placed[second])).toBe(false);
  });

  it('keeps every label wholly inside the map, clear of the padding the layout asks for', () => {
    // The line runs past both sides and the label must still fit, above a 100 px bottom sheet.
    const long: LngLat[] = [
      [-20, 15],
      [60, -15],
    ];
    const placed = placeLabels(
      [{ id: 'a', path: long, size: SIZE, priority: 0 }],
      view({ padding: { bottom: 100 } }),
    );

    const { left, right, top, bottom } = rectOf(placed.a);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(400);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeLessThanOrEqual(200);
  });

  it('keeps clear of the pins standing at the ends of the routes', () => {
    // A pin is about 28 px wide and stands 42 px above its point; this label would cover them.
    const short: LngLat[] = [
      [12, 0],
      [28, 0],
    ];
    const wide: [number, number] = [160, 34];
    const placed = placeLabels([{ id: 'a', path: short, size: wide, priority: 0 }], view());

    if (placed.a) {
      const label = rectOf(placed.a, wide);
      for (const [lng, lat] of short) {
        const [x, y] = screen([lng, lat]);
        const pin = { left: x - 14, right: x + 14, top: y - 42, bottom: y };
        const covers =
          label.left < pin.right &&
          pin.left < label.right &&
          label.top < pin.bottom &&
          pin.top < label.bottom;
        expect(covers).toBe(false);
      }
    }
  });

  it('leaves out a route none of which is on screen', () => {
    const away: LngLat[] = [
      [100, 50],
      [120, 50],
    ];

    const placed = placeLabels(
      [
        { id: 'a', path: straight, size: SIZE, priority: 0 },
        { id: 'b', path: away, size: SIZE, priority: 0 },
      ],
      view(),
    );

    expect(Object.keys(placed)).toEqual(['a']);
  });

  it('keeps a label where it was while that is still a good place', () => {
    const routes = [
      { id: 'a', path: straight, size: SIZE, priority: 0 },
      { id: 'b', path: bulging, size: SIZE, priority: 0 },
    ];
    const first = placeLabels(routes, view());
    // Hold the label of `b` somewhere else that is still clear of the routes: it stays there.
    const previous = { b: [17.5, 6] as LngLat };

    const again = placeLabels(routes, view(), previous);

    expect(again.b).toEqual(previous.b);
    expect(first.b).not.toEqual(previous.b);
  });

  it('moves a label that has been left on the shared road', () => {
    const routes = [
      { id: 'a', path: straight, size: SIZE, priority: 0 },
      { id: 'b', path: bulging, size: SIZE, priority: 0 },
    ];

    const again = placeLabels(routes, view(), { b: [4, 0] });

    expect(again.b).not.toEqual([4, 0]);
  });
});
