import type { Map as MapLibreMap } from 'maplibre-gl';

interface Point {
  x: number;
  y: number;
}

// MapLibre's own Ctrl-drag numbers, so that a Command-drag turns the map the same way.
const DEGREES_PER_PIXEL = 0.8;
// Far above or below the centre, a drag is measured as the angle it sweeps about the centre.
const SWEEP_DISTANCE_PX = 100;
// A click that wobbles a pixel or two is not a drag.
const CLICK_TOLERANCE_PX = 3;

/**
 * How many degrees to add to the bearing when the pointer moves from `from` to `to`, for a map
 * that turns about `center` (all three in the same coordinates). Near the centre's height it is
 * the sideways movement, flipped above the centre so the map follows the pointer; further away
 * it is the angle the pointer sweeps about the centre. It is MapLibre's Ctrl-drag arithmetic.
 */
export function bearingDelta(from: Point, to: Point, center: Point): number {
  if (Math.abs(center.y - from.y) > SWEEP_DISTANCE_PX) {
    // Only the sweep counts: the up and down part of the move is dropped.
    const a = { x: from.x - center.x, y: to.y - center.y };
    const b = { x: to.x - center.x, y: to.y - center.y };
    const cross = b.x * a.y - b.y * a.x;
    return (Math.atan2(cross, b.x * a.x + b.y * a.y) * 180) / Math.PI;
  }
  const delta = (to.x - from.x) * DEGREES_PER_PIXEL;
  return to.y < center.y ? -delta : delta;
}

/**
 * Lets a Command-drag (the Mac's Meta key) turn the map as a Ctrl-drag does. MapLibre leaves a
 * drag with Meta held to the pan handler, so while one is going the map's panning is switched off
 * and the bearing is set from the pointer instead. A plain drag still pans, and Ctrl-drag, right
 * drag and a two-finger twist stay MapLibre's. Returns a function that removes the listener.
 */
export function attachCommandRotate(map: MapLibreMap): () => void {
  const container = map.getCanvasContainer();
  let drag: { last: Point; moved: boolean; restorePan: boolean } | null = null;

  function onMove(event: MouseEvent) {
    if (!drag) return;
    // The button was let go where this page could not hear it (outside the window).
    if (event.buttons === 0) return end();
    event.preventDefault();
    const to = { x: event.clientX, y: event.clientY };
    if (!drag.moved && Math.hypot(to.x - drag.last.x, to.y - drag.last.y) < CLICK_TOLERANCE_PX) {
      return;
    }
    drag.moved = true;
    // The map container, not the canvas container, which is 0 px tall as its canvas is out of flow.
    const rect = map.getContainer().getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const delta = bearingDelta(drag.last, to, center);
    drag.last = to;
    // `originalEvent` marks this as the driver's own move, as it is for MapLibre's gestures.
    if (delta) map.jumpTo({ bearing: map.getBearing() + delta }, { originalEvent: event });
  }

  function end() {
    if (!drag) return;
    if (drag.restorePan) map.dragPan.enable();
    drag = null;
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', end, true);
    window.removeEventListener('blur', end);
  }

  function onDown(event: MouseEvent) {
    // Ctrl is MapLibre's own rotation, and it wins over Meta when both are held.
    if (drag || event.button !== 0 || !event.metaKey || event.ctrlKey) return;
    // This listener is in the capture phase, so it runs before MapLibre's own mousedown handler
    // and the pan handler is already off when that looks at this event.
    drag = {
      last: { x: event.clientX, y: event.clientY },
      moved: false,
      restorePan: map.dragPan.isEnabled(),
    };
    map.dragPan.disable();
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', end, true);
    window.addEventListener('blur', end);
  }

  container.addEventListener('mousedown', onDown, true);
  return () => {
    container.removeEventListener('mousedown', onDown, true);
    end();
  };
}
