import { describe, expect, it } from 'vitest';
import { boundsOfRoutes, CONTROL_COLUMN_PX, fitPadding } from './framing';

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
