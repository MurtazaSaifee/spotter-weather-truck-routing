/** A `#rrggbb` colour as `[r, g, b]`, each 0 to 255: the one parser the map and heatmap share. */
export function rgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
