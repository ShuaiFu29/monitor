import type { BaseEvent } from '@monitor/types';
import { logger } from '@monitor/utils';

import { type SendStrategy, sendWithFallback, createDefaultStrategies } from './strategies';
import { RetryManager, type RetryConfig } from './retry';
import { compress, shouldCompress } from './compression';
import { OfflineStorage, type OfflineStorageConfig } from './offline-storage';

/**
 * 传输引擎配置
 */
export interface TransportEngineConfig {
  /** 上报端点 URL */
  endpoint: string;
  /** 是否启用压缩，默认 true */
  compression?: boolean;
  /** 压缩阈值 (bytes)，小于此值不压缩，默认 1024 */
  compressionThreshold?: number;
  /** 是否启用离线存储，默认 true */
  offline?: boolean;
  /** 离线存储配置 */
  offlineConfig?: OfflineStorageConfig;
  /** 重试配置 */
  retryConfig?: RetryConfig;
  /** 自定义请求 Headers */
  headers?: Record<string, string>;
  /** 自定义策略列表（覆盖默认的四级降级） */
  strategies?: SendStrategy[];
}

const DEFAULT_ENGINE_CONFIG = {
  compression: true,
  compressionThreshold: 1024,
  offline: true,
};

/**
 * 传输引擎
 *
 * 编排四级降级策略、指数退避重试、数据压缩、离线缓存，
 * 实现事件数据的可靠上报。
 *
 * 发送流程：
 * 1. 序列化事件为 JSON
 * 2. 如果启用压缩且数据大于阈值，进行 gzip 压缩
 * 3. 按策略优先级发送（Beacon → Fetch → XHR → Image）
 * 4. 如果失败，使用指数退避重试
 * 5. 如果所有重试失败且离线存储可用，保存到 IndexedDB
 */
export class TransportEngine {
  private endpoint: string;
  private compression: boolean;
  private compressionThreshold: number;
  private headers: Record<string, string>;
  private strategies: SendStrategy[];
  private retryManager: RetryManager;
  private offlineStorage: OfflineStorage | null;
  private sending: boolean = false;

  constructor(config: TransportEngineConfig) {
    this.endpoint = config.endpoint;
    this.compression = config.compression ?? DEFAULT_ENGINE_CONFIG.compression;
    this.compressionThreshold = config.compressionThreshold ?? DEFAULT_ENGINE_CONFIG.compressionThreshold;
    this.headers = config.headers || {};
    this.strategies = config.strategies || createDefaultStrategies();
    this.retryManager = new RetryManager(config.retryConfig);

    if (config.offline !== false) {
      this.offlineStorage = new OfflineStorage(config.offlineConfig);
    } else {
      this.offlineStorage = null;
    }
  }

  /**
   * 发送事件批次
   *
   * @returns 是否发送成功
   */
  async send(events: BaseEvent[]): Promise<boolean> {
    if (events.length === 0) return true;

    this.sending = true;

    try {
      // 1. 序列化
      const json = JSON.stringify(events);

      // 2. 压缩（可选）
      let data: string | Uint8Array = json;
      const sendHeaders = { ...this.headers };

      if (this.compression && shouldCompress(json, this.compressionThreshold)) {
        try {
          data = compress(json);
          sendHeaders['Content-Encoding'] = 'gzip';
          sendHeaders['Content-Type'] = 'application/octet-stream';
        } catch {
          // 压缩失败时回退到原始 JSON
          data = json;
          sendHeaders['Content-Type'] = 'application/json';
        }
      } else {
        sendHeaders['Content-Type'] = 'application/json';
      }

      // 3. 发送（带降级）+ 重试
      const result = await this.retryManager.execute(async () => {
        const sendResult = await sendWithFallback(
          this.strategies,
          this.endpoint,
          data,
          sendHeaders,
        );
        return sendResult.success;
      });

      if (result.success) {
        logger.debug(`[TransportEngine] Events sent successfully after ${result.attempts} attempt(s).`);
        return true;
      }

      // 4. 所有重试失败 → 写入离线存储
      if (this.offlineStorage) {
        logger.warn('[TransportEngine] All retries failed, storing events offline.');
        await this.offlineStorage.store(events);
      }

      return false;
    } catch (error) {
      logger.error('[TransportEngine] Unexpected error during send:', error as Error);
      // 异常情况也尝试写入离线存储
      if (this.offlineStorage) {
        await this.offlineStorage.store(events);
      }
      return false;
    } finally {
      this.sending = false;
    }
  }

  /**
   * 紧急发送（页面卸载场景）
   *
   * 跳过重试，直接用 Beacon 或同步 XHR 发送。
   */
  sendUrgent(events: BaseEvent[]): boolean {
    if (events.length === 0) return true;

    try {
      const json = JSON.stringify(events);
      const sendHeaders = {
        ...this.headers,
        'Content-Type': 'application/json',
      };

      // 优先尝试 Beacon（最可靠的卸载发送方式）
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([json], { type: 'application/json' });
        const success = navigator.sendBeacon(this.endpoint, blob);
        if (success) {
          logger.debug('[TransportEngine] Urgent send via Beacon succeeded.');
          return true;
        }
      }

      // 降级到同步 XHR
      if (typeof XMLHttpRequest !== 'undefined') {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', this.endpoint, false); // 同步
          for (const [key, value] of Object.entries(sendHeaders)) {
            xhr.setRequestHeader(key, value);
          }
          xhr.send(json);
          return xhr.status >= 200 && xhr.status < 300;
        } catch {
          // 同步 XHR 可能被浏览器阻止
        }
      }

      return false;
    } catch (error) {
      logger.error('[TransportEngine] Urgent send failed:', error as Error);
      return false;
    }
  }

  /**
   * 获取离线存储实例
   */
  getOfflineStorage(): OfflineStorage | null {
    return this.offlineStorage;
  }

  /**
   * 是否正在发送
   */
  isSending(): boolean {
    return this.sending;
  }

  /**
   * 销毁引擎
   */
  destroy(): void {
    if (this.offlineStorage) {
      this.offlineStorage.close();
    }
  }
}

/**
 * 解析 DSN 为端点 URL
 *
 * DSN 格式: https://{key}@{host}/{projectId}
 * 端点格式: https://{host}/api/v1/events/{projectId}
 */
export function parseDsn(dsn: string): { endpoint: string; key: string } | null {
  try {
    const url = new URL(dsn);
    const key = url.username;
    const host = url.host;
    const protocol = url.protocol;
    const projectId = url.pathname.replace(/^\//, '');

    if (!key || !host || !projectId) {
      logger.error('[TransportEngine] Invalid DSN format:', dsn);
      return null;
    }

    return {
      endpoint: `${protocol}//${host}/api/v1/events/${projectId}`,
      key,
    };
  } catch {
    logger.error('[TransportEngine] Failed to parse DSN:', dsn);
    return null;
  }
}
