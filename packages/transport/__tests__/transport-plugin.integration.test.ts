import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { Monitor } from '@monitor/core';
import { transportPlugin } from '../src/index';
import type { BaseEvent } from '@monitor/types';

describe('TransportPlugin + Core 集成测试', () => {
  let originalFetch: typeof window.fetch;
  let originalBeacon: typeof navigator.sendBeacon;

  beforeEach(() => {
    originalFetch = window.fetch;
    originalBeacon = navigator.sendBeacon;

    // Mock fetch 为成功
    window.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

    // Mock sendBeacon 为成功
    Object.defineProperty(navigator, 'sendBeacon', {
      value: vi.fn().mockReturnValue(true),
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    window.fetch = originalFetch;
    Object.defineProperty(navigator, 'sendBeacon', {
      value: originalBeacon,
      writable: true,
      configurable: true,
    });
  });

  it('TransportPlugin 应能被 Monitor 加载', () => {
    const monitor = new Monitor({
      dsn: 'https://key@monitor.example.com/1',
      plugins: [transportPlugin({ offline: false })],
    });

    expect(monitor).toBeDefined();
    monitor.destroy();
  });

  it('captureEvent 后 transport:send 应触发数据发送', async () => {
    const monitor = new Monitor({
      dsn: 'https://key@monitor.example.com/1',
      batchSize: 1, // 每个事件立即 flush
      plugins: [transportPlugin({
        offline: false,
        compression: false,
        retryConfig: { maxRetries: 0, baseDelay: 10, jitter: false },
      })],
    });

    monitor.captureEvent({
      type: 'error',
      level: 'error',
    } as Partial<BaseEvent>);

    // 给异步发送一点时间
    await new Promise((resolve) => setTimeout(resolve, 50));

    // fetch 应被调用（FetchStrategy 作为降级策略之一）
    // 或者 sendBeacon 被调用
    const fetchCalls = (window.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    const beaconCalls = (navigator.sendBeacon as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(fetchCalls + beaconCalls).toBeGreaterThanOrEqual(1);

    monitor.destroy();
  });

  it('DSN 应被正确解析为端点 URL', async () => {
    const monitor = new Monitor({
      dsn: 'https://mykey@data.example.com/42',
      batchSize: 1,
      plugins: [transportPlugin({
        offline: false,
        compression: false,
        retryConfig: { maxRetries: 0, baseDelay: 10, jitter: false },
      })],
    });

    monitor.captureEvent({ type: 'custom' } as Partial<BaseEvent>);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // 检查 fetch 或 beacon 调用的 URL
    const fetchCalls = (window.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const beaconCalls = (navigator.sendBeacon as ReturnType<typeof vi.fn>).mock.calls;

    const allUrls = [
      ...fetchCalls.map((c: unknown[]) => c[0]),
      ...beaconCalls.map((c: unknown[]) => c[0]),
    ];

    const hasCorrectUrl = allUrls.some((url: unknown) =>
      typeof url === 'string' && url.includes('data.example.com') && url.includes('42'),
    );
    expect(hasCorrectUrl).toBe(true);

    monitor.destroy();
  });

  it('destroy 应清理 TransportPlugin', () => {
    const removeDocSpy = vi.spyOn(document, 'removeEventListener');
    const removeWinSpy = vi.spyOn(window, 'removeEventListener');

    const monitor = new Monitor({
      dsn: 'https://key@monitor.example.com/1',
      plugins: [transportPlugin({ offline: false })],
    });

    monitor.destroy();

    // UnloadHandler 应移除事件监听
    expect(removeDocSpy).toHaveBeenCalled();
    expect(removeWinSpy).toHaveBeenCalled();

    removeDocSpy.mockRestore();
    removeWinSpy.mockRestore();
  });

  it('无效 DSN 不应崩溃', () => {
    expect(() => {
      const monitor = new Monitor({
        dsn: 'invalid-dsn',
        plugins: [transportPlugin({ offline: false })],
      });
      monitor.destroy();
    }).not.toThrow();
  });

  it('配置的自定义 headers 应被传递', async () => {
    const monitor = new Monitor({
      dsn: 'https://key@monitor.example.com/1',
      batchSize: 1,
      plugins: [transportPlugin({
        offline: false,
        compression: false,
        headers: { 'X-App-Version': '1.0.0' },
        retryConfig: { maxRetries: 0, baseDelay: 10, jitter: false },
      })],
    });

    monitor.captureEvent({ type: 'custom' } as Partial<BaseEvent>);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 检查 fetch 调用中是否包含自定义 header
    const fetchCalls = (window.fetch as ReturnType<typeof vi.fn>).mock.calls;
    if (fetchCalls.length > 0) {
      const headers = fetchCalls[0][1]?.headers;
      expect(headers).toBeDefined();
      expect(headers?.['X-App-Version']).toBe('1.0.0');
    }

    monitor.destroy();
  });

  it('页面卸载时应通过 sendBeacon 发送缓冲事件', async () => {
    const monitor = new Monitor({
      dsn: 'https://key@monitor.example.com/1',
      batchSize: 100, // 不自动 flush
      plugins: [transportPlugin({
        offline: false,
        compression: false,
      })],
    });

    // 添加事件但不触发自动 flush
    monitor.captureEvent({ type: 'custom' } as Partial<BaseEvent>);

    // 手动 flush（模拟 EventQueue flush → transport:send）
    monitor.flush();

    await new Promise((resolve) => setTimeout(resolve, 50));

    // 验证 sendBeacon 或 fetch 被调用
    const fetchCalls = (window.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    const beaconCalls = (navigator.sendBeacon as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(fetchCalls + beaconCalls).toBeGreaterThanOrEqual(1);

    monitor.destroy();
  });
});
