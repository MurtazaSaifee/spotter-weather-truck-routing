import { describe, expect, it } from 'vitest';
import { decodePolyline } from './polyline';

describe('decodePolyline', () => {
  it("decodes the API's encoding, as [longitude, latitude] pairs", () => {
    // The worked example from Google's documentation; the backend's encoder is
    // tested against the same string, so the two ends agree on the format.
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');

    expect(points).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it('decodes nothing from an empty string', () => {
    expect(decodePolyline('')).toEqual([]);
  });
});
