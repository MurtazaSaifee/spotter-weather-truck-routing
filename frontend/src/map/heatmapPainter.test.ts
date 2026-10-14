import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createForecastHourStore } from '../heatmap/forecastHour';
import type { HeatmapBitmaps } from '../heatmap/useHeatmapBitmaps';
import { HeatmapPainter } from './heatmapPainter';
import { createLayerStore } from './layerStore';

// deck.gl loads a BitmapLayer's image asynchronously and needs WebGL: stand in for the layer
// with one that simply keeps the props it was given.
vi.mock('@deck.gl/layers', () => ({
  BitmapLayer: class {
    props: object;
    constructor(props: object) {
      this.props = props;
    }
  },
}));

/** A layer's 49 frames, each named by layer and hour: `wind7` is the wind at T+7h. */
function framesOf(layer: string): HeatmapBitmaps {
  return {
    bitmaps: Array.from({ length: 49 }, (_, hour) => `${layer}${hour}` as unknown as ImageBitmap),
    bounds: [-90, 40, -88, 41],
  };
}

/** The frames the map is drawing, by name. */
function drawn(underlay: ReturnType<typeof createLayerStore>) {
  const layers = underlay.get() as unknown as { props: { image: string } }[];
  return layers.map(({ props }) => props.image);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('HeatmapPainter', () => {
  function setUp() {
    const hourStore = createForecastHourStore();
    const underlay = createLayerStore();
    const painter = new HeatmapPainter({ hourStore, underlay });
    return { hourStore, underlay, painter };
  }

  it('draws the frame for the hour, and the next one when the hour moves', () => {
    const { hourStore, underlay, painter } = setUp();
    hourStore.set(7);
    painter.setFrames(framesOf('risk'));
    vi.advanceTimersByTime(1000);
    expect(drawn(underlay)).toEqual(['risk7']);

    hourStore.set(8);
    vi.advanceTimersByTime(1000);

    expect(drawn(underlay)).toEqual(['risk8']);
  });

  it('crossfades to the new layer at the same hour, then settles on it alone', () => {
    const { hourStore, underlay, painter } = setUp();
    hourStore.set(7);
    painter.setFrames(framesOf('risk'));
    vi.advanceTimersByTime(1000);

    painter.setFrames(framesOf('wind'));
    vi.advanceTimersByTime(50);
    expect(drawn(underlay).sort()).toEqual(['risk7', 'wind7']);

    vi.advanceTimersByTime(1000);
    expect(drawn(underlay)).toEqual(['wind7']);
  });

  it('keeps following the hour in the layer it switched to', () => {
    const { hourStore, underlay, painter } = setUp();
    painter.setFrames(framesOf('risk'));
    painter.setFrames(framesOf('snow'));
    vi.advanceTimersByTime(1000);

    hourStore.set(30);
    vi.advanceTimersByTime(1000);

    expect(drawn(underlay)).toEqual(['snow30']);
  });

  it('clears the heatmap off the map and stops following the hour when it is disposed', () => {
    const { hourStore, underlay, painter } = setUp();
    painter.setFrames(framesOf('risk'));
    vi.advanceTimersByTime(1000);

    painter.dispose();
    hourStore.set(3);
    vi.advanceTimersByTime(1000);

    expect(drawn(underlay)).toEqual([]);
  });
});
