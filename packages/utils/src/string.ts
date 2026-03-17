/**
 * 获取当前页面 URL
 */
export function getCurrentUrl(): string {
  try {
    return window.location.href;
  } catch {
    return '';
  }
}

/**
 * 获取 User Agent
 */
export function getUserAgent(): string {
  try {
    return navigator.userAgent;
  } catch {
    return '';
  }
}

/**
 * URL 脱敏 - 移除查询参数中的敏感字段
 */
export function sanitizeUrl(
  url: string,
  sensitiveKeys: string[] = ['token', 'password', 'secret', 'key', 'auth'],
): string {
  try {
    const urlObj = new URL(url);
    for (const key of sensitiveKeys) {
      if (urlObj.searchParams.has(key)) {
        urlObj.searchParams.set(key, '[REDACTED]');
      }
    }
    return urlObj.toString();
  } catch {
    return url;
  }
}

/**
 * 获取 URL 的路径部分（不含查询参数和 hash）
 */
export function getUrlPath(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname;
  } catch {
    return url;
  }
}

/**
 * 判断是否匹配忽略规则
 */
export function matchesIgnorePattern(
  value: string,
  patterns: Array<string | RegExp>,
): boolean {
  return patterns.some((pattern) => {
    if (typeof pattern === 'string') {
      return value.includes(pattern);
    }
    return pattern.test(value);
  });
}

/**
 * 获取当前时间戳 (ms)
 * 优先使用 performance.now() 以获取更高精度
 */
export function now(): number {
  return Date.now();
}

/**
 * 获取高精度相对时间
 */
export function highResNow(): number {
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now();
  }
  return Date.now();
}
