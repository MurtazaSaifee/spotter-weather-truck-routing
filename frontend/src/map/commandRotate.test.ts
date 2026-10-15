import type { Map as MapLibreMap } from 'maplibre-gl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachCommandRotate, bearingDelta } from './commandRotate';

const center = { x: 400, y: 300 };

describe('the bearing a drag adds', () => {
  it('follows the sideways movement near the height of the centre', () => {
    // 0.8 degrees a pixel, as for MapLibre's Ctrl-drag. Below the centre the map turns with the
    // pointer, so moving right turns it anticlockwise: the bearing grows.
    expect(bearingDelta({ x: 400, y: 350 }, { x: 450, y: 350 }, center)).toBeCloseTo(40);
    expect(bearingDelta({ x: 450, y: 350 }, { x: 400, y: 350 }, center)).toBeCloseTo(-40);
  });

  it('turns the other way above the centre, so the map still follows the pointer', () => {
    expect(bearingDelta({ x: 400, y: 250 }, { x: 450, y: 250 }, center)).toBeCloseTo(-40);
  });

  it('ignores up and down movement near the centre', () => {
    expect(bearingDelta({ x: 400, y: 350 }, { x: 400, y: 380 }, center)).toBe(0);
  });

  it('is the angle swept about the centre when the pointer is far above or below it', () => {
    // A pointer 200 px above the centre moved right to 200 px beside it has swept an eighth of a
    // turn clockwise, which is the bearing falling by 45 degrees.
    expect(bearingDelta({ x: 400, y: 100 }, { x: 600, y: 100 }, center)).toBeCloseTo(-45);
    expect(bearingDelta({ x: 400, y: 500 }, { x: 600, y: 500 }, center)).toBeCloseTo(45);
  });

  it('does not count the up and down part of a move far from the centre', () => {
    expect(bearingDelta({ x: 400, y: 100 }, { x: 400, y: 20 }, center)).toBeCloseTo(0);
  });
});

// A map as far as the drag cares: its containers, the pan switch, and the camera. As in a browser,
// the canvas container (where the pointer lands) has no height, and the map container is the box.
function fakeMap() {
  const container = document.createElement('div');
  container.getBoundingClientRect = () => new DOMRect(0, 0, 800, 0);
  document.body.append(container);
  const mapContainer = document.createElement('div');
  mapContainer.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  let panning = true;
  let bearing = 0;
  const map = {
    getCanvasContainer: () => container,
    getContainer: () => mapContainer,
    getBearing: () => bearing,
    jumpTo: vi.fn<(options: { bearing: number }, eventData?: unknown) => void>((options) => {
      bearing = options.bearing;
    }),
    dragPan: {
      isEnabled: () => panning,
      enable: vi.fn(() => void (panning = true)),
      disable: vi.fn(() => void (panning = false)),
    },
  };
  return { container, map, panning: () => panning, bearing: () => bearing };
}

const mouse = (type: string, init: MouseEventInit) =>
  new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });

describe('a Command-drag', () => {
  let detach: (() => void) | undefined;
  afterEach(() => {
    detach?.();
    document.body.replaceChildren();
  });

  function start() {
    const fake = fakeMap();
    detach = attachCommandRotate(fake.map as unknown as MapLibreMap);
    return fake;
  }

  it('turns the map instead of panning it, and gives panning back when it ends', () => {
    const { container, map, panning, bearing } = start();

    container.dispatchEvent(mouse('mousedown', { metaKey: true, clientX: 400, clientY: 350 }));
    expect(panning()).toBe(false);

    window.dispatchEvent(mouse('mousemove', { buttons: 1, clientX: 450, clientY: 350 }));
    expect(bearing()).toBeCloseTo(40);
    // Marked as the driver's own move, which is what stops the framing from refitting.
    const eventData = map.jumpTo.mock.calls[0][1] as { originalEvent?: unknown };
    expect(eventData.originalEvent).toBeInstanceOf(MouseEvent);

    window.dispatchEvent(mouse('mouseup', { clientX: 450, clientY: 350 }));
    expect(panning()).toBe(true);
  });

  it('turns about the centre of the map, not of its zero-height canvas container', () => {
    const { container, bearing } = start();

    // 20 px above the map's centre (y 300): moving right turns the bearing down by 0.8 a pixel.
    // About the canvas container's centre (y 0) this would be a sweep, and the bearing would rise.
    container.dispatchEvent(mouse('mousedown', { metaKey: true, clientX: 400, clientY: 280 }));
    window.dispatchEvent(mouse('mousemove', { buttons: 1, clientX: 450, clientY: 280 }));

    expect(bearing()).toBeCloseTo(-40);
  });

  it('keeps turning after the pointer leaves the map', () => {
    const { container, bearing } = start();

    container.dispatchEvent(mouse('mousedown', { metaKey: true, clientX: 400, clientY: 350 }));
    window.dispatchEvent(mouse('mousemove', { buttons: 1, clientX: 900, clientY: 350 }));

    expect(bearing()).toBeCloseTo(400);
  });

  it('does not turn the map for a click that wobbles', () => {
    const { container, map } = start();

    container.dispatchEvent(mouse('mousedown', { metaKey: true, clientX: 400, clientY: 350 }));
    window.dispatchEvent(mouse('mousemove', { buttons: 1, clientX: 402, clientY: 350 }));

    expect(map.jumpTo).not.toHaveBeenCalled();
  });

  it('ends when the button was let go outside the window', () => {
    const { container, panning } = start();

    container.dispatchEvent(mouse('mousedown', { metaKey: true, clientX: 400, clientY: 350 }));
    window.dispatchEvent(mouse('mousemove', { buttons: 0, clientX: 450, clientY: 350 }));

    expect(panning()).toBe(true);
  });

  it('leaves a plain drag, a Ctrl-drag and a right-drag to MapLibre', () => {
    const { container, map } = start();

    for (const init of [{}, { ctrlKey: true }, { metaKey: true, ctrlKey: true }, { button: 2 }]) {
      container.dispatchEvent(mouse('mousedown', { clientX: 400, clientY: 350, ...init }));
    }

    expect(map.dragPan.disable).not.toHaveBeenCalled();
  });

  it('does not switch panning back on if it was off before the drag', () => {
    const { container, map } = start();
    map.dragPan.disable();

    container.dispatchEvent(mouse('mousedown', { metaKey: true, clientX: 400, clientY: 350 }));
    window.dispatchEvent(mouse('mouseup', {}));

    expect(map.dragPan.enable).not.toHaveBeenCalled();
  });
});
