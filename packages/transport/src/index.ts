import type { Plugin, MonitorInterface, BaseEvent } from '@monitor/types';
import { logger } from '@monitor/utils';

import { TransportEngine, parseDsn } from './transport';
import { UnloadHandler } from './unload-handler';
import { RecoveryManager, type RecoveryConfig } from './recovery';
import type { RetryConfig } from './retry';
import type { OfflineStorageConfig } from './offline-storage';

// 重新导出子模块（供高级用户单独使用）
export {
  BeaconStrategy,
  FetchStrategy,
  XHRStrategy,
  ImageStrategy,
  createStrategy,
  createDefaultStrategies,
  sendWithFallback,
} from './strategies';
export type { SendStrategy } from './strategies';
export { RetryManager, calculateBackoffDelay } from './retry';
export type { RetryConfig } from './retry';
export { compress, decompress, shouldCompress, getCompressionRatio } from './compression';
export { OfflineStorage } from './offline-storage';
export type { OfflineStorageConfig, StoredRecord } from './offline-storage';
export { TransportEngine, parseDsn } from './transport';
export type { TransportEngineConfig } from './transport';
export { UnloadHandler } from './unload-handler';
export { RecoveryManager } from './recovery';
export type { RecoveryConfig } from './recovery';

/**
 * TransportPlugin 配置
 */
export interface TransportPluginConfig {
  /** 是否启用压缩，默认 true */
  compression?: boolean;
  /** 压缩阈值 (bytes)，默认 1024 */
  compressionThreshold?: number;
  /** 是否启用离线存储，默认 true */
  offline?: boolean;
  /** 离线存储配置 */
  offlineConfig?: OfflineStorageConfig;
  /** 重试配置 */
  retryConfig?: RetryConfig;
  /** 网络恢复配置 */
  recoveryConfig?: RecoveryConfig;
  /** 自定义请求 Headers */
  headers?: Record<string, string>;
  /** 是否监听页面卸载，默认 true */
  unloadFlush?: boolean;
}

/**
 * 传输插件
 *
 * 负责监控数据的可靠上报。作为 Monitor 的 Plugin，
 * 监听 `transport:send` 事件并通过 TransportEngine 发送数据。
 *
 * 功能集成：
 * - Beacon/Fetch/XHR/Image 四级降级发送
 * - 指数退避重试
 * - gzip 数据压缩
 * - IndexedDB 离线缓存
 * - 页面卸载时可靠发送
 * - 网络恢复后自动补报
 *
 * @example
 * ```ts
 * import { createMonitor } from '@monitor/browser';
 * import { transportPlugin } from '@monitor/transport';
 *
 * const monitor = createMonitor({
 *   dsn: 'https://key@monitor.example.com/1',
 *   plugins: [transportPlugin()],
 * });
 * ```
 */
class TransportPlugin implements Plugin {
  readonly name = 'transport';
  readonly version = '0.1.0';

  private config: TransportPluginConfig;
  private monitor: MonitorInterface | null = null;
  private engine: TransportEngine | null = null;
  private unloadHandler: UnloadHandler | null = null;
  private recoveryManager: RecoveryManager | null = null;
  private sendHandler: ((...args: unknown[]) => void) | null = null;
  private bufferedEvents: BaseEvent[] = [];

  constructor(config: TransportPluginConfig = {}) {
    this.config = config;
  }

  install(monitor: MonitorInterface): void {
    this.monitor = monitor;

    try {
      // 1. 解析 DSN 获取上报端点
      const monitorConfig = monitor.getConfig();
      const dsn = monitorConfig['dsn'] as string;

      if (!dsn) {
        logger.error('[TransportPlugin] No DSN configured, transport disabled.');
        return;
      }

      const parsed = parseDsn(dsn);
      if (!parsed) {
        logger.error('[TransportPlugin] Invalid DSN, transport disabled.');
        return;
      }

      // 2. 创建传输引擎
      this.engine = new TransportEngine({
        endpoint: parsed.endpoint,
        compression: this.config.compression,
        compressionThreshold: this.config.compressionThreshold,
        offline: this.config.offline,
        offlineConfig: this.config.offlineConfig,
        retryConfig: this.config.retryConfig,
        headers: {
          'X-Monitor-Key': parsed.key,
          ...this.config.headers,
        },
      });

      // 3. 监听 transport:send 事件
      this.sendHandler = ((...args: unknown[]) => {
        const events = args[0] as BaseEvent[];
        this.handleSend(events);
      });
      monitor.eventBus.on('transport:send', this.sendHandler);

      // 4. 设置页面卸载处理
      if (this.config.unloadFlush !== false) {
        this.unloadHandler = new UnloadHandler(
          this.engine,
          () => this.getBufferedEvents(),
        );
        this.unloadHandler.install();
      }

      // 5. 设置网络恢复补报
      const offlineStorage = this.engine.getOfflineStorage();
      if (offlineStorage && this.config.offline !== false) {
        this.recoveryManager = new RecoveryManager(
          this.engine,
          offlineStorage,
          this.config.recoveryConfig,
        );
        this.recoveryManager.install();
      }

      logger.info('[TransportPlugin] Installed successfully.', {
        endpoint: parsed.endpoint,
        compression: this.config.compression !== false,
        offline: this.config.offline !== false,
      });
    } catch (error) {
      logger.error('[TransportPlugin] Failed to install:', error as Error);
    }
  }

  uninstall(): void {
    // 卸载事件监听
    if (this.sendHandler && this.monitor) {
      this.monitor.eventBus.off('transport:send', this.sendHandler);
      this.sendHandler = null;
    }

    // 卸载页面卸载处理器
    if (this.unloadHandler) {
      this.unloadHandler.uninstall();
      this.unloadHandler = null;
    }

    // 卸载网络恢复管理器
    if (this.recoveryManager) {
      this.recoveryManager.uninstall();
      this.recoveryManager = null;
    }

    // 销毁传输引擎
    if (this.engine) {
      this.engine.destroy();
      this.engine = null;
    }

    this.monitor = null;
    this.bufferedEvents = [];
    logger.info('[TransportPlugin] Uninstalled.');
  }

  /**
   * 获取传输引擎（供高级用户使用）
   */
  getEngine(): TransportEngine | null {
    return this.engine;
  }

  /**
   * 获取恢复管理器（供高级用户使用）
   */
  getRecoveryManager(): RecoveryManager | null {
    return this.recoveryManager;
  }

  /**
   * 处理发送事件
   */
  private handleSend(events: BaseEvent[]): void {
    if (!this.engine) return;

    // 记录到缓冲区（供卸载处理器使用）
    this.bufferedEvents = events;

    // 异步发送
    void this.engine.send(events).then((success) => {
      if (success) {
        // 发送成功后清除缓冲
        this.bufferedEvents = [];
      }
    });
  }

  /**
   * 获取当前缓冲的事件（供 UnloadHandler 使用）
   */
  private getBufferedEvents(): BaseEvent[] {
    return this.bufferedEvents;
  }
}

/**
 * 创建传输插件
 */
export function transportPlugin(config?: TransportPluginConfig): Plugin {
  return new TransportPlugin(config);
}
