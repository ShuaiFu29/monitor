import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installFetchHook, extractFetchInfo } from '../src/fetch-hook';
import type { FetchRequestInfo } from '../src/fetch-hook';

describe('fetch-hook', () => {
  let originalFetch: typeof window.fetch;

  beforeEach(() => {
    originalFetch = window.fetch;
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  // ────── extractFetchInfo ──────
  describe('extractFetchInfo', () => {
    it('字符串 URL 应提取为 GET', () => {
      const { method, url } = extractFetchInfo('http://example.com/api');
      expect(method).toBe('GET');
      expect(url).toBe('http://example.com/api');
    });

    it('URL 对象应提取 href', () => {
      const { url } = extractFetchInfo(new URL('http://example.com/api'));
      expect(url).toBe('http://example.com/api');
    });

    it('Request 对象应提取 url 和 method', () => {
      const req = new Request('http://example.com/api', { method: 'POST' });
      const { method, url } = extractFetchInfo(req);
      expect(method).toBe('POST');
      expect(url).toBe('http://example.com/api');
    });

    it('init.method 应覆盖 Request.method', () => {
      const req = new Request('http://example.com/api', { method: 'GET' });
      const { method } = extractFetchInfo(req, { method: 'PUT' });
      expect(method).toBe('PUT');
    });
  });

  // ────── installFetchHook ──────
  describe('installFetchHook', () => {
    it('应替换 window.fetch', () => {
      const cb = vi.fn();
      const uninstall = installFetchHook(cb);
      expect(window.fetch).not.toBe(originalFetch);
      uninstall!();
    });

    it('卸载后应恢复原始 fetch', () => {
      const cb = vi.fn();
      const uninstall = installFetchHook(cb)!;
      uninstall();
      expect(window.fetch).toBe(originalFetch);
    });

    it('成功请求应回调正确信息', async () => {
      // Mock 原始 fetch
      const mockResponse = new Response('ok', { status: 200, headers: { 'content-length': '2' } });
      window.fetch = vi.fn().mockResolvedValue(mockResponse);
      const savedMockFetch = window.fetch;

      const cb = vi.fn();
      const uninstall = installFetchHook(cb)!;

      const response = await window.fetch('http://api.example.com/data');

      expect(response).toBe(mockResponse);
      expect(cb).toHaveBeenCalledTimes(1);

      const info: FetchRequestInfo = cb.mock.calls[0][0];
      expect(info.method).toBe('GET');
      expect(info.url).toBe('http://api.example.com/data');
      expect(info.status).toBe(200);
      expect(info.ok).toBe(true);
      expect(info.duration).toBeGreaterThanOrEqual(0);
      expect(info.responseSize).toBe(2);

      // 恢复
      window.fetch = savedMockFetch;
      uninstall();
    });

    it('失败请求应回调错误信息并重新抛出', async () => {
      const networkError = new TypeError('Failed to fetch');
      window.fetch = vi.fn().mockRejectedValue(networkError);
      const savedMockFetch = window.fetch;

      const cb = vi.fn();
      const uninstall = installFetchHook(cb)!;

      await expect(window.fetch('http://api.example.com/data')).rejects.toThrow('Failed to fetch');

      expect(cb).toHaveBeenCalledTimes(1);
      const info: FetchRequestInfo = cb.mock.calls[0][0];
      expect(info.status).toBe(0);
      expect(info.ok).toBe(false);
      expect(info.error).toBe('Failed to fetch');

      window.fetch = savedMockFetch;
      uninstall();
    });

    it('ignoreUrls 中的请求应被忽略', async () => {
      const mockResponse = new Response('ok', { status: 200 });
      window.fetch = vi.fn().mockResolvedValue(mockResponse);
      const savedMockFetch = window.fetch;

      const cb = vi.fn();
      const uninstall = installFetchHook(cb, {
        ignoreUrls: ['analytics', /\.monitor\./],
      })!;

      await window.fetch('http://analytics.example.com/track');
      await window.fetch('http://cdn.monitor.net/pixel');
      await window.fetch('http://api.example.com/data');

      // 只有最后一个应该被记录
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0].url).toContain('api.example.com');

      window.fetch = savedMockFetch;
      uninstall();
    });

    it('应注入追踪 headers', async () => {
      let capturedHeaders: Headers | undefined;
      window.fetch = vi.fn().mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = init?.headers as Headers;
        return Promise.resolve(new Response('ok', { status: 200 }));
      });
      const savedMockFetch = window.fetch;

      const cb = vi.fn();
      const uninstall = installFetchHook(cb, {
        injectHeaders: () => ({
          'X-Trace-Id': 'trace-123',
          'X-Span-Id': 'span-456',
        }),
      })!;

      await window.fetch('http://api.example.com/data');

      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders!.get('X-Trace-Id')).toBe('trace-123');
      expect(capturedHeaders!.get('X-Span-Id')).toBe('span-456');

      // traceHeaders 应出现在回调信息中
      const info: FetchRequestInfo = cb.mock.calls[0][0];
      expect(info.traceHeaders).toEqual({
        'X-Trace-Id': 'trace-123',
        'X-Span-Id': 'span-456',
      });

      window.fetch = savedMockFetch;
      uninstall();
    });

    it('POST 请求应正确记录 method', async () => {
      window.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 201 }));
      const savedMockFetch = window.fetch;

      const cb = vi.fn();
      const uninstall = installFetchHook(cb)!;

      await window.fetch('http://api.example.com/data', { method: 'POST' });

      expect(cb.mock.calls[0][0].method).toBe('POST');

      window.fetch = savedMockFetch;
      uninstall();
    });
  });
});
