import { PathStyleExtension } from '@deck.gl/extensions';
import { describe, expect, it } from 'vitest';
import { rgb } from './colour';
import {
  createRouteLayers,
  CASING_EXTRA_PX,
  OTHER_WIDTH_PX,
  RECOMMENDED_WIDTH_PX,
  ROLE_STYLES,
  routeRole,
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

const isCasing = (layer: ReturnType<typeof layers>[number]) => layer.id.endsWith('-casing');

/** The drawing position of the layer holding a route (later is on top), and its settings. */
function drawn(all: ReturnType<typeof layers>, id: string) {
  const position = all.findIndex(
    (layer) => !isCasing(layer) && (layer.props.data as RoutePath[]).some((r) => r.id === id),
  );
  const layer = all[position];
  const route = paths.find((r) => r.id === id)!;
  const accessor = <T>(value: unknown) => (value as (r: RoutePath) => T)(route);
  return {
    position,
    width: accessor<number>(layer.props.getWidth),
    color: Array.from(accessor<number[]>(layer.props.getColor)).slice(0, 3),
    alpha: Array.from(accessor<number[]>(layer.props.getColor))[3] ?? 255,
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

    const ids = all
      .filter((layer) => !isCasing(layer))
      .flatMap((layer) => (layer.props.data as RoutePath[]).map((r) => r.id));
    expect(ids.sort()).toEqual(['route-1', 'route-2', 'route-3']);
  });

  it('draw nothing special when no route is recommended', () => {
    const all = layers({ recommendedRouteId: null, selectedRouteId: null });

    expect(paths.map((p) => drawn(all, p.id).width)).toEqual([
      OTHER_WIDTH_PX,
      OTHER_WIDTH_PX,
      OTHER_WIDTH_PX,
    ]);
  });

  it('sets the selected route apart with a white casing under it, above the other routes', () => {
    const all = layers({ blockedRouteIds: new Set(['route-3']) });

    const casing = all.find((layer) => layer.id === 'selected-route-dashed-casing')!;
    const [route] = casing.props.data as RoutePath[];
    const casingWidth = (casing.props.getWidth as unknown as (r: RoutePath) => number)(route);
    expect(route.id).toBe('route-3');
    expect(casingWidth).toBe(SELECTED_WIDTH_PX + CASING_EXTRA_PX);
    expect(Array.from((casing.props.getColor as unknown as number[]).slice(0, 3))).toEqual([
      255, 255, 255,
    ]);
    expect(all.indexOf(casing)).toBeLessThan(drawn(all, 'route-3').position);
    expect(all.indexOf(casing)).toBeGreaterThan(drawn(all, 'route-2').position);
    // A dashed route gets a dashed casing, so it still reads as dashed.
    expect(casing.props.extensions?.length).toBe(1);
  });

  it('dims the routes that are not selected and keeps the selected one opaque', () => {
    const all = layers();

    expect(drawn(all, 'route-3').alpha).toBe(255);
    expect(drawn(all, 'route-1').alpha).toBeLessThan(255);
  });

  it('has no casing when nothing is selected', () => {
    const all = layers({ selectedRouteId: null });

    expect(
      all
        .filter((layer) => isCasing(layer))
        .every((layer) => (layer.props.data as unknown[]).length === 0),
    ).toBe(true);
    expect(drawn(all, 'route-1').alpha).toBe(255);
  });
});

describe('route roles', () => {
  const selection = { selectedRouteId: 'a', recommendedRouteId: 'b' };

  it.each([
    ['a', false, 'selected'],
    ['a', true, 'selected'],
    ['b', false, 'recommended'],
    ['c', true, 'blocked'],
    ['c', false, 'other'],
  ] as const)('give route %s (blocked: %s) the role %s', (id, blocked, role) => {
    expect(routeRole(id, blocked, selection)).toBe(role);
  });

  it('give the route that is selected and recommended both its look', () => {
    const role = routeRole('a', false, { selectedRouteId: 'a', recommendedRouteId: 'a' });

    expect(role).toBe('selectedRecommended');
    expect(ROLE_STYLES[role].width).toBe(RECOMMENDED_WIDTH_PX);
    expect(ROLE_STYLES[role].colour).toBe('selected');
  });
});
