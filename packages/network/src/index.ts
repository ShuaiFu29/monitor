import type { Plugin, MonitorInterface, BaseEvent } from '@monitor/types';
import { logger } from '@monitor/utils';

import { installFetchHook, type FetchRequestInfo, type FetchHookConfig } from './fetch-hook';
import { installXHRHook, type XHRRequestInfo, type XHRHookConfig } from './xhr-hook';
import { TraceContext, type TraceConfig } from './trace-context';

// 重新导出子模块
export { installFetchHook, extractFetchInfo } from './fetch-hook';
export type { FetchRequestInfo, FetchCallback, FetchHookConfig } from './fetch-hook';
export { installXHRHook } from './xhr-hook';
export type { XHRRequestInfo, XHRCallback, XHRHookConfig } from './xhr-hook';
export { TraceContext, generateTraceId, generateSpanId } from './trace-context';
export type { TraceConfig } from './trace-context';

/**
 * 网络监控插件配置
 */
export interface NetworkPluginConfig {
  /** 是否拦截 Fetch，默认 true */
  fetch?: boolean;
  /** 是否拦截 XHR，默认 true */
  xhr?: boolean;
  /** 是否启用链路追踪，默认 true */
  tracing?: boolean;
  /** 链路追踪配置 */
  traceConfig?: TraceConfig;
  /** 忽略的 URL 模式（对 Fetch 和 XHR 共用） */
  ignoreUrls?: (string | RegExp)[];
}

const DEFAULT_CONFIG: Required<NetworkPluginConfig> = {
  fetch: true,
  xhr: true,
  tracing: true,
  traceConfig: {},
  ignoreUrls: [],
};

/**
 * 网络监控插件
 *
 * 整合 Fetch 拦截、XHR 拦截和链路追踪，
 * 通过 Monitor.captureEvent 统一上报网络请求数据。
 *
 * 还会通过 EventBus 发出 `breadcrumb:add` 事件，
 * 使得 ErrorPlugin 的面包屑中自动出现网络请求记录。
 *
 * @example
 * ```ts
 * import { createMonitor } from '@monitor/browser';
 * import { networkPlugin } from '@monitor/network';
 *
 * const monitor = createMonitor({
 *   dsn: 'https://...',
 *   plugins: [networkPlugin({ ignoreUrls: ['/health'] })],
 * });
 * ```
 */
class NetworkPlugin implements Plugin {
  readonly name = 'network';
  readonly version = '0.1.0';

  private config: Required<NetworkPluginConfig>;
  private monitor: MonitorInterface | null = null;
  private traceContext: TraceContext | null = null;
  private cleanups: Array<() => void> = [];

  constructor(config: NetworkPluginConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  install(monitor: MonitorInterface): void {
    this.monitor = monitor;

    try {
      // 初始化链路追踪上下文
      if (this.config.tracing) {
        this.traceContext = new TraceContext(this.config.traceConfig);
      }

      const commonConfig = {
        ignoreUrls: this.config.ignoreUrls,
        injectHeaders: this.traceContext
          ? (url: string) => this.traceContext!.createHeaders(url)
          : undefined,
      };

      // 安装 Fetch 拦截
      if (this.config.fetch) {
        this.setupFetch(commonConfig);
      }

      // 安装 XHR 拦截
      if (this.config.xhr) {
        this.setupXHR(commonConfig);
      }
    } catch (error) {
      logger.error('[NetworkPlugin] Failed to install:', error as Error);
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
    this.traceContext = null;
  }

  /**
   * 获取链路追踪上下文（供外部访问）
   */
  getTraceContext(): TraceContext | null {
    return this.traceContext;
  }

  // ── 私有方法 ──

  private setupFetch(config: FetchHookConfig): void {
    const stop = installFetchHook((info: FetchRequestInfo) => {
      this.reportNetworkEvent(info, 'fetch');
    }, config);

    if (stop) this.cleanups.push(stop);
  }

  private setupXHR(config: XHRHookConfig): void {
    const stop = installXHRHook((info: XHRRequestInfo) => {
      this.reportNetworkEvent(info, 'xhr');
    }, config);

    if (stop) this.cleanups.push(stop);
  }

  private reportNetworkEvent(
    info: FetchRequestInfo | XHRRequestInfo,
    initiator: 'fetch' | 'xhr',
  ): void {
    if (!this.monitor) return;

    // 提取 traceId 和 spanId
    const traceId = info.traceHeaders?.['X-Trace-Id'];
    const spanId = info.traceHeaders?.['X-Span-Id'];

    // 上报网络事件
    this.monitor.captureEvent({
      type: 'network',
      method: info.method,
      url: info.url,
      status: info.status,
      duration: info.duration,
      ok: info.ok,
      requestSize: info.requestSize,
      responseSize: info.responseSize,
      initiator,
      traceId,
      spanId,
      level: info.ok ? 'info' : 'warning',
    } as Partial<BaseEvent>);

    // 同时添加面包屑，让 ErrorPlugin 能看到网络请求
    this.monitor.eventBus.emit('breadcrumb:add', {
      message: `${info.method} ${info.url} → ${info.status}`,
      category: 'http',
      level: info.ok ? 'info' : 'warning',
      timestamp: Date.now(),
      data: {
        method: info.method,
        url: info.url,
        status: info.status,
        duration: Math.round(info.duration),
      },
    });
  }
}

/**
 * 创建网络监控插件
 */
export function networkPlugin(config?: NetworkPluginConfig): Plugin {
  return new NetworkPlugin(config);
}
