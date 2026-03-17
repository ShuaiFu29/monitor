import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { observeResources } from '../src/resource';
import type { ResourceTiming } from '@monitor/types';

/**
 * Mock PerformanceObserver for resource
 */
type PerfObsCallback = (list: { getEntries: () => PerformanceEntry[] }) => void;

let mockObserverCallback: PerfObsCallback | null = null;
let mockDisconnected = false;

class MockPerformanceObserver {
  static supportedEntryTypes = ['resource'];

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

function emitEntries(entries: Partial<PerformanceResourceTiming>[]) {
  if (mockObserverCallback) {
    mockObserverCallback({
      getEntries: () => entries as PerformanceEntry[],
    });
  }
}

describe('resource', () => {
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

  it('应报告资源加载信息', () => {
    const cb = vi.fn();
    observeResources(cb);

    emitEntries([{
      name: 'http://example.com/app.js',
      initiatorType: 'script',
      startTime: 100,
      duration: 200,
      transferSize: 5000,
      decodedBodySize: 15000,
    }]);

    expect(cb).toHaveBeenCalledTimes(1);
    const entry: ResourceTiming = cb.mock.calls[0][0];
    expect(entry.url).toBe('http://example.com/app.js');
    expect(entry.initiatorType).toBe('script');
    expect(entry.duration).toBe(200);
    expect(entry.transferSize).toBe(5000);
    expect(entry.decodedBodySize).toBe(15000);
  });

  it('应按慢资源阈值过滤', () => {
    const cb = vi.fn();
    observeResources(cb, { slowThreshold: 500 });

    emitEntries([
      { name: 'http://a.com/fast.css', initiatorType: 'link', startTime: 0, duration: 100, transferSize: 0, decodedBodySize: 0 },
      { name: 'http://a.com/slow.css', initiatorType: 'link', startTime: 0, duration: 800, transferSize: 0, decodedBodySize: 0 },
    ]);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].url).toContain('slow.css');
  });

  it('应按 includeTypes 过滤', () => {
    const cb = vi.fn();
    observeResources(cb, { includeTypes: ['script', 'link'] });

    emitEntries([
      { name: 'http://a.com/app.js', initiatorType: 'script', startTime: 0, duration: 100, transferSize: 0, decodedBodySize: 0 },
      { name: 'http://a.com/img.png', initiatorType: 'img', startTime: 0, duration: 100, transferSize: 0, decodedBodySize: 0 },
      { name: 'http://a.com/style.css', initiatorType: 'link', startTime: 0, duration: 100, transferSize: 0, decodedBodySize: 0 },
    ]);

    expect(cb).toHaveBeenCalledTimes(2); // script + link, img 被过滤
  });

  it('应按 ignoreUrls 过滤（字符串）', () => {
    const cb = vi.fn();
    observeResources(cb, { ignoreUrls: ['analytics'] });

    emitEntries([
      { name: 'http://a.com/app.js', initiatorType: 'script', startTime: 0, duration: 100, transferSize: 0, decodedBodySize: 0 },
      { name: 'http://analytics.com/pixel.gif', initiatorType: 'img', startTime: 0, duration: 100, transferSize: 0, decodedBodySize: 0 },
    ]);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].url).toContain('app.js');
  });

  it('应按 ignoreUrls 过滤（正则）', () => {
    const cb = vi.fn();
    observeResources(cb, { ignoreUrls: [/\.tracking\./] });

    emitEntries([
      { name: 'http://a.com/app.js', initiatorType: 'script', startTime: 0, duration: 100, transferSize: 0, decodedBodySize: 0 },
      { name: 'http://cdn.tracking.net/t.js', initiatorType: 'script', startTime: 0, duration: 100, transferSize: 0, decodedBodySize: 0 },
    ]);

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('应限制最大记录数', () => {
    const cb = vi.fn();
    observeResources(cb, { maxEntries: 2 });

    emitEntries([
      { name: 'http://a.com/1.js', initiatorType: 'script', startTime: 0, duration: 100, transferSize: 0, decodedBodySize: 0 },
      { name: 'http://a.com/2.js', initiatorType: 'script', startTime: 0, duration: 100, transferSize: 0, decodedBodySize: 0 },
      { name: 'http://a.com/3.js', initiatorType: 'script', startTime: 0, duration: 100, transferSize: 0, decodedBodySize: 0 },
    ]);

    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('不支持时应返回 null', () => {
    (globalThis as unknown as Record<string, unknown>).PerformanceObserver = undefined;
    expect(observeResources(vi.fn())).toBeNull();
  });

  it('stop 应 disconnect observer', () => {
    const cb = vi.fn();
    const stop = observeResources(cb)!;
    stop();
    expect(mockDisconnected).toBe(true);
  });
});
