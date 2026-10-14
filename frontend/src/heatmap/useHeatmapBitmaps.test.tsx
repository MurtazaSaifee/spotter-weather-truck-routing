import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { heatmapOfChicagoToDallas } from '../test/fixtures/heatmap';
import { HeatmapBuildContext } from './buildStatus';
import { useHeatmapBitmaps } from './useHeatmapBitmaps';

// jsdom has no Web Worker: this stands in for the one the hook starts.
class StubWorker extends EventTarget {
  static started: StubWorker[] = [];
  asked: Array<{ layer: string }> = [];
  terminated = false;
  constructor() {
    super();
    StubWorker.started.push(this);
  }
  postMessage(request: { layer: string }) {
    this.asked.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  say(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

const onFailed = vi.fn();
// The page's retry counter, which the wrapper reads on every render.
let attempt = 0;

function renderBitmaps() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <HeatmapBuildContext.Provider value={{ attempt, onFailed }}>
      {children}
    </HeatmapBuildContext.Provider>
  );
  return renderHook(() => useHeatmapBitmaps(heatmapOfChicagoToDallas, 'risk'), { wrapper });
}

beforeEach(() => {
  StubWorker.started = [];
  onFailed.mockClear();
  attempt = 0;
  vi.stubGlobal('Worker', StubWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the heatmap bitmaps', () => {
  it('asks the worker for the layer on show', () => {
    renderBitmaps();

    expect(StubWorker.started).toHaveLength(1);
    expect(StubWorker.started[0].asked.map(({ layer }) => layer)).toEqual(['risk']);
  });

  it.each([
    ['an error event', (worker: StubWorker) => worker.dispatchEvent(new Event('error'))],
    [
      'a message it cannot read',
      (worker: StubWorker) => worker.dispatchEvent(new Event('messageerror')),
    ],
    ['a failure message', (worker: StubWorker) => worker.say({ layer: 'risk', failed: true })],
  ])('tells the page when the worker fails with %s', (_name, fail) => {
    renderBitmaps();

    act(() => {
      fail(StubWorker.started[0]);
    });

    expect(onFailed).toHaveBeenCalledExactlyOnceWith(heatmapOfChicagoToDallas);
  });

  it('starts a new worker and asks again when the page retries', () => {
    const { rerender, unmount } = renderBitmaps();
    act(() => {
      StubWorker.started[0].dispatchEvent(new Event('error'));
    });

    attempt = 1;
    rerender();

    expect(StubWorker.started[0].terminated).toBe(true);
    expect(StubWorker.started).toHaveLength(2);
    expect(StubWorker.started[1].asked.map(({ layer }) => layer)).toEqual(['risk']);
    unmount();
    expect(StubWorker.started[1].terminated).toBe(true);
  });
});
