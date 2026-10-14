/** The heaviest cargo a truck is planned for. */
export const MAX_LOAD_WEIGHT_LB = 50_000;

const MAX_DIGITS = 9;

/** Digits only, grouped with thousands separators: `42000` becomes `42,000`. */
export function formatWeightInput(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, MAX_DIGITS);
  return digits === '' ? '' : Number(digits).toLocaleString('en-US');
}

/** The pounds typed, or null while nothing is typed. */
export function parseWeight(text: string): number | null {
  const digits = text.replace(/\D/g, '');
  return digits === '' ? null : Number(digits);
}

/** What is wrong with the weight, or null when it is acceptable. */
export function weightError(pounds: number | null): string | null {
  if (pounds === null) return 'Enter the load weight in pounds.';
  if (pounds <= 0) return 'Load weight must be greater than 0 lb.';
  if (pounds > MAX_LOAD_WEIGHT_LB) {
    return `Load weight can be at most ${MAX_LOAD_WEIGHT_LB.toLocaleString('en-US')} lb.`;
  }
  return null;
}
