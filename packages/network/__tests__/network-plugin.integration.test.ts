import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Monitor } from '@monitor/core';
import { networkPlugin } from '../src/index';
import type { BaseEvent } from '@monitor/types';

describe('NetworkPlugin + Core 集成测试', () => {
  let originalFetch: typeof window.fetch;
  let originalOpen: typeof XMLHttpRequest.prototype.open;
  let originalSend: typeof XMLHttpRequest.prototype.send;

  beforeEach(() => {
    originalFetch = window.fetch;
    originalOpen = XMLHttpRequest.prototype.open;
    originalSend = XMLHttpRequest.prototype.send;
  });

  afterEach(() => {
    window.fetch = originalFetch;
    XMLHttpRequest.prototype.open = originalOpen;
    XMLHttpRequest.prototype.send = originalSend;
  });

  it('NetworkPlugin 应能被 Monitor 加载', () => {
    const monitor = new Monitor({
      dsn: 'https://test@monitor.example.com/1',
      plugins: [networkPlugin()],
    });

    expect(monitor).toBeDefined();
    monitor.destroy();
  });

  it('Fetch 请求应通过 captureEvent 上报', async () => {
    // Mock fetch
    window.fetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-length': '2' } }),
    );

    const events: Partial<BaseEvent>[] = [];
    const monitor = new Monitor({
      dsn: 'https://test@monitor.example.com/1',
      plugins: [networkPlugin({ ignoreUrls: ['monitor.example.com'] })],
      beforeSend: (event: BaseEvent) => {
        events.push(event);
        return event; // 收集但不阻止
      },
    });

    await window.fetch('http://api.example.com/data');

    expect(events.length).toBeGreaterThanOrEqual(1);
    const networkEvent = events.find(
      (e) => (e as Record<string, unknown>).type === 'network',
    );
    expect(networkEvent).toBeDefined();
    expect((networkEvent as Record<string, unknown>).method).toBe('GET');
    expect((networkEvent as Record<string, unknown>).url).toContain('api.example.com');
    expect((networkEvent as Record<string, unknown>).initiator).toBe('fetch');

    monitor.destroy();
  });

  it('Fetch 请求应自动注入追踪 header', async () => {
    let capturedInit: RequestInit | undefined;
    window.fetch = vi.fn().mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(new Response('ok', { status: 200 }));
    });

    const monitor = new Monitor({
      dsn: 'https://test@monitor.example.com/1',
      plugins: [networkPlugin({
        ignoreUrls: ['monitor.example.com'],
        tracing: true,
      })],
    });

    await window.fetch('http://api.example.com/data');

    // 追踪 headers 应被注入
    expect(capturedInit).toBeDefined();
    const headers = capturedInit!.headers as Headers;
    expect(headers.get('X-Trace-Id')).toBeTruthy();
    expect(headers.get('traceparent')).toBeTruthy();

    monitor.destroy();
  });

  it('网络请求应生成面包屑', async () => {
    window.fetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200 }),
    );

    const breadcrumbs: unknown[] = [];
    const monitor = new Monitor({
      dsn: 'https://test@monitor.example.com/1',
      plugins: [networkPlugin({ ignoreUrls: ['monitor.example.com'] })],
    });

    // 监听面包屑事件
    monitor.eventBus.on('breadcrumb:add', (data: unknown) => {
      breadcrumbs.push(data);
    });

    await window.fetch('http://api.example.com/data');

    expect(breadcrumbs.length).toBeGreaterThanOrEqual(1);
    const bc = breadcrumbs[0] as Record<string, unknown>;
    expect(bc.category).toBe('http');
    expect((bc.message as string)).toContain('GET');
    expect((bc.message as string)).toContain('api.example.com');

    monitor.destroy();
  });

  it('destroy 应卸载 Fetch/XHR hook', () => {
    const monitor = new Monitor({
      dsn: 'https://test@monitor.example.com/1',
      plugins: [networkPlugin()],
    });

    // 安装后 fetch 被替换
    expect(window.fetch).not.toBe(originalFetch);

    monitor.destroy();

    // 卸载后 fetch 应恢复
    expect(window.fetch).toBe(originalFetch);
  });

  it('可通过配置禁用 XHR 拦截', () => {
    const monitor = new Monitor({
      dsn: 'https://test@monitor.example.com/1',
      plugins: [networkPlugin({ xhr: false })],
    });

    // XHR 不应被替换
    expect(XMLHttpRequest.prototype.open).toBe(originalOpen);
    expect(XMLHttpRequest.prototype.send).toBe(originalSend);

    // Fetch 应被替换
    expect(window.fetch).not.toBe(originalFetch);

    monitor.destroy();
  });

  it('可通过配置禁用链路追踪', async () => {
    let capturedInit: RequestInit | undefined;
    window.fetch = vi.fn().mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(new Response('ok', { status: 200 }));
    });

    const monitor = new Monitor({
      dsn: 'https://test@monitor.example.com/1',
      plugins: [networkPlugin({
        tracing: false,
        ignoreUrls: ['monitor.example.com'],
      })],
    });

    await window.fetch('http://api.example.com/data');

    // 不应注入追踪 headers（init 不应被修改）
    if (capturedInit?.headers) {
      const headers = new Headers(capturedInit.headers);
      expect(headers.get('X-Trace-Id')).toBeNull();
    }

    monitor.destroy();
  });
});
