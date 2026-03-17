import type { ResourceTiming } from '@monitor/types';

/**
 * 资源加载监控
 *
 * 使用 PerformanceObserver 的 "resource" entryType 监控
 * 页面中所有资源（脚本、样式、图片、字体等）的加载性能。
 *
 * 支持：
 * - 按资源类型过滤
 * - 慢资源阈值报警
 * - URL 忽略列表
 */

export interface ResourceConfig {
  /** 慢资源阈值 (ms)，超过此值才报告，默认 0（全部报告） */
  slowThreshold?: number;
  /** 最多缓存多少条资源记录，默认 200 */
  maxEntries?: number;
  /** 忽略的资源 URL 模式 */
  ignoreUrls?: (string | RegExp)[];
  /** 只关注特定的 initiatorType，默认全部 */
  includeTypes?: string[];
}

export type ResourceCallback = (entry: ResourceTiming) => void;

const DEFAULT_CONFIG: Required<ResourceConfig> = {
  slowThreshold: 0,
  maxEntries: 200,
  ignoreUrls: [],
  includeTypes: [],
};

/**
 * 启动资源加载监控
 *
 * @param callback 每检测到一个资源加载时回调
 * @param config 配置选项
 * @returns 停止观察的清理函数，如不支持则返回 null
 */
export function observeResources(
  callback: ResourceCallback,
  config: ResourceConfig = {},
): (() => void) | null {
  if (typeof PerformanceObserver === 'undefined') return null;

  const resolved: Required<ResourceConfig> = { ...DEFAULT_CONFIG, ...config };
  let entryCount = 0;

  try {
    const supportedTypes = PerformanceObserver.supportedEntryTypes;
    if (supportedTypes && !supportedTypes.includes('resource')) {
      return null;
    }

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const resourceEntry = entry as PerformanceResourceTiming;

        // 限制数量
        if (entryCount >= resolved.maxEntries) continue;

        // 按类型过滤
        if (
          resolved.includeTypes.length > 0 &&
          !resolved.includeTypes.includes(resourceEntry.initiatorType)
        ) {
          continue;
        }

        // 按 URL 忽略
        if (shouldIgnoreUrl(resourceEntry.name, resolved.ignoreUrls)) continue;

        // 慢资源阈值过滤
        if (resourceEntry.duration < resolved.slowThreshold) continue;

        entryCount++;

        callback({
          url: resourceEntry.name,
          initiatorType: resourceEntry.initiatorType,
          startTime: resourceEntry.startTime,
          duration: resourceEntry.duration,
          transferSize: resourceEntry.transferSize || 0,
          decodedBodySize: resourceEntry.decodedBodySize || 0,
        });
      }
    });

    observer.observe({ type: 'resource', buffered: true } as PerformanceObserverInit);

    return () => {
      observer.disconnect();
    };
  } catch {
    return null;
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
