import { logger } from '@monitor/utils';

/**
 * XMLHttpRequest 拦截器
 *
 * 通过 Monkey Patch XMLHttpRequest.prototype 的 open / send 方法实现拦截：
 * 1. 拦截 open() — 记录 method 和 url
 * 2. 拦截 send() — 记录开始时间和请求体大小
 * 3. 注入链路追踪 header（通过 setRequestHeader）
 * 4. 监听 loadend 事件 — 记录 status、duration、responseSize
 *
 * 自保护原则：
 * - 拦截代码出现任何异常，仍然执行原始 XHR
 * - 不改变原始的回调行为（onload/onerror/onabort/ontimeout）
 */

export interface XHRRequestInfo {
  method: string;
  url: string;
  status: number;
  duration: number;
  ok: boolean;
  requestSize?: number;
  responseSize?: number;
  error?: string;
  traceHeaders?: Record<string, string>;
}

export type XHRCallback = (info: XHRRequestInfo) => void;

export interface XHRHookConfig {
  /** 忽略的 URL 模式 */
  ignoreUrls?: (string | RegExp)[];
  /** 注入 header 的回调（用于链路追踪） */
  injectHeaders?: (url: string) => Record<string, string>;
}

const DEFAULT_CONFIG: XHRHookConfig = {
  ignoreUrls: [],
};

// 在 XHR 实例上存储元信息的 Symbol
const XHR_META = Symbol('__monitor_xhr_meta__');

interface XHRMeta {
  method: string;
  url: string;
  startTime: number;
  ignored: boolean;
  traceHeaders: Record<string, string>;
}

/**
 * 安装 XHR 拦截
 *
 * @param callback 每次请求完成时回调
 * @param config 配置选项
 * @returns 卸载拦截的函数
 */
export function installXHRHook(
  callback: XHRCallback,
  config: XHRHookConfig = {},
): (() => void) | null {
  if (typeof XMLHttpRequest === 'undefined') return null;

  const resolved = { ...DEFAULT_CONFIG, ...config };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  // ── Patch open() ──
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest & { [XHR_META]?: XHRMeta },
    method: string,
    url: string | URL,
    ...args: unknown[]
  ) {
    const urlString = typeof url === 'string' ? url : url.toString();

    this[XHR_META] = {
      method: method.toUpperCase(),
      url: urlString,
      startTime: 0,
      ignored: shouldIgnoreUrl(urlString, resolved.ignoreUrls || []),
      traceHeaders: {},
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalOpen as any).call(this, method, url, ...args);
  };

  // ── Patch send() ──
  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest & { [XHR_META]?: XHRMeta },
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const meta = this[XHR_META];

    if (!meta || meta.ignored) {
      return originalSend.call(this, body);
    }

    meta.startTime = performance.now();

    // 注入追踪 headers
    if (resolved.injectHeaders) {
      try {
        const headers = resolved.injectHeaders(meta.url);
        meta.traceHeaders = headers;
        for (const [key, value] of Object.entries(headers)) {
          originalSetRequestHeader.call(this, key, value);
        }
      } catch {
        // ignore header injection errors
      }
    }

    // 计算请求体大小
    const requestSize = getBodySize(body);

    // 监听请求完成（loadend 在所有场景都会触发：success/error/abort/timeout）
    this.addEventListener('loadend', () => {
      try {
        const duration = performance.now() - meta.startTime;
        const responseSize = getResponseSize(this);

        callback({
          method: meta.method,
          url: meta.url,
          status: this.status,
          duration,
          ok: this.status >= 200 && this.status < 300,
          requestSize,
          responseSize,
          error: this.status === 0 ? 'Network Error or Aborted' : undefined,
          traceHeaders: meta.traceHeaders,
        });
      } catch (error) {
        logger.error('[XHRHook] Callback error:', error as Error);
      }
    });

    return originalSend.call(this, body);
  };

  // 返回卸载函数
  return () => {
    XMLHttpRequest.prototype.open = originalOpen;
    XMLHttpRequest.prototype.send = originalSend;
  };
}

// ── 辅助函数 ──

/**
 * 估算请求体大小
 */
function getBodySize(body: Document | XMLHttpRequestBodyInit | null | undefined): number | undefined {
  if (!body) return 0;
  if (typeof body === 'string') return body.length;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (body instanceof FormData) return undefined; // 无法精确计算
  return undefined;
}

/**
 * 获取响应体大小
 */
function getResponseSize(xhr: XMLHttpRequest): number | undefined {
  try {
    // 尝试从 Content-Length header 获取
    const contentLength = xhr.getResponseHeader('content-length');
    if (contentLength) return parseInt(contentLength, 10);

    // 降级：从 responseText 长度估算
    if (xhr.responseType === '' || xhr.responseType === 'text') {
      return xhr.responseText?.length;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * 判断 URL 是否应被忽略
 */
function shouldIgnoreUrl(url: string, patterns: (string | RegExp)[]): boolean {
  return patterns.some((pattern) => {
    if (typeof pattern === 'string') {
      return url.includes(pattern);
    }
    return pattern.test(url);
  });
}
