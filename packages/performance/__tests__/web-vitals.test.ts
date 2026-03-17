import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getRating,
  observeLCP,
  observeFID,
  observeINP,
  observeCLS,
  observeTTFB,
  observeFCP,
} from '../src/web-vitals';
import type { PerformanceMetric } from '@monitor/types';

/**
 * Mock PerformanceObserver 基础设施
 *
 * happy-dom 的 PerformanceObserver 不支持所有 entryType，
 * 我们需要自行模拟 observe / disconnect / entries / supportedEntryTypes。
 */

type PerfObsCallback = (list: { getEntries: () => PerformanceEntry[] }) => void;

let mockObserverCallback: PerfObsCallback | null = null;
let mockObserveOptions: PerformanceObserverInit | null = null;
let mockDisconnected = false;

class MockPerformanceObserver {
  static supportedEntryTypes = [
    'largest-contentful-paint',
    'first-input',
    'event',
    'layout-shift',
    'navigation',
    'paint',
    'longtask',
    'resource',
  ];

  private callback: PerfObsCallback;

  constructor(callback: PerfObsCallback) {
    this.callback = callback;
    mockObserverCallback = callback;
  }

  observe(options: PerformanceObserverInit) {
    mockObserveOptions = options;
    mockDisconnected = false;
  }

  disconnect() {
    mockDisconnected = true;
  }
}

function emitEntries(entries: Partial<PerformanceEntry>[]) {
  if (mockObserverCallback) {
    mockObserverCallback({
      getEntries: () => entries as PerformanceEntry[],
    });
  }
}

