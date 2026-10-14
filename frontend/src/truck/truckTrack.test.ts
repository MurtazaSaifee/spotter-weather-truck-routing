import { describe, expect, it } from 'vitest';
import type { LngLat } from '../map/polyline';
import { createTruckTrack, truckAt } from './truckTrack';

// A route due north along one meridian, so distance along it is proportional to latitude and
// every expected position and mile below can be worked out by hand: 0.1 degrees of latitude
// is a third of the 30 miles, 0.2 degrees the other two thirds.
const NORTHBOUND: LngLat[] = [
  [-90, 40.0],
  [-90, 40.1],
  [-90, 40.3],
];
const ELAPSED = [0, 600, 3000];
const MILES = 30;

const track = createTruckTrack(NORTHBOUND, ELAPSED, MILES);

describe('truckAt', () => {
  it('sits at the origin at departure', () => {
    expect(truckAt(track, 0)).toEqual({ state: 'at-origin', position: [-90, 40.0], mile: 0 });
  });

  it('sits at the origin before departure', () => {
    expect(truckAt(track, -3600)).toEqual({ state: 'at-origin', position: [-90, 40.0], mile: 0 });
  });

  it('is part of the way along a leg in proportion to the time spent on it', () => {
    const { state, position, mile } = truckAt(track, 300);
    expect(state).toBe('en-route');
    expect(position[0]).toBeCloseTo(-90, 9);
    expect(position[1]).toBeCloseTo(40.05, 9);
    expect(mile).toBeCloseTo(5, 4);
  });

  it('moves faster over a leg it covers faster', () => {
    // The first leg is 10 miles in 10 minutes, the second 20 miles in 40 minutes.
    const { position, mile } = truckAt(track, 600 + 1200);
    expect(position[1]).toBeCloseTo(40.2, 4);
    expect(mile).toBeCloseTo(20, 2);
  });

  it('is at a vertex exactly when its time is reached', () => {
    const { position, mile } = truckAt(track, 600);
    expect(position[1]).toBeCloseTo(40.1, 9);
    expect(mile).toBeCloseTo(10, 2);
  });

  it('has arrived at the destination at the arrival time', () => {
    expect(truckAt(track, 3000)).toEqual({ state: 'arrived', position: [-90, 40.3], mile: 30 });
  });

  it('stays at the destination after the arrival time', () => {
    expect(truckAt(track, 48 * 3600)).toEqual({
      state: 'arrived',
      position: [-90, 40.3],
      mile: 30,
    });
  });

  it('waits where it is through a stop, two vertices with the same time', () => {
    const stopped = createTruckTrack(
      [NORTHBOUND[0], NORTHBOUND[1], NORTHBOUND[1], NORTHBOUND[2]],
      [0, 600, 600, 3000],
      MILES,
    );
    const { position, mile } = truckAt(stopped, 1800);
    expect(position[1]).toBeCloseTo(40.2, 4);
    expect(mile).toBeCloseTo(20, 2);
  });

  it('counts miles by the routing answer, whatever the simplified geometry measures', () => {
    // The geometry measures about 20.7 miles on the ground; the routing answer says 25, and
    // the truck's miles agree with it, as the checkpoints' do.
    const stretched = createTruckTrack(NORTHBOUND, ELAPSED, 25);
    expect(truckAt(stretched, 3000).mile).toBe(25);
    expect(truckAt(stretched, 600).mile).toBeCloseTo(25 / 3, 2);
  });
});
