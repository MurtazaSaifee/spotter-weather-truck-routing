import { createContext, useContext, useSyncExternalStore } from 'react';

/** Hours after departure the slider can show: 0 to 48 inclusive. */
export const MAX_FORECAST_HOUR = 48;

/**
 * The hour the driver is looking at. It lives outside React state so that dragging the slider
 * re-renders only what shows the hour (the slider's own label), while the map layers follow
 * it by subscribing directly: nothing above them re-renders on a tick.
 */
export interface ForecastHourStore {
  get: () => number;
  set: (hour: number) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createForecastHourStore(): ForecastHourStore {
  let hour = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => hour,
    set(next) {
      const clamped = Math.min(MAX_FORECAST_HOUR, Math.max(0, Math.round(next)));
      if (clamped === hour) return;
      hour = clamped;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const ForecastHourContext = createContext<ForecastHourStore | null>(null);

export function useForecastHourStore(): ForecastHourStore {
  const store = useContext(ForecastHourContext);
  if (!store) throw new Error('ForecastHourContext is missing');
  return store;
}

/** The current hour, re-rendering the caller on every change. */
export function useForecastHour(): number {
  const store = useForecastHourStore();
  return useSyncExternalStore(store.subscribe, store.get);
}
