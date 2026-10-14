import { describe, expect, it } from 'vitest';
import { routeOne, routeThree, routeTwo } from '../test/fixtures/plan';
import { pointAlong, routeLabelText } from './routeLabels';

describe('route label text', () => {
  it('gives the travel time and the risk summary of a recommended route', () => {
    expect(routeLabelText(routeOne, 'Route 1', true)).toBe(
      'Route 1 · 14 h 55 min · Recommended\nSevere 0 mi · High 0 mi · Avg risk 0.45',
    );
  });

  it('is plain for an alternative', () => {
    expect(routeLabelText(routeTwo, 'Route 2', false)).toBe(
      'Route 2 · 14 h 48 min\nSevere 0 mi · High 50 mi · Avg risk 0.90',
    );
  });

  it('says Blocked and the No Travel miles for a blocked route', () => {
    expect(routeLabelText(routeThree, 'Route 3', false)).toBe(
      'Route 3 · 16 h 13 min · Blocked\nNo Travel 29.4 mi · Severe 0 mi · High 50 mi · Avg risk 0.50',
    );
  });

  it('shows n/a for a route without an average risk', () => {
    expect(routeLabelText({ ...routeOne, average_risk: null }, 'Route 1', false)).toContain(
      'Avg risk n/a',
    );
  });
});

describe('the point a label sits at', () => {
  it('is the given share of the way along a straight line', () => {
    const point = pointAlong(
      [
        [-90, 40],
        [-90, 42],
      ],
      0.25,
    );

    expect(point[0]).toBeCloseTo(-90);
    expect(point[1]).toBeCloseTo(40.5);
  });

  it('follows the length of the line, not the number of vertices', () => {
    // One long segment (3 degrees of latitude) then a short one (1 degree): half of 4 degrees is
    // 2 degrees along the first.
    const point = pointAlong(
      [
        [-90, 40],
        [-90, 43],
        [-90, 44],
      ],
      0.5,
    );

    expect(point[1]).toBeCloseTo(42);
  });

  it('turns corners', () => {
    // 1 degree of latitude north, then east along latitude 41 for as far as 1 degree of
    // latitude is long: the middle is the corner.
    const eastDegrees = 1 / Math.cos((41 * Math.PI) / 180);
    const point = pointAlong(
      [
        [-90, 40],
        [-90, 41],
        [-90 + eastDegrees, 41],
      ],
      0.5,
    );

    expect(point[0]).toBeCloseTo(-90, 1);
    expect(point[1]).toBeCloseTo(41, 1);
  });

  it('stays on the line for shares outside 0 to 1', () => {
    const path: [number, number][] = [
      [-90, 40],
      [-90, 42],
    ];

    expect(pointAlong(path, -1)).toEqual([-90, 40]);
    expect(pointAlong(path, 2)).toEqual([-90, 42]);
  });
});
