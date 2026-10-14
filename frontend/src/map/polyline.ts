/** A point as `[longitude, latitude]`, the order MapLibre and deck.gl use. */
export type LngLat = [number, number];

const PRECISION = 1e5;

/** Decodes a Google encoded polyline (precision 5), as the API sends route geometry. */
export function decodePolyline(encoded: string): LngLat[] {
  const points: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  function nextDelta(): number {
    let result = 0;
    let shift = 0;
    let chunk: number;
    do {
      chunk = encoded.charCodeAt(index++) - 63;
      result |= (chunk & 0x1f) << shift;
      shift += 5;
    } while (chunk >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  }

  while (index < encoded.length) {
    lat += nextDelta();
    lng += nextDelta();
    points.push([lng / PRECISION, lat / PRECISION]);
  }
  return points;
}
