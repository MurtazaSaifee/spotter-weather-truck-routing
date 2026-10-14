import { describe, expect, it } from 'vitest';
import { RISK_LEVELS } from '../risk/palette';
import { chicagoToDallas } from '../test/fixtures/plan';
import { rgb } from './routeLayers';
import { checkpointDots, createCheckpointLayers } from './checkpointLayers';

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
