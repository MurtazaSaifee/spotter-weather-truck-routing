import type { TruckPosition } from './truckTrack';

/** What the truck is doing, in words: `At origin`, `En route · mile 412` or `Arrived`. */
export function truckStateText({ state, mile }: TruckPosition): string {
  if (state === 'at-origin') return 'At origin';
  if (state === 'arrived') return 'Arrived';
  return `En route · mile ${Math.round(mile)}`;
}
