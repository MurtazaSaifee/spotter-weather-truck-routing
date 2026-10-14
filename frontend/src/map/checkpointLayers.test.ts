import { describe, expect, it } from 'vitest';
import { RISK_LEVELS } from '../risk/palette';
import { chicagoToDallas } from '../test/fixtures/plan';
import { TOUCH_TARGET } from '../theme';
import { rgb } from './colour';
import {
  checkpointDots,
  createCheckpointLayers,
  dotRadiusPx,
  nearestDot,
  OTHER_DOT,
  SELECTED_DOT,
} from './checkpointLayers';

describe('checkpoint dots', () => {
  it('are coloured by risk level with the palette the legend uses, on every route', () => {
    const dots = checkpointDots(chicagoToDallas.routes);
    const layers = createCheckpointLayers({ dots, selectedRouteId: 'route-2' });

    const colourOf = (mile: number, routeId: string) => {
      const dot = dots.find((d) => d.routeId === routeId && d.checkpoint.mile === mile)!;
      const layer = layers.find((l) => (l.props.data as typeof dots).includes(dot))!;
      // deck.gl would call the accessor with the dot and some bookkeeping; it reads the dot only.
      const fill = layer.props.getFillColor as unknown as (d: typeof dot) => number[];
      return Array.from(fill(dot));
    };
    const palette = (code: string) => rgb(RISK_LEVELS.find((level) => level.code === code)!.color);

    // Miles 0, 25 and 50 are Low, Moderate and No data in the fixture.
    for (const routeId of ['route-1', 'route-2']) {
      expect(colourOf(0, routeId)).toEqual(palette('low'));
      expect(colourOf(25, routeId)).toEqual(palette('moderate'));
      expect(colourOf(50, routeId)).toEqual(palette('no_data'));
    }
  });

  it('use a different colour for every level', () => {
    expect(new Set(RISK_LEVELS.map((level) => level.color)).size).toBe(RISK_LEVELS.length);
  });
});

describe('checkpoint dot size', () => {
  const chicagoLatitude = 41.9;

  it('stays small while the whole trip is in view, so the heatmap shows through', () => {
    // Chicago to Dallas fits at about zoom 5.5.
    expect(dotRadiusPx(SELECTED_DOT, 5.5, chicagoLatitude)).toBeLessThanOrEqual(4);
    expect(dotRadiusPx(OTHER_DOT, 5.5, chicagoLatitude)).toBeLessThanOrEqual(3);
  });

  it('grows as the driver zooms in, up to a limit', () => {
    const radii = [5, 7, 8, 9, 10, 14].map((zoom) => dotRadiusPx(SELECTED_DOT, zoom, chicagoLatitude));

    expect(radii[3]).toBeGreaterThan(radii[0]);
    expect([...radii].sort((a, b) => a - b)).toEqual(radii);
    expect(radii[radii.length - 1]).toBe(SELECTED_DOT.maxPx);
  });

  it('keeps the selected route’s dots larger than the others at every zoom', () => {
    for (const zoom of [3, 5.5, 8, 10, 13])
      expect(dotRadiusPx(SELECTED_DOT, zoom, 35)).toBeGreaterThan(dotRadiusPx(OTHER_DOT, zoom, 35));
  });

  it('is handed to deck.gl as a size on the ground between pixel limits, so zooming needs no redraw by React', () => {
    const [others] = createCheckpointLayers({ dots: [], selectedRouteId: null });

    expect(others.props.radiusUnits).toBe('meters');
    expect(others.props.getRadius).toBe(OTHER_DOT.meters);
    expect(others.props.radiusMinPixels).toBe(OTHER_DOT.minPx);
    expect(others.props.radiusMaxPixels).toBe(OTHER_DOT.maxPx);
  });
});

describe('tapping near a dot', () => {
  const dots = checkpointDots(chicagoToDallas.routes).filter((dot) => dot.routeId === 'route-1');
  // One degree is a hundred pixels on this flat screen.
  const project = ([lng, lat]: [number, number]): [number, number] => [lng * 100, -lat * 100];
  const first = dots[0];
  const [x, y] = project(first.position);

  it('finds the dot within reach of a finger', () => {
    expect(nearestDot(dots, [x + 15, y - 10], project, TOUCH_TARGET / 2)).toBe(first);
  });

  it('finds nothing beyond the reach', () => {
    expect(nearestDot(dots, [x + 40, y], project, TOUCH_TARGET / 2)).toBeNull();
  });

  it('picks the nearer of two dots in reach', () => {
    const second = dots[1];
    const [sx, sy] = project(second.position);
    // A point a little nearer to the second dot than the first, with both in reach.
    const near: [number, number] = [sx * 0.9 + x * 0.1, sy * 0.9 + y * 0.1];

    expect(nearestDot(dots, near, project, 100_000)).toBe(second);
  });

  it('makes a touch target at least 44 pixels across', () => {
    expect(TOUCH_TARGET).toBeGreaterThanOrEqual(44);
  });
});
