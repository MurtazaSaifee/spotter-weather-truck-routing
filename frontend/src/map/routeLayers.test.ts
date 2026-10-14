import { PathStyleExtension } from '@deck.gl/extensions';
import { describe, expect, it } from 'vitest';
import {
  createRouteLayers,
  OTHER_WIDTH_PX,
  RECOMMENDED_WIDTH_PX,
  rgb,
  SELECTED_WIDTH_PX,
  type RoutePath,
} from './routeLayers';

const paths: RoutePath[] = ['route-1', 'route-2', 'route-3'].map((id) => ({
  id,
  path: [
    [0, 0],
    [1, 1],
  ],
}));

const COLORS = { selectedColor: '#0000ff', recommendedColor: '#000080', otherColor: '#999999' };

function layers(overrides: Partial<Parameters<typeof createRouteLayers>[0]> = {}) {
  return createRouteLayers({
    paths,
    selectedRouteId: 'route-3',
    recommendedRouteId: 'route-2',
    blockedRouteIds: new Set<string>(),
    onSelectRoute: () => undefined,
    ...COLORS,
    ...overrides,
  });
}

/** The drawing position of the layer holding a route (later is on top), and its settings. */
function drawn(all: ReturnType<typeof layers>, id: string) {
  const position = all.findIndex((layer) => (layer.props.data as RoutePath[]).some((r) => r.id === id));
  const layer = all[position];
  const route = paths.find((r) => r.id === id)!;
  const accessor = <T>(value: unknown) => (value as (r: RoutePath) => T)(route);
  return {
    position,
    width: accessor<number>(layer.props.getWidth),
    color: Array.from(accessor<number[]>(layer.props.getColor)),
    dashed: (layer.props.extensions ?? []).some((e) => e instanceof PathStyleExtension),
  };
}

describe('route layers', () => {
  it('draw the recommended route thicker than the others and above them', () => {
    const all = layers();

    const recommended = drawn(all, 'route-2');
    const other = drawn(all, 'route-1');
    expect(recommended.width).toBe(RECOMMENDED_WIDTH_PX);
    expect(other.width).toBe(OTHER_WIDTH_PX);
    expect(recommended.width).toBeGreaterThan(other.width);
    expect(recommended.position).toBeGreaterThan(other.position);
  });

  it('draw the selected route above the recommended one, in the selection colour', () => {
    const all = layers();

    const selected = drawn(all, 'route-3');
    expect(selected.position).toBeGreaterThan(drawn(all, 'route-2').position);
    expect(selected.width).toBe(SELECTED_WIDTH_PX);
    expect(selected.color).toEqual(rgb(COLORS.selectedColor));
    expect(drawn(all, 'route-2').color).toEqual(rgb(COLORS.recommendedColor));
    expect(drawn(all, 'route-1').color).toEqual(rgb(COLORS.otherColor));
  });

  it('keep the recommended route thick and on top of the others when it is selected too', () => {
    const all = layers({ selectedRouteId: 'route-2' });

    const both = drawn(all, 'route-2');
    expect(both.width).toBe(RECOMMENDED_WIDTH_PX);
    expect(both.position).toBeGreaterThan(drawn(all, 'route-1').position);
    expect(both.color).toEqual(rgb(COLORS.selectedColor));
  });

  it('draw blocked routes dashed, whether or not they are selected, and only them', () => {
    const blocked = new Set(['route-1', 'route-3']);

    const all = layers({ blockedRouteIds: blocked });

    expect(drawn(all, 'route-1').dashed).toBe(true);
    expect(drawn(all, 'route-3').dashed).toBe(true);
    expect(drawn(all, 'route-2').dashed).toBe(false);
    const selectedBlocked = layers({ selectedRouteId: 'route-1', blockedRouteIds: blocked });
    expect(drawn(selectedBlocked, 'route-1').dashed).toBe(true);
  });

  it('draw every route exactly once', () => {
    const all = layers({ blockedRouteIds: new Set(['route-1']) });

    const ids = all.flatMap((layer) => (layer.props.data as RoutePath[]).map((r) => r.id));
    expect(ids.sort()).toEqual(['route-1', 'route-2', 'route-3']);
  });

  it('draw nothing special when no route is recommended', () => {
    const all = layers({ recommendedRouteId: null, selectedRouteId: null });

    expect(paths.map((p) => drawn(all, p.id).width)).toEqual([OTHER_WIDTH_PX, OTHER_WIDTH_PX, OTHER_WIDTH_PX]);
  });
});
