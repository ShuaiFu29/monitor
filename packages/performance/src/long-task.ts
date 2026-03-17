import type { LongTaskEntry } from '@monitor/types';

/**
 * 长任务检测器
 *
 * 使用 PerformanceObserver 的 "longtask" entryType 检测
 * 持续时间超过 50ms 的主线程任务。
 *
 * 可配置自定义阈值进一步过滤（默认 50ms，与浏览器定义一致）。
 */

export interface LongTaskConfig {
  /** 自定义长任务阈值（ms），默认 50 */
  threshold?: number;
  /** 最多缓存多少条长任务记录，默认 100 */
  maxEntries?: number;
}

export type LongTaskCallback = (entry: LongTaskEntry) => void;

const DEFAULT_CONFIG: Required<LongTaskConfig> = {
  threshold: 50,
  maxEntries: 100,
};

/**
 * 启动长任务监控
 *
 * @param callback 每检测到一个长任务时回调
 * @param config 配置选项
 * @returns 停止观察的清理函数，如不支持则返回 null
 */
export function observeLongTasks(
  callback: LongTaskCallback,
  config: LongTaskConfig = {},
): (() => void) | null {
  if (typeof PerformanceObserver === 'undefined') return null;

  const resolved: Required<LongTaskConfig> = { ...DEFAULT_CONFIG, ...config };
  let entryCount = 0;

  try {
    // 检查是否支持 longtask
    const supportedTypes = PerformanceObserver.supportedEntryTypes;
    if (supportedTypes && !supportedTypes.includes('longtask')) {
      return null;
    }

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // 应用自定义阈值过滤
        if (entry.duration < resolved.threshold) continue;

        // 限制最大缓存
        if (entryCount >= resolved.maxEntries) continue;
        entryCount++;

        const attribution = (entry as unknown as { attribution?: Array<{ name?: string }> })
          .attribution?.[0]?.name;

        callback({
          startTime: entry.startTime,
          duration: entry.duration,
          attribution: attribution || 'unknown',
        });
      }
    });

    observer.observe({ type: 'longtask', buffered: true } as PerformanceObserverInit);

    return () => {
      observer.disconnect();
    };
  } catch {
    return null;
  }
}
