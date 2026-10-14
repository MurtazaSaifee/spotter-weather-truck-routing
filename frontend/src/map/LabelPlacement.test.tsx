import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { routeOne, routeTwo } from '../test/fixtures/plan';
import { CONTROL_COLUMN_PX } from './framing';
import { LabelPlacement } from './LabelPlacement';
import { createLayerStore } from './layerStore';
import { labelSize, routeLabelText, type RouteLabel } from './routeLabels';

const WIDTH = 375;

// A 375 x 700 map where one degree is one pixel: longitude is x, and y is 400 minus latitude.
const raw = vi.hoisted(() => ({
  getContainer: () => ({ clientWidth: 375, clientHeight: 700 }),
  project: ([lng, lat]: [number, number]) => ({ x: lng, y: 400 - lat }),
  on: vi.fn(),
  off: vi.fn(),
}));

vi.mock('react-map-gl/maplibre', () => ({ useMap: () => ({ current: { getMap: () => raw } }) }));

describe('placing the route labels', () => {
  it('keeps a label out of the column of map controls on the right', () => {
    // Another route hugs this one at the left, so the label wants the stretch beyond it, and
    // the spot it likes best on that stretch is under the zoom buttons.
    const path: [number, number][] = [
      [60, 100],
      [700, 100],
    ];
    const alongside: [number, number][] = [
      [60, 106],
      [120, 106],
    ];
    const layers = createLayerStore();
    const text = routeLabelText(routeOne, 'Route 1', { recommended: false, detail: 'brief' });

    render(
      <LabelPlacement
        routes={[routeOne, routeTwo]}
        paths={[
          { id: routeOne.id, path },
          { id: routeTwo.id, path: alongside },
        ]}
        names={{ [routeOne.id]: 'Route 1', [routeTwo.id]: 'Route 2' }}
        selectedRouteId={routeOne.id}
        recommendedRouteId={null}
        onSelectRoute={() => {}}
        layers={layers}
      />,
    );

    const [layer] = layers.get() as { props: { data: RouteLabel[] } }[];
    const label = layer.props.data.find(({ routeId }) => routeId === routeOne.id)!;
    const [labelWidth] = labelSize(text);
    expect(label.position[0] + labelWidth / 2).toBeLessThanOrEqual(WIDTH - CONTROL_COLUMN_PX);
  });
});
