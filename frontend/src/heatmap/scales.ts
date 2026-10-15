import { rgb } from '../map/colour';

/** The weather behind the risk, one layer each. */
export type WeatherLayer = 'wind' | 'rain' | 'snow';

/**
 * A fixed continuous colour scale. It never adapts to the data on screen, so a colour means
 * the same weather at every hour and on every trip.
 */
interface WeatherScale {
  /** What the legend calls the layer. */
  title: string;
  unit: string;
  /** The value at the top colour; anything above it takes that colour too. */
  max: number;
  /** `#rrggbb` colours at evenly spaced values from 0 to `max`, light to dark. */
  stops: readonly string[];
  /** The legend's labels at 0, halfway and the top (which stands for "or more"). */
  labels: readonly [string, string, string];
}

// Blues and teals run light to dark: the risk palette's greens, ambers and reds are kept for
// risk, so a raw layer is never mistaken for it.
export const WEATHER_SCALES: Record<WeatherLayer, WeatherScale> = {
  wind: {
    title: 'Wind speed',
    unit: 'mph',
    max: 60,
    stops: ['#e3f4f1', '#8fd0c8', '#35a3a8', '#1d7480', '#0c3f4d'],
    labels: ['0', '30', '60+'],
  },
  rain: {
    title: 'Rain rate',
    unit: 'in/hr',
    max: 1.2,
    stops: ['#e4eefa', '#9cc4ee', '#4b8be0', '#2a4fc0', '#1a1f80'],
    labels: ['0', '0.6', '1.2+'],
  },
  snow: {
    title: 'Snowfall rate',
    unit: 'in/hr',
    max: 3.5,
    stops: ['#efeaf8', '#c5b6ea', '#9a80d8', '#7048b8', '#44218a'],
    labels: ['0', '1.75', '3.5+'],
  },
};

const STEPS = 257;

/**
 * The scale's colours as `[r, g, b]`, `STEPS` of them from 0 to `max`, so painting a pixel is
 * a lookup rather than a blend.
 */
export function colourTable({ stops }: Pick<WeatherScale, 'stops'>): [number, number, number][] {
  const colours = stops.map(rgb);
  return Array.from({ length: STEPS }, (_, step) => {
    const position = (step / (STEPS - 1)) * (colours.length - 1);
    const lower = Math.min(colours.length - 2, Math.floor(position));
    const t = position - lower;
    const [r, g, b] = colours[lower].map((from, i) =>
      Math.round(from + (colours[lower + 1][i] - from) * t),
    );
    return [r, g, b];
  });
}

/** `colourTable`'s step for `fraction` of the scale, clamped to its ends. */
export function stepFor(fraction: number): number {
  return Math.round(Math.min(1, Math.max(0, fraction)) * (STEPS - 1));
}
