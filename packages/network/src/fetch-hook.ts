import { logger } from '@monitor/utils';

/**
 * Fetch 拦截器
 *
 * 通过 Monkey Patch 全局 `window.fetch` 实现拦截：
 * 1. 记录请求开始时间、method、url
 * 2. 注入链路追踪 header（如有）
 * 3. 等待响应后记录 status、duration、responseSize
 * 4. 不改变原始行为（包括 abort、timeout、网络错误场景）
 *
 * 自保护原则：
 * - 拦截代码出现任何异常，仍然执行原始 fetch
 * - 不影响业务代码的 Promise 链
 */

export interface FetchRequestInfo {
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

export type FetchCallback = (info: FetchRequestInfo) => void;

export interface FetchHookConfig {
  /** 忽略的 URL 模式 */
  ignoreUrls?: (string | RegExp)[];
  /** 注入 header 的回调（用于链路追踪） */
  injectHeaders?: (url: string) => Record<string, string>;
}

const DEFAULT_CONFIG: FetchHookConfig = {
  ignoreUrls: [],
};

/**
 * 安装 Fetch 拦截
 *
 * @param callback 每次请求完成时回调
 * @param config 配置选项
 * @returns 卸载拦截的函数
 */
export function installFetchHook(
  callback: FetchCallback,
  config: FetchHookConfig = {},
): (() => void) | null {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return null;
  }

  const resolved = { ...DEFAULT_CONFIG, ...config };
  const originalFetch = window.fetch;

  const hookedFetch = function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const startTime = performance.now();
    const { method, url } = extractFetchInfo(input, init);

    // 检查是否需要忽略
    if (shouldIgnoreUrl(url, resolved.ignoreUrls || [])) {
      return originalFetch.call(window, input, init);
    }

    // 注入追踪 headers
    let traceHeaders: Record<string, string> = {};
    let patchedInit = init;

    if (resolved.injectHeaders) {
      try {
        traceHeaders = resolved.injectHeaders(url);
        if (Object.keys(traceHeaders).length > 0) {
          const headers = new Headers(init?.headers);
          for (const [key, value] of Object.entries(traceHeaders)) {
            headers.set(key, value);
          }
          patchedInit = { ...init, headers };
        }
      } catch {
        // ignore header injection errors
      }
    }

    // 执行原始 fetch
    return originalFetch.call(window, input, patchedInit).then(
      (response: Response) => {
        try {
          const duration = performance.now() - startTime;
          const contentLength = response.headers.get('content-length');

          callback({
            method,
            url,
            status: response.status,
            duration,
            ok: response.ok,
            responseSize: contentLength ? parseInt(contentLength, 10) : undefined,
            traceHeaders,
          });
        } catch (error) {
          logger.error('[FetchHook] Callback error:', error as Error);
        }
        return response;
      },
      (error: unknown) => {
        try {
          const duration = performance.now() - startTime;

          callback({
            method,
            url,
            status: 0,
            duration,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            traceHeaders,
          });
        } catch (callbackError) {
          logger.error('[FetchHook] Callback error:', callbackError as Error);
        }
        // 重新抛出原始错误，不破坏业务代码的 catch 链
        throw error;
      },
    );
  };

  window.fetch = hookedFetch;

  // 返回卸载函数
  return () => {
    // 只有当前 fetch 还是我们 patch 的才恢复
    if (window.fetch === hookedFetch) {
      window.fetch = originalFetch;
    }
  };
}

// ── 辅助函数 ──

/**
 * 从 fetch 参数中提取 method 和 url
 */
export function extractFetchInfo(
  input: RequestInfo | URL,
  init?: RequestInit,
): { method: string; url: string } {
  let method = 'GET';
  let url = '';

  if (typeof input === 'string') {
    url = input;
  } else if (input instanceof URL) {
    url = input.href;
  } else if (input instanceof Request) {
    url = input.url;
    method = input.method;
  }

  // init.method 优先级高于 Request.method
  if (init?.method) {
    method = init.method;
  }

  return { method: method.toUpperCase(), url };
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
