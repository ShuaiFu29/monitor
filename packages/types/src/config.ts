import type { BaseEvent } from './event';
import type { Plugin } from './plugin';

/**
 * SDK 核心配置
 */
export interface MonitorConfig {
  /** 数据上报地址 (Data Source Name) */
  dsn: string;
  /** 应用版本号 */
  release?: string;
  /** 运行环境 */
  environment?: string;

  // ── 采样配置 ──
  /** 全局采样率 0-1 */
  sampleRate?: number;
  /** 错误事件采样率 0-1 */
  errorSampleRate?: number;
  /** 性能事件采样率 0-1 */
  performanceSampleRate?: number;

  // ── 用户信息 ──
  /** 用户 ID */
  userId?: string;
  /** 用户名 */
  userName?: string;
  /** 用户邮箱 */
  userEmail?: string;

  // ── 扩展 ──
  /** 自定义上下文 */
  context?: Record<string, unknown>;
  /** 插件列表 */
  plugins?: Plugin[];

  // ── 数据上报配置 ──
  /** 批量上报大小 */
  batchSize?: number;
  /** 批量上报间隔 (ms) */
  flushInterval?: number;
  /** 最大重试次数 */
  maxRetries?: number;

  // ── 钩子 ──
  /** 事件发送前拦截器，返回 null 则丢弃 */
  beforeSend?: (event: BaseEvent) => BaseEvent | null;
  /** SDK 内部错误回调 */
  onError?: (error: Error) => void;
}

/**
 * 已解析的配置（所有可选字段均有默认值）
 */
export interface ResolvedConfig {
  dsn: string;
  release: string;
  environment: string;
  sampleRate: number;
  errorSampleRate: number;
  performanceSampleRate: number;
  userId?: string;
  userName?: string;
  userEmail?: string;
  context: Record<string, unknown>;
  plugins: Plugin[];
  batchSize: number;
  flushInterval: number;
  maxRetries: number;
  beforeSend?: (event: BaseEvent) => BaseEvent | null;
  onError?: (error: Error) => void;
}
