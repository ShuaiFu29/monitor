import type { Plugin, MonitorInterface, PerformanceMetric, LongTaskEntry, ResourceTiming } from '@monitor/types';
import { logger } from '@monitor/utils';

import { observeLCP, observeFID, observeINP, observeCLS, observeTTFB, observeFCP, type MetricCallback } from './web-vitals';
import { observeLongTasks, type LongTaskConfig } from './long-task';
import { observeResources, type ResourceConfig } from './resource';

// 重新导出子模块（供高级用户单独使用）
export { observeLCP, observeFID, observeINP, observeCLS, observeTTFB, observeFCP, getRating } from './web-vitals';
export type { MetricCallback } from './web-vitals';
export { observeLongTasks } from './long-task';
export type { LongTaskConfig, LongTaskCallback } from './long-task';
export { observeResources } from './resource';
export type { ResourceConfig, ResourceCallback } from './resource';

/**
 * 性能监控插件配置
 */
export interface PerformancePluginConfig {
  /** 是否采集 Web Vitals，默认 true */
  webVitals?: boolean;
  /** 是否检测长任务，默认 true */
  longTasks?: boolean;
  /** 是否监控资源加载，默认 true */
  resources?: boolean;
  /** 长任务配置 */
  longTaskConfig?: LongTaskConfig;
  /** 资源监控配置 */
  resourceConfig?: ResourceConfig;
}

const DEFAULT_CONFIG: Required<PerformancePluginConfig> = {
  webVitals: true,
  longTasks: true,
  resources: true,
  longTaskConfig: {},
  resourceConfig: {},
};

/**
 * 性能监控插件
 *
 * 整合 Web Vitals、长任务检测、资源加载监控三个子模块，
 * 通过 Monitor.captureEvent 统一上报性能数据。
 *
 * @example
 * ```ts
 * import { createMonitor } from '@monitor/browser';
 * import { performancePlugin } from '@monitor/performance';
 *
 * const monitor = createMonitor({
 *   dsn: 'https://...',
 *   plugins: [performancePlugin()],
 * });
 * ```
 */
class PerformancePlugin implements Plugin {
  readonly name = 'performance';
  readonly version = '0.1.0';

  private config: Required<PerformancePluginConfig>;
  private monitor: MonitorInterface | null = null;
  private cleanups: Array<() => void> = [];

  constructor(config: PerformancePluginConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  install(monitor: MonitorInterface): void {
    this.monitor = monitor;

    try {
      if (this.config.webVitals) {
        this.setupWebVitals();
      }

      if (this.config.longTasks) {
        this.setupLongTasks();
      }

      if (this.config.resources) {
        this.setupResources();
      }
    } catch (error) {
      logger.error('[PerformancePlugin] Failed to install:', error as Error);
    }
  }

  uninstall(): void {
    for (const cleanup of this.cleanups) {
      try {
        cleanup();
      } catch {
        // ignore cleanup errors
      }
    }
    this.cleanups = [];
    this.monitor = null;
  }

  // ── 私有方法 ──

  private setupWebVitals(): void {
    const reportMetric: MetricCallback = (metric: PerformanceMetric) => {
      this.reportPerformanceEvent(metric, metric.value, 'ms');
    };

    const reportCLS: MetricCallback = (metric: PerformanceMetric) => {
      this.reportPerformanceEvent(metric, metric.value, 'score');
    };

    // 逐个注册 Web Vitals 观察器
    const lcpStop = observeLCP(reportMetric);
    if (lcpStop) this.cleanups.push(lcpStop);

    const fidStop = observeFID(reportMetric);
    if (fidStop) this.cleanups.push(fidStop);

    const inpStop = observeINP(reportMetric);
    if (inpStop) this.cleanups.push(inpStop);

    const clsStop = observeCLS(reportCLS);
    if (clsStop) this.cleanups.push(clsStop);

    const ttfbStop = observeTTFB(reportMetric);
    if (ttfbStop) this.cleanups.push(ttfbStop);

    const fcpStop = observeFCP(reportMetric);
    if (fcpStop) this.cleanups.push(fcpStop);
  }

  private setupLongTasks(): void {
    const stop = observeLongTasks((entry: LongTaskEntry) => {
      this.monitor?.captureEvent({
        type: 'performance',
        metric: {
          name: 'long-task',
          value: entry.duration,
        },
        value: entry.duration,
        unit: 'ms',
        level: 'warning',
      } as Partial<import('@monitor/types').BaseEvent>);
    }, this.config.longTaskConfig);

    if (stop) this.cleanups.push(stop);
  }

  private setupResources(): void {
    const stop = observeResources((entry: ResourceTiming) => {
      this.monitor?.captureEvent({
        type: 'performance',
        metric: {
          name: 'resource',
          value: entry.duration,
        },
        value: entry.duration,
        unit: 'ms',
      } as Partial<import('@monitor/types').BaseEvent>);
    }, this.config.resourceConfig);

    if (stop) this.cleanups.push(stop);
  }

  private reportPerformanceEvent(
    metric: PerformanceMetric,
    value: number,
    unit: string,
  ): void {
    if (!this.monitor) return;

    this.monitor.captureEvent({
      type: 'performance',
      metric,
      value,
      unit,
      level: 'info',
    } as Partial<import('@monitor/types').BaseEvent>);
  }
}

/**
 * 创建性能监控插件
 */
export function performancePlugin(config?: PerformancePluginConfig): Plugin {
  return new PerformancePlugin(config);
}
