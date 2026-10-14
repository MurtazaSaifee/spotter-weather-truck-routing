import type { LngLat } from '../map/polyline';

/** Where a truck is on its route at one moment, and what it is doing there. */
export interface TruckPosition {
  position: LngLat;
  /** Miles driven from the origin, by the routing answer's length. */
  mile: number;
  state: 'at-origin' | 'en-route' | 'arrived';
}

/** A route's line with the time and the distance at each of its vertices. */
export interface TruckTrack {
  path: readonly LngLat[];
  /** Seconds after departure at each vertex. Never decreasing. */
  elapsedSeconds: readonly number[];
  /** Miles from the origin at each vertex; the last is the route's length. */
  miles: readonly number[];
}

/** The slider counts hours after departure; the track counts seconds. */
export const SECONDS_PER_HOUR = 3600;

const EARTH_RADIUS_MILES = 3958.8;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

function haversineMiles([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
}

/**
 * Pairs a route's decoded line with its per-vertex times (`elapsed_seconds`). Distances between
 * vertices are measured along the line and scaled so the whole line is `distanceMiles`, the
 * length the routing answer reports and the checkpoints' mile markers count in: the geometry is
 * simplified, so measuring it alone would come out a little short.
 */
export function createTruckTrack(
  path: readonly LngLat[],
  elapsedSeconds: readonly number[],
  distanceMiles: number,
): TruckTrack {
  const measured = [0];
  for (let i = 1; i < path.length; i++) {
    measured.push(measured[i - 1] + haversineMiles(path[i - 1], path[i]));
  }
  const total = measured[measured.length - 1] ?? 0;
  const scale = total > 0 ? distanceMiles / total : 0;
  return { path, elapsedSeconds, miles: measured.map((miles) => miles * scale) };
}

/**
 * The truck's position `seconds` after departure: linear in time between the vertices, which
 * is how the times were produced. At or before departure it is at the origin, and from the
 * arrival time on it stays at the destination.
 */
export function truckAt(track: TruckTrack, seconds: number): TruckPosition {
  const { path, elapsedSeconds, miles } = track;
  const last = path.length - 1;
  if (last < 0) throw new Error('A route needs at least one vertex');

  if (seconds <= (elapsedSeconds[0] ?? 0)) {
    return { state: 'at-origin', position: path[0], mile: 0 };
  }
  if (seconds >= (elapsedSeconds[last] ?? 0)) {
    return { state: 'arrived', position: path[last], mile: miles[last] ?? 0 };
  }

  // The last vertex reached by `seconds`; it is before the end, so a next vertex exists, and
  // it is strictly later (a stop's repeated times are skipped by taking the last of them).
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (elapsedSeconds[middle] <= seconds) low = middle;
    else high = middle;
  }

  const startTime = elapsedSeconds[low];
  const share = (seconds - startTime) / (elapsedSeconds[high] - startTime);
  const [lng1, lat1] = path[low];
  const [lng2, lat2] = path[high];
  return {
    state: 'en-route',
    position: [lng1 + (lng2 - lng1) * share, lat1 + (lat2 - lat1) * share],
    mile: miles[low] + (miles[high] - miles[low]) * share,
  };
}
