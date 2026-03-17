import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { observeLongTasks } from '../src/long-task';
import type { LongTaskEntry } from '@monitor/types';

/**
 * Mock PerformanceObserver for longtask
 */
type PerfObsCallback = (list: { getEntries: () => PerformanceEntry[] }) => void;

let mockObserverCallback: PerfObsCallback | null = null;
let mockDisconnected = false;

class MockPerformanceObserver {
  static supportedEntryTypes = ['longtask'];

  private callback: PerfObsCallback;

  constructor(callback: PerfObsCallback) {
    this.callback = callback;
    mockObserverCallback = callback;
  }

  observe() {
    mockDisconnected = false;
  }

  disconnect() {
    mockDisconnected = true;
  }
}

function emitEntries(entries: Partial<PerformanceEntry & { attribution?: Array<{ name: string }> }>[]) {
  if (mockObserverCallback) {
    mockObserverCallback({
      getEntries: () => entries as PerformanceEntry[],
    });
  }
}

describe('long-task', () => {
  let originalPerfObs: typeof PerformanceObserver;

  beforeEach(() => {
    originalPerfObs = globalThis.PerformanceObserver;
    (globalThis as unknown as Record<string, unknown>).PerformanceObserver = MockPerformanceObserver;
    mockObserverCallback = null;
    mockDisconnected = false;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).PerformanceObserver = originalPerfObs;
  });

  it('应检测超过 50ms 的长任务', () => {
    const cb = vi.fn();
    observeLongTasks(cb);

    emitEntries([
      { startTime: 1000, duration: 80 },
    ]);

    expect(cb).toHaveBeenCalledTimes(1);
    const entry: LongTaskEntry = cb.mock.calls[0][0];
    expect(entry.startTime).toBe(1000);
    expect(entry.duration).toBe(80);
  });

  it('应忽略低于阈值的任务', () => {
    const cb = vi.fn();
    observeLongTasks(cb, { threshold: 100 });

    emitEntries([
      { startTime: 1000, duration: 80 }, // < 100ms
      { startTime: 2000, duration: 150 }, // > 100ms
    ]);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].duration).toBe(150);
  });

  it('应限制最大记录数', () => {
    const cb = vi.fn();
    observeLongTasks(cb, { maxEntries: 2 });

    emitEntries([
      { startTime: 1000, duration: 60 },
      { startTime: 2000, duration: 70 },
      { startTime: 3000, duration: 80 }, // 被丢弃
    ]);

    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('应提取 attribution 信息', () => {
    const cb = vi.fn();
    observeLongTasks(cb);

    emitEntries([
      { startTime: 1000, duration: 60, attribution: [{ name: 'script' }] },
    ]);

    expect(cb.mock.calls[0][0].attribution).toBe('script');
  });

  it('attribution 缺失时应为 unknown', () => {
    const cb = vi.fn();
    observeLongTasks(cb);

    emitEntries([
      { startTime: 1000, duration: 60 },
    ]);

    expect(cb.mock.calls[0][0].attribution).toBe('unknown');
  });

  it('不支持时应返回 null', () => {
    (globalThis as unknown as Record<string, unknown>).PerformanceObserver = undefined;
    expect(observeLongTasks(vi.fn())).toBeNull();
  });

  it('stop 应 disconnect observer', () => {
    const cb = vi.fn();
    const stop = observeLongTasks(cb)!;
    stop();
    expect(mockDisconnected).toBe(true);
  });

  it('不支持 longtask entryType 时返回 null', () => {
    class NoLongtaskObserver {
      static supportedEntryTypes = ['resource'];
      observe() {}
      disconnect() {}
    }
    (globalThis as unknown as Record<string, unknown>).PerformanceObserver = NoLongtaskObserver;

    expect(observeLongTasks(vi.fn())).toBeNull();
  });
});
