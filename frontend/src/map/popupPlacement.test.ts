import { describe, expect, it } from 'vitest';
import { placePopup, type PopupArea } from './popupPlacement';

const SIZE: [number, number] = [232, 300];
const OFFSET = 12;
const map: PopupArea = { width: 400, height: 700 };

describe('placing a checkpoint popup', () => {
  it('puts it above the dot when there is room', () => {
    const { anchor, maxHeight } = placePopup({
      point: [200, 400],
      size: SIZE,
      area: map,
      offset: OFFSET,
    });

    expect(anchor).toBe('bottom');
    expect(maxHeight).toBeGreaterThanOrEqual(SIZE[1]);
  });

  it('puts it below a dot near the top', () => {
    expect(placePopup({ point: [200, 60], size: SIZE, area: map, offset: OFFSET }).anchor).toBe(
      'top',
    );
  });

  it('puts it beside a dot near the right edge, where it would be cut off above or below', () => {
    // 20 px from the right edge: 116 px either side of the dot do not fit.
    expect(placePopup({ point: [380, 400], size: SIZE, area: map, offset: OFFSET }).anchor).toBe(
      'right',
    );
  });

  it('puts it beside a dot near the left edge', () => {
    expect(placePopup({ point: [20, 400], size: SIZE, area: map, offset: OFFSET }).anchor).toBe(
      'left',
    );
  });

  it('tucks it into the corner for a dot near the top right', () => {
    // Below the dot, and extending left, the only way to fit.
    expect(placePopup({ point: [380, 20], size: SIZE, area: map, offset: OFFSET }).anchor).toBe(
      'top-right',
    );
  });

  it('tucks it into the corner for a dot near the bottom left', () => {
    expect(placePopup({ point: [20, 680], size: SIZE, area: map, offset: OFFSET }).anchor).toBe(
      'bottom-left',
    );
  });

  it('keeps clear of whatever covers the map, such as a bottom sheet', () => {
    // The sheet takes the lower 350 px, so the visible map ends at y = 350.
    const covered: PopupArea = { ...map, padding: { bottom: 350 } };

    const { anchor } = placePopup({ point: [200, 340], size: SIZE, area: covered, offset: OFFSET });

    // Below the dot is under the sheet; above it fits.
    expect(anchor).toBe('bottom');
    expect(placePopup({ point: [200, 40], size: SIZE, area: covered, offset: OFFSET }).anchor).toBe(
      'top',
    );
  });

  it('shrinks the popup to what is visible when it fits nowhere, so it can scroll', () => {
    const small: PopupArea = { width: 400, height: 260 };

    const { maxHeight } = placePopup({
      point: [200, 130],
      size: SIZE,
      area: small,
      offset: OFFSET,
    });

    expect(maxHeight).toBeLessThan(SIZE[1]);
    expect(maxHeight).toBeLessThanOrEqual(260 - 2 * 8);
  });
});
