import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

export type SheetSnap = 'collapsed' | 'half' | 'full';

const SNAPS: readonly SheetSnap[] = ['collapsed', 'half', 'full'];

/** Height of the always-visible header (handle and summary), without the safe area. */
export const SHEET_HEADER_HEIGHT = 72;
/** Map left showing above the sheet when it is fully open. */
export const SHEET_TOP_GAP = 12;
/** The half snap shows this share of the screen. */
const HALF_SHARE = 0.5;
/** Pointer travel before a press becomes a drag, so a tap still taps. */
const DRAG_THRESHOLD_PX = 4;
/** How far ahead a fling carries the sheet, in ms of its release velocity. */
const FLING_MS = 200;

interface Metrics {
  /** Height of the sheet element (the screen less the top gap and the top safe area). */
  sheetHeight: number;
  /** Height of the screen area the sheet lives in. */
  rootHeight: number;
  /** The bottom safe area (home indicator) in px. */
  safeBottom: number;
}

/** How far down, in px, the sheet sits at each snap (0 is fully open). */
function sheetOffsets({ sheetHeight, rootHeight, safeBottom }: Metrics): Record<SheetSnap, number> {
  const collapsed = Math.max(0, sheetHeight - SHEET_HEADER_HEIGHT - safeBottom);
  const half = Math.min(collapsed, Math.max(0, sheetHeight - Math.round(rootHeight * HALF_SHARE)));
  return { collapsed, half, full: 0 };
}

/** The snap nearest to `offset`. */
function nearestSnap(offset: number, offsets: Record<SheetSnap, number>): SheetSnap {
  return SNAPS.reduce((best, snap) =>
    Math.abs(offsets[snap] - offset) < Math.abs(offsets[best] - offset) ? snap : best,
  );
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface DragState {
  pointerId: number;
  startY: number;
  startOffset: number;
  dragging: boolean;
  samples: { time: number; y: number }[];
}

/** The elements the sheet measures and moves; the caller attaches them. */
interface SheetElements {
  /** The screen area the sheet lives in. */
  root: RefObject<HTMLElement | null>;
  sheet: RefObject<HTMLElement | null>;
  /** A zero-width element as tall as the bottom safe area. */
  safeProbe: RefObject<HTMLElement | null>;
}

interface UseBottomSheet {
  snap: SheetSnap;
  setSnap: (snap: SheetSnap) => void;
  /** Px the sheet sits down from fully open, for the current snap. */
  offset: number;
  offsets: Record<SheetSnap, number>;
  /** Spread on the header button: a drag moves the sheet, a tap or the arrow keys step it. */
  headerProps: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
    onClick: () => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  };
}

/**
 * The state and gestures of a bottom sheet with three snap points. While a finger is down the
 * sheet follows it through a CSS variable written straight to the element (no React render per
 * pointer move); on release it settles on the snap nearest to where its velocity carries it.
 * `enabled` is false on desktop, where the same markup is a plain side panel.
 */
export function useBottomSheet(
  enabled: boolean,
  initial: SheetSnap,
  { root, sheet, safeProbe }: SheetElements,
): UseBottomSheet {
  const [snap, setSnap] = useState<SheetSnap>(initial);
  const [metrics, setMetrics] = useState<Metrics>({ sheetHeight: 0, rootHeight: 0, safeBottom: 0 });
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);

  useLayoutEffect(() => {
    const rootEl = root.current;
    const sheetEl = sheet.current;
    if (!rootEl || !sheetEl) return;
    const measure = () => {
      const next = {
        sheetHeight: sheetEl.offsetHeight,
        rootHeight: rootEl.clientHeight,
        safeBottom: safeProbe.current?.offsetHeight ?? 0,
      };
      setMetrics((previous) =>
        previous.sheetHeight === next.sheetHeight &&
        previous.rootHeight === next.rootHeight &&
        previous.safeBottom === next.safeBottom
          ? previous
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(rootEl);
    return () => observer.disconnect();
  }, [root, sheet, safeProbe]);

  const offsets = sheetOffsets(metrics);
  const offsetsRef = useRef(offsets);
  const snapRef = useRef(snap);
  useLayoutEffect(() => {
    offsetsRef.current = offsets;
    snapRef.current = snap;
  });

  const setVariable = (px: number) => {
    sheet.current?.style.setProperty('--sheet-y', `${px}px`);
  };

  const step = (direction: 1 | -1) => {
    setSnap((current) => SNAPS[clamp(SNAPS.indexOf(current) + direction, 0, 2)] ?? current);
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!enabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startOffset: offsetsRef.current[snapRef.current],
      dragging: false,
      samples: [{ time: event.timeStamp, y: event.clientY }],
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const travelled = event.clientY - state.startY;
    if (!state.dragging) {
      if (Math.abs(travelled) < DRAG_THRESHOLD_PX) return;
      state.dragging = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is gone already (or was never real): the drag still follows events.
      }
      sheet.current?.setAttribute('data-dragging', 'true');
    }
    state.samples.push({ time: event.timeStamp, y: event.clientY });
    if (state.samples.length > 6) state.samples.shift();
    setVariable(clamp(state.startOffset + travelled, 0, offsetsRef.current.collapsed));
  };

  const finishDrag = (event: PointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!state.dragging) return;
    // The click that follows a drag's pointer-up is not a tap.
    suppressClick.current = true;
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    sheet.current?.removeAttribute('data-dragging');

    const { startOffset, startY, samples } = state;
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (!first || !last) return;
    const velocity = last.time > first.time ? (last.y - first.y) / (last.time - first.time) : 0;
    const current = clamp(startOffset + (last.y - startY), 0, offsetsRef.current.collapsed);
    const target = nearestSnap(current + velocity * FLING_MS, offsetsRef.current);
    setVariable(offsetsRef.current[target]);
    setSnap(target);
  };

  const onClick = () => {
    if (suppressClick.current) return;
    // A tap opens the sheet a step; from full it returns to half.
    setSnap((current) => (current === 'collapsed' ? 'half' : current === 'half' ? 'full' : 'half'));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      step(1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      step(-1);
    }
  };

  return {
    snap,
    setSnap,
    offset: offsets[snap],
    offsets,
    headerProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
      onClick,
      onKeyDown,
    },
  };
}
