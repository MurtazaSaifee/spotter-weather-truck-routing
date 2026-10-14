import { describe, expect, it } from 'vitest';
import { HeatmapFader } from './heatmapFader';

const ALPHA = 0.6;
const FADE_MS = 150;
const FADE_IN_MS = 400;

const image = (name: string) => name as unknown as ImageBitmap;

function makeFader() {
  return new HeatmapFader({ alpha: ALPHA, fadeMs: FADE_MS, fadeInMs: FADE_IN_MS });
}

/**
 * What the two layers add up to over the basemap. A frame drawn at opacity `a` over what is
 * beneath weighs `a`, and what is beneath keeps `1 - a`.
 */
function weights(fader: HeatmapFader) {
  const [lower, upper] = fader.slots();
  const upperWeight = upper.image ? upper.opacity : 0;
  const lowerWeight = lower.image ? lower.opacity * (1 - upperWeight) : 0;
  return {
    lower: lowerWeight,
    upper: upperWeight,
    basemap: 1 - lowerWeight - upperWeight,
  };
}

describe('HeatmapFader', () => {
  it('draws nothing before there is a frame', () => {
    const fader = makeFader();

    expect(fader.slots().every((slot) => slot.image === null)).toBe(true);
    expect(fader.advance(0)).toBe(false);
  });

  it('fades the first frame in from nothing to the full opacity', () => {
    const fader = makeFader();

    fader.show(image('a'), 1_000);
    expect(fader.advance(1_000)).toBe(true);
    expect(weights(fader).basemap).toBeCloseTo(1);

    expect(fader.advance(1_000 + FADE_IN_MS)).toBe(false);
    const [first] = fader.slots();
    expect(first.image).toBe('a');
    expect(first.opacity).toBeCloseTo(ALPHA);
    expect(weights(fader).basemap).toBeCloseTo(1 - ALPHA);
  });

  it('crossfades from one frame to the next without ever dimming what is drawn', () => {
    const fader = makeFader();
    fader.show(image('a'), 0);
    fader.advance(FADE_IN_MS);

    fader.show(image('b'), 1_000);
    for (const elapsed of [0, 30, 75, 120, FADE_MS]) {
      fader.advance(1_000 + elapsed);
      // Together the frames always cover the heatmap's opacity: no dip towards the basemap.
      expect(weights(fader).basemap).toBeCloseTo(1 - ALPHA);
    }
    const shown = fader.slots().filter((slot) => slot.image && slot.opacity > 0);
    expect(shown.map((slot) => slot.image)).toEqual(['b']);
  });

  it('moves weight steadily from the old frame to the new one', () => {
    const fader = makeFader();
    fader.show(image('a'), 0);
    fader.advance(FADE_IN_MS);
    fader.show(image('b'), 1_000);

    fader.advance(1_000);
    const before = weights(fader);
    fader.advance(1_000 + FADE_MS / 2);
    const middle = weights(fader);
    fader.advance(1_000 + FADE_MS);
    const after = weights(fader);

    const weightOf = (name: string) => {
      const [lower, upper] = fader.slots();
      const named = (slot: { image: ImageBitmap | null }) => (slot.image as unknown) === name;
      return (state: ReturnType<typeof weights>) =>
        (named(lower) ? state.lower : 0) + (named(upper) ? state.upper : 0);
    };
    expect(weightOf('b')(before)).toBeCloseTo(0);
    expect(weightOf('b')(middle)).toBeGreaterThan(0.1);
    expect(weightOf('b')(middle)).toBeLessThan(ALPHA - 0.1);
    expect(weightOf('b')(after)).toBeCloseTo(ALPHA);
  });

  it('does nothing when asked for the frame already shown', () => {
    const fader = makeFader();
    fader.show(image('a'), 0);
    fader.advance(FADE_IN_MS);

    fader.show(image('a'), 2_000);

    expect(fader.advance(2_000)).toBe(false);
  });

  it('keeps showing a frame while a fast scrub asks for several more', () => {
    const fader = makeFader();
    fader.show(image('a'), 0);
    fader.advance(FADE_IN_MS);

    let now = 1_000;
    for (const name of ['b', 'c', 'd', 'e']) {
      fader.show(image(name), now);
      now += 16;
      fader.advance(now);
      expect(weights(fader).basemap).toBeCloseTo(1 - ALPHA);
    }
    fader.advance(now + FADE_MS);

    const shown = fader.slots().filter((slot) => slot.image && slot.opacity > 0);
    expect(shown.map((slot) => slot.image)).toEqual(['e']);
  });
});
