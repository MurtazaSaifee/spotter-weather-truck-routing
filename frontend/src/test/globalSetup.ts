/**
 * Runs once before the test workers start, so every worker inherits the zone. The
 * browser's own zone seeds the departure picker, so tests need one that is not the
 * machine's and that differs from the trip's origin (Chicago, UTC-5 in October): a
 * clock time re-labelled into the wrong zone must not be able to pass by coincidence.
 */
export function setup() {
  process.env.TZ = 'America/Los_Angeles';
}