describe('web-vitals', () => {
  let originalPerfObs: typeof PerformanceObserver;

  beforeEach(() => {
    originalPerfObs = globalThis.PerformanceObserver;
    (globalThis as unknown as Record<string, unknown>).PerformanceObserver = MockPerformanceObserver;
    mockObserverCallback = null;
    mockObserveOptions = null;
    mockDisconnected = false;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).PerformanceObserver = originalPerfObs;
  });

  // ────── getRating ──────
  describe('getRating', () => {
    it('LCP good / needs-improvement / poor', () => {
      expect(getRating('LCP', 1000)).toBe('good');
      expect(getRating('LCP', 2500)).toBe('good');
      expect(getRating('LCP', 3000)).toBe('needs-improvement');
      expect(getRating('LCP', 4000)).toBe('needs-improvement');
      expect(getRating('LCP', 5000)).toBe('poor');
    });

    it('CLS good / needs-improvement / poor', () => {
      expect(getRating('CLS', 0.05)).toBe('good');
      expect(getRating('CLS', 0.1)).toBe('good');
      expect(getRating('CLS', 0.15)).toBe('needs-improvement');
      expect(getRating('CLS', 0.25)).toBe('needs-improvement');
      expect(getRating('CLS', 0.3)).toBe('poor');
    });

    it('FID good / needs-improvement / poor', () => {
      expect(getRating('FID', 50)).toBe('good');
      expect(getRating('FID', 100)).toBe('good');
      expect(getRating('FID', 200)).toBe('needs-improvement');
      expect(getRating('FID', 400)).toBe('poor');
    });

    it('unknown metric defaults to good', () => {
      expect(getRating('CUSTOM', 99999)).toBe('good');
    });
  });

  // ────── observeLCP ──────
  describe('observeLCP', () => {
    it('应通过 PerformanceObserver 观察 largest-contentful-paint', () => {
      const cb = vi.fn();
      const stop = observeLCP(cb);

      expect(stop).not.toBeNull();
      expect(mockObserveOptions?.type).toBe('largest-contentful-paint');
    });

    it('应在页面隐藏时报告最终 LCP 值', () => {
      const cb = vi.fn();
      observeLCP(cb);

      // 模拟 LCP entry
      emitEntries([{ startTime: 1200 }]);
      emitEntries([{ startTime: 2000 }]); // 更大的 paint

      // 模拟页面隐藏
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(cb).toHaveBeenCalledTimes(1);
      const metric: PerformanceMetric = cb.mock.calls[0][0];
      expect(metric.name).toBe('LCP');
      expect(metric.value).toBe(2000);
      expect(metric.rating).toBe('good');

      // 恢复
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });
    });

    it('stop 应 disconnect observer', () => {
      const cb = vi.fn();
      const stop = observeLCP(cb)!;

      emitEntries([{ startTime: 1000 }]);
      stop();

      expect(mockDisconnected).toBe(true);
    });
  });

  // ────── observeFID ──────
  describe('observeFID', () => {
    it('应观察 first-input', () => {
      const cb = vi.fn();
      observeFID(cb);
      expect(mockObserveOptions?.type).toBe('first-input');
    });

    it('应正确计算 FID 值', () => {
      const cb = vi.fn();
      observeFID(cb);

      emitEntries([{
        startTime: 1000,
        processingStart: 1050, // 50ms delay
      } as unknown as PerformanceEntry]);

      expect(cb).toHaveBeenCalledTimes(1);
      const metric: PerformanceMetric = cb.mock.calls[0][0];
      expect(metric.name).toBe('FID');
      expect(metric.value).toBe(50);
      expect(metric.rating).toBe('good');
    });

    it('只报告第一次输入', () => {
      const cb = vi.fn();
      observeFID(cb);

      emitEntries([{ startTime: 1000, processingStart: 1050 } as unknown as PerformanceEntry]);
      emitEntries([{ startTime: 2000, processingStart: 2100 } as unknown as PerformanceEntry]);

      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  // ────── observeINP ──────
  describe('observeINP', () => {
    it('应观察 event entryType', () => {
      const cb = vi.fn();
      observeINP(cb);
      expect(mockObserveOptions?.type).toBe('event');
    });

    it('应在页面隐藏时报告 INP（P98 交互延迟）', () => {
      const cb = vi.fn();
      observeINP(cb);

      // 模拟多个交互
      const interactions = [100, 150, 200, 50, 80, 300].map((duration, i) => ({
        duration,
        interactionId: i + 1,
      }));
      emitEntries(interactions as unknown as PerformanceEntry[]);

      // 模拟页面隐藏
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(cb).toHaveBeenCalledTimes(1);
      const metric: PerformanceMetric = cb.mock.calls[0][0];
      expect(metric.name).toBe('INP');
      // 6 个值排序: [50, 80, 100, 150, 200, 300]
      // P98 = ceil(6 * 0.98) - 1 = ceil(5.88) - 1 = 6 - 1 = 5 → index 5 → 300
      expect(metric.value).toBe(300);

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });
    });

    it('应忽略没有 interactionId 的事件', () => {
      const cb = vi.fn();
      observeINP(cb);

      emitEntries([
        { duration: 100, interactionId: 0 } as unknown as PerformanceEntry, // mousemove
        { duration: 200, interactionId: 1 } as unknown as PerformanceEntry, // click
      ]);

      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      const metric: PerformanceMetric = cb.mock.calls[0][0];
      expect(metric.value).toBe(200); // 只有 interactionId=1 被记录

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });
    });
  });

  // ────── observeCLS ──────
  describe('observeCLS', () => {
    it('应观察 layout-shift', () => {
      const cb = vi.fn();
      observeCLS(cb);
      expect(mockObserveOptions?.type).toBe('layout-shift');
    });

    it('应计算 session window 最大值', () => {
      const cb = vi.fn();
      observeCLS(cb);

      // Session window 1: value = 0.1 + 0.05 = 0.15
      emitEntries([
        { startTime: 1000, value: 0.1, hadRecentInput: false } as unknown as PerformanceEntry,
        { startTime: 1200, value: 0.05, hadRecentInput: false } as unknown as PerformanceEntry,
      ]);

      // Session window 2 (gap > 1s): value = 0.2
      emitEntries([
        { startTime: 3000, value: 0.2, hadRecentInput: false } as unknown as PerformanceEntry,
      ]);

      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(cb).toHaveBeenCalledTimes(1);
      const metric: PerformanceMetric = cb.mock.calls[0][0];
      expect(metric.name).toBe('CLS');
      expect(metric.value).toBe(0.2); // max of two windows

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });
    });

    it('应忽略 hadRecentInput=true 的条目', () => {
      const cb = vi.fn();
      observeCLS(cb);

      emitEntries([
        { startTime: 1000, value: 0.5, hadRecentInput: true } as unknown as PerformanceEntry,
        { startTime: 1100, value: 0.01, hadRecentInput: false } as unknown as PerformanceEntry,
      ]);

      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      const metric: PerformanceMetric = cb.mock.calls[0][0];
      expect(metric.value).toBe(0.01); // hadRecentInput=true 的 0.5 被跳过

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });
    });
  });

  // ────── observeTTFB ──────
  describe('observeTTFB', () => {
    it('应观察 navigation', () => {
      const cb = vi.fn();
      observeTTFB(cb);
      expect(mockObserveOptions?.type).toBe('navigation');
    });

    it('应计算 responseStart - requestStart', () => {
      const cb = vi.fn();
      observeTTFB(cb);

      emitEntries([{
        requestStart: 100,
        responseStart: 350,
      } as unknown as PerformanceEntry]);

      expect(cb).toHaveBeenCalledTimes(1);
      const metric: PerformanceMetric = cb.mock.calls[0][0];
      expect(metric.name).toBe('TTFB');
      expect(metric.value).toBe(250);
      expect(metric.rating).toBe('good');
    });

    it('应忽略负值（无效数据）', () => {
      const cb = vi.fn();
      observeTTFB(cb);

      emitEntries([{
        requestStart: 500,
        responseStart: 100,
      } as unknown as PerformanceEntry]);

      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ────── observeFCP ──────
  describe('observeFCP', () => {
    it('应观察 paint', () => {
      const cb = vi.fn();
      observeFCP(cb);
      expect(mockObserveOptions?.type).toBe('paint');
    });

    it('应只报告 first-contentful-paint', () => {
      const cb = vi.fn();
      observeFCP(cb);

      emitEntries([
        { name: 'first-paint', startTime: 500 },
        { name: 'first-contentful-paint', startTime: 800 },
      ] as PerformanceEntry[]);

      expect(cb).toHaveBeenCalledTimes(1);
      const metric: PerformanceMetric = cb.mock.calls[0][0];
      expect(metric.name).toBe('FCP');
      expect(metric.value).toBe(800);
      expect(metric.rating).toBe('good');
    });
  });

  // ────── 不支持 PerformanceObserver ──────
  describe('PerformanceObserver 不可用', () => {
    it('不支持时应返回 null', () => {
      const original = globalThis.PerformanceObserver;
      (globalThis as unknown as Record<string, unknown>).PerformanceObserver = undefined;

      expect(observeLCP(vi.fn())).toBeNull();
      expect(observeFID(vi.fn())).toBeNull();
      expect(observeINP(vi.fn())).toBeNull();
      expect(observeCLS(vi.fn())).toBeNull();
      expect(observeTTFB(vi.fn())).toBeNull();
      expect(observeFCP(vi.fn())).toBeNull();

      (globalThis as unknown as Record<string, unknown>).PerformanceObserver = original;
    });
  });
});
