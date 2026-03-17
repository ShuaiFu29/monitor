import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installXHRHook } from '../src/xhr-hook';
import type { XHRRequestInfo } from '../src/xhr-hook';

describe('xhr-hook', () => {
  let originalOpen: typeof XMLHttpRequest.prototype.open;
  let originalSend: typeof XMLHttpRequest.prototype.send;

  beforeEach(() => {
    originalOpen = XMLHttpRequest.prototype.open;
    originalSend = XMLHttpRequest.prototype.send;
  });

  afterEach(() => {
    XMLHttpRequest.prototype.open = originalOpen;
    XMLHttpRequest.prototype.send = originalSend;
  });

  it('应替换 XMLHttpRequest.prototype.open 和 send', () => {
    const cb = vi.fn();
    const uninstall = installXHRHook(cb)!;

    expect(XMLHttpRequest.prototype.open).not.toBe(originalOpen);
    expect(XMLHttpRequest.prototype.send).not.toBe(originalSend);

    uninstall();
  });

  it('卸载后应恢复原始 open 和 send', () => {
    const cb = vi.fn();
    const uninstall = installXHRHook(cb)!;
    uninstall();

    expect(XMLHttpRequest.prototype.open).toBe(originalOpen);
    expect(XMLHttpRequest.prototype.send).toBe(originalSend);
  });

  it('应记录 XHR 请求信息', async () => {
    const cb = vi.fn();
    const uninstall = installXHRHook(cb)!;

    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'http://api.example.com/data');

      xhr.addEventListener('loadend', () => {
        // 给回调一点时间执行
        setTimeout(() => {
          expect(cb).toHaveBeenCalledTimes(1);
          const info: XHRRequestInfo = cb.mock.calls[0][0];
          expect(info.method).toBe('GET');
          expect(info.url).toBe('http://api.example.com/data');
          expect(typeof info.duration).toBe('number');
          resolve();
        }, 10);
      });

      xhr.send();
    });

    uninstall();
  });

  it('ignoreUrls 中的请求应被忽略', async () => {
    const cb = vi.fn();
    const uninstall = installXHRHook(cb, {
      ignoreUrls: ['analytics'],
    })!;

    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'http://analytics.example.com/track');
      xhr.addEventListener('loadend', () => {
        setTimeout(() => {
          expect(cb).not.toHaveBeenCalled();
          resolve();
        }, 10);
      });
      xhr.send();
    });

    uninstall();
  });

  it('应注入追踪 headers', async () => {
    const setRequestHeaderSpy = vi.spyOn(XMLHttpRequest.prototype, 'setRequestHeader');

    const cb = vi.fn();
    const uninstall = installXHRHook(cb, {
      injectHeaders: () => ({
        'X-Trace-Id': 'trace-abc',
        'X-Span-Id': 'span-def',
      }),
    })!;

    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'http://api.example.com/data');
      xhr.addEventListener('loadend', () => {
        setTimeout(resolve, 10);
      });
      xhr.send();
    });

    // 检查 setRequestHeader 被调用过
    const traceCalls = setRequestHeaderSpy.mock.calls.filter(
      (call) => call[0] === 'X-Trace-Id' || call[0] === 'X-Span-Id',
    );
    expect(traceCalls.length).toBeGreaterThanOrEqual(2);

    setRequestHeaderSpy.mockRestore();
    uninstall();
  });

  it('POST 请求应正确记录 method 和 requestSize', async () => {
    const cb = vi.fn();
    const uninstall = installXHRHook(cb)!;

    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'http://api.example.com/data');
      xhr.addEventListener('loadend', () => {
        setTimeout(() => {
          const info: XHRRequestInfo = cb.mock.calls[0][0];
          expect(info.method).toBe('POST');
          expect(info.requestSize).toBe(13);
          resolve();
        }, 10);
      });
      xhr.send('{"key":"val"}');
    });

    uninstall();
  });
});
