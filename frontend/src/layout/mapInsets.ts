import { createContext, useContext } from 'react';

/**
 * How much of the map's edges the phone layout covers with its own chrome, in px: the bottom
 * sheet (at its current snap, up to half height) below, the forecast controls above. The map
 * itself stays one size so dragging the sheet never resizes a WebGL canvas; whatever frames
 * the camera should keep the routes inside these insets. Always zero on desktop.
 */
export interface MapInsets {
  top: number;
  bottom: number;
}

const NO_MAP_INSETS: MapInsets = { top: 0, bottom: 0 };

export const MapInsetsContext = createContext<MapInsets>(NO_MAP_INSETS);

export function useMapInsets(): MapInsets {
  return useContext(MapInsetsContext);
}
