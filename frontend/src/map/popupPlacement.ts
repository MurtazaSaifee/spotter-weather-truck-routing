/** Which part of the popup touches the dot, as MapLibre names the anchors. */
export type PopupAnchor =
  | 'bottom'
  | 'top'
  | 'right'
  | 'left'
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left';

/** How wide a checkpoint popup is, and the height it is planned for: its content is no taller. */
export const POPUP_WIDTH_PX = 232;
export const POPUP_HEIGHT_PX = 300;

/** The map's visible part: its size, less whatever is laid over its edges. */
export interface PopupArea {
  width: number;
  height: number;
  padding?: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;
}

interface Placement {
  anchor: PopupAnchor;
  /** The tallest the popup can be and stay on the map: it scrolls beyond that. */
  maxHeight: number;
}

// Kept clear between the popup and the edge of the visible map.
const MARGIN_PX = 8;

// Where the popup's box lies relative to the dot, for each anchor: -1 is before the dot on that
// axis (above or left of it), 0 centred on it, 1 after it.
const ANCHORS: [PopupAnchor, { x: -1 | 0 | 1; y: -1 | 0 | 1 }][] = [
  ['bottom', { x: 0, y: -1 }],
  ['top', { x: 0, y: 1 }],
  ['right', { x: -1, y: 0 }],
  ['left', { x: 1, y: 0 }],
  ['bottom-right', { x: -1, y: -1 }],
  ['bottom-left', { x: 1, y: -1 }],
  ['top-right', { x: -1, y: 1 }],
  ['top-left', { x: 1, y: 1 }],
];

/**
 * Where a popup of `size` goes around a dot at `point` (pixels in the map's container) so that
 * it stays wholly on the visible map: above it when there is room, then below, beside it, or in
 * a corner. When no position holds all of it, the one that loses least wins and `maxHeight`
 * says how tall the popup may be there (the popup scrolls inside that).
 */
export function placePopup({
  point: [x, y],
  size: [width, height],
  area,
  offset,
}: {
  point: [number, number];
  size: [number, number];
  area: PopupArea;
  offset: number;
}): Placement {
  const { top = 0, right = 0, bottom = 0, left = 0 } = area.padding ?? {};
  const visible = {
    left: left + MARGIN_PX,
    right: area.width - right - MARGIN_PX,
    top: top + MARGIN_PX,
    bottom: area.height - bottom - MARGIN_PX,
  };

  const options = ANCHORS.map(([anchor, { x: dx, y: dy }]) => {
    const boxLeft = dx === 0 ? x - width / 2 : dx < 0 ? x - offset - width : x + offset;
    // Up to where the popup may reach vertically, and the height that leaves it.
    const room =
      dy === 0
        ? 2 * Math.min(y - visible.top, visible.bottom - y)
        : dy < 0
          ? y - offset - visible.top
          : visible.bottom - (y + offset);
    const fitted = Math.min(height, Math.max(0, room));
    const sideways =
      Math.max(0, visible.left - boxLeft) + Math.max(0, boxLeft + width - visible.right);
    return { anchor, maxHeight: fitted, loss: sideways + (height - fitted) };
  });

  const best = options.reduce((a, b) => (b.loss < a.loss ? b : a));
  return { anchor: best.anchor, maxHeight: Math.floor(best.maxHeight) };
}
