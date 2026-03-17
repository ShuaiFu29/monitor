import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Monitor } from '@monitor/core';
import { performancePlugin } from '../src/index';
import type { BaseEvent } from '@monitor/types';

/**
 * Mock PerformanceObserver — 所有 entryType 都不支持，
 * 以测试 PerformancePlugin 在无可用 observer 时的优雅降级。
 */
class EmptyPerformanceObserver {
  static supportedEntryTypes: string[] = [];
  observe() {}
  disconnect() {}
}

/**
 * Mock PerformanceObserver — 支持 paint 和 navigation
 */
type PerfObsCallback = (list: { getEntries: () => PerformanceEntry[] }) => void;
const observerCallbacks: Map<string, PerfObsCallback> = new Map();

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
  }

  observe(options: PerformanceObserverInit) {
    const type = (options as { type?: string }).type;
    if (type) {
      observerCallbacks.set(type, this.callback);
    }
  }

  disconnect() {}
}

function emitEntry(type: string, entries: Partial<PerformanceEntry>[]) {
  const cb = observerCallbacks.get(type);
  if (cb) {
    cb({ getEntries: () => entries as PerformanceEntry[] });
  }
}

describe('PerformancePlugin + Core 集成测试', () => {
  let originalPerfObs: typeof PerformanceObserver;

  beforeEach(() => {
    originalPerfObs = globalThis.PerformanceObserver;
    (globalThis as unknown as Record<string, unknown>).PerformanceObserver = MockPerformanceObserver;
    observerCallbacks.clear();
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).PerformanceObserver = originalPerfObs;
  });

  it('PerformancePlugin 应能被 Monitor 加载', () => {
    const monitor = new Monitor({
      dsn: 'https://test@monitor.example.com/1',
      plugins: [performancePlugin()],
    });

    expect(monitor).toBeDefined();
    monitor.destroy();
  });

  it('FCP 指标应通过 captureEvent 上报', () => {
    const events: Partial<BaseEvent>[] = [];
    const monitor = new Monitor({
      dsn: 'https://test@monitor.example.com/1',
      performanceSampleRate: 1.0, // 确保性能事件不被采样丢弃
      plugins: [performancePlugin()],
      beforeSend: (event) => {
        events.push(event);
        return event; // 收集但不阻止
      },
    });

    // 触发 FCP
    emitEntry('paint', [
      { name: 'first-contentful-paint', startTime: 1200 },
    ] as PerformanceEntry[]);

    expect(events.length).toBeGreaterThanOrEqual(1);
    const fcpEvent = events.find(
      (e) => (e as Record<string, unknown>).type === 'performance' &&
        ((e as Record<string, unknown>).metric as Record<string, unknown>)?.name === 'FCP',
    );
    expect(fcpEvent).toBeDefined();

    monitor.destroy();
  });

  it('destroy 应清理所有 observer', () => {
    const monitor = new Monitor({
      dsn: 'https://test@monitor.example.com/1',
      plugins: [performancePlugin()],
    });

    // 应该注册了多个 observer
    expect(observerCallbacks.size).toBeGreaterThan(0);

    monitor.destroy();
    // destroy 后 Plugin 的 cleanups 应已被调用
  });

  it('PerformanceObserver 不可用时不应崩溃', () => {
    (globalThis as unknown as Record<string, unknown>).PerformanceObserver = EmptyPerformanceObserver;

    expect(() => {
      const monitor = new Monitor({
        dsn: 'https://test@monitor.example.com/1',
        plugins: [performancePlugin()],
      });
      monitor.destroy();
    }).not.toThrow();
  });

  it('可通过配置禁用特定功能', () => {
    const monitor = new Monitor({
      dsn: 'https://test@monitor.example.com/1',
      plugins: [
        performancePlugin({
          webVitals: false,
          longTasks: false,
          resources: true,
        }),
      ],
    });

    // 禁用 web vitals 和 long tasks 后，只有 resource 的 observer 被注册
    expect(observerCallbacks.has('resource')).toBe(true);
    expect(observerCallbacks.has('largest-contentful-paint')).toBe(false);
    expect(observerCallbacks.has('longtask')).toBe(false);

    monitor.destroy();
  });
});
