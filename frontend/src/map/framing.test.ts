import { describe, expect, it } from 'vitest';
import { boundsOfRoutes, CONTROL_COLUMN_PX, constrainCamera, fitPadding } from './framing';

describe('the padding of a fit', () => {
  it('is a share of the map’s own size, so a narrow map is not swallowed by it', () => {
    const narrow = fitPadding(400, 700);
    const wide = fitPadding(1200, 700);

    // 12% of what is left once the column of controls is taken off.
    expect(narrow.left).toBe(Math.round((400 - CONTROL_COLUMN_PX) * 0.12));
    expect(wide.left).toBe(Math.round((1200 - CONTROL_COLUMN_PX) * 0.12));
    expect(narrow.bottom).toBe(84);
  });

  it('reserves the column of map controls on the right, on top of the share', () => {
    const padding = fitPadding(400, 700);

    expect(padding.right).toBe(padding.left + CONTROL_COLUMN_PX);
  });

  it('leaves room above for a pin even on a short map', () => {
    expect(fitPadding(400, 200).top).toBeGreaterThanOrEqual(56);
  });

  it('keeps clear of what covers the map, and takes the share from what is left', () => {
    // A 300 px sheet over a 700 px map leaves 400 px, of which 12% is 48.
    const padding = fitPadding(400, 700, { bottom: 300 });

    expect(padding.bottom).toBe(300 + 48);
    expect(padding.top).toBe(56);
  });
});

describe('the bounds of the routes', () => {
  it('is the box around every point of every route', () => {
    expect(
      boundsOfRoutes([
        {
          id: 'a',
          path: [
            [-88, 41],
            [-97, 33],
          ],
        },
        {
          id: 'b',
          path: [
            [-90, 42],
            [-95, 32],
          ],
        },
      ]),
    ).toEqual([
      [-97, 32],
      [-88, 42],
    ]);
  });

  it('is null without a point', () => {
    expect(boundsOfRoutes([])).toBeNull();
    expect(boundsOfRoutes([{ id: 'a', path: [] }])).toBeNull();
  });
});

describe('where the camera may go', () => {
  const phone = { width: 375, height: 740, minZoom: -2, maxZoom: 22 };
  const desktop = { width: 1200, height: 700, minZoom: -2, maxZoom: 22 };
  const centre = { lng: 5, lat: 20 };

  it('lets a tall phone map zoom out until the whole width of the world fits', () => {
    // MapLibre alone would stop at zoom 0.53, the world as tall as the map, 740 px wide.
    expect(constrainCamera(centre, -1, phone).zoom).toBe(-1);
    // But no further than the world half as wide as the map, and never past the map's zoom range.
    expect(constrainCamera(centre, -5, phone).zoom).toBeCloseTo(Math.log2(375 / 512) - 1, 10);
    expect(constrainCamera(centre, -1, { ...phone, minZoom: 0 }).zoom).toBe(0);
    expect(constrainCamera(centre, 30, phone).zoom).toBe(22);
  });

  it('keeps MapLibre’s own floor on a landscape map: the world as tall as the map', () => {
    expect(constrainCamera(centre, -1, desktop).zoom).toBeCloseTo(Math.log2(700 / 512), 10);
    expect(constrainCamera(centre, 3, desktop).zoom).toBe(3);
  });

  it('leaves a centre alone while the map stays inside the world', () => {
    expect(constrainCamera(centre, 3, desktop).center).toEqual(centre);
  });

  it('keeps a map zoomed in off the edge of the world, as MapLibre does', () => {
    // At zoom 3 the world is 4096 px tall, so a 700 px map cannot be centred near the pole.
    const { center } = constrainCamera({ lng: 5, lat: 85 }, 3, desktop);

    expect(center.lng).toBe(5);
    expect(center.lat).toBeLessThan(85);
    expect(constrainCamera({ lng: 5, lat: -85 }, 3, desktop).center.lat).toBeGreaterThan(-85);
  });

  it('leaves a world smaller than the map where a fit put it, below its own south edge', () => {
    // Fitting the world above a sheet puts the camera centre at the world's south edge or beyond.
    const zoom = -1.0345;
    const south = { lng: 44, lat: -85.05 };

    expect(constrainCamera(south, zoom, phone).center).toEqual(south);
  });
});
