import type { BaseEvent } from './event';

/**
 * 上报策略类型
 */
export type TransportStrategy = 'beacon' | 'fetch' | 'xhr' | 'image';

/**
 * 上报结果
 */
export interface TransportResult {
  /** 是否成功 */
  success: boolean;
  /** 使用的策略 */
  strategy: TransportStrategy;
  /** 错误信息 */
  error?: string;
}

/**
 * 上报配置
 */
export interface TransportConfig {
  /** 上报地址 */
  dsn: string;
  /** 批量大小 */
  batchSize: number;
  /** 刷新间隔 (ms) */
  flushInterval: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 是否启用压缩 */
  compression: boolean;
  /** 忽略的 URL 列表 */
  ignoreUrls?: string[];
}

/**
 * 离线存储的事件
 */
export interface StoredEvent {
  /** 存储 ID */
  id: string;
  /** 事件数据 */
  event: BaseEvent;
  /** 存储时间 */
  storedAt: number;
  /** 重试次数 */
  retryCount: number;
  /** 是否已发送 */
  sent: boolean;
}
