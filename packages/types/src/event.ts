/**
 * 事件类型枚举
 */
export type EventType = 'error' | 'performance' | 'network' | 'replay' | 'behavior' | 'custom';

/**
 * 事件严重级别
 */
export type EventLevel = 'debug' | 'info' | 'warning' | 'error' | 'fatal';

/**
 * 基础事件 - 所有事件的公共字段
 */
export interface BaseEvent {
  /** 事件唯一 ID */
  id: string;
  /** 事件类型 */
  type: EventType;
  /** 事件时间戳 (ms) */
  timestamp: number;
  /** 会话 ID */
  sessionId: string;
  /** 用户 ID */
  userId?: string;
  /** 自定义上下文 */
  context?: Record<string, unknown>;
  /** 页面 URL */
  url?: string;
  /** 用户代理 */
  userAgent?: string;
}

/**
 * 自定义事件
 */
export interface CustomEvent extends BaseEvent {
  type: 'custom';
  /** 事件名称/消息 */
  message: string;
  /** 附加数据 */
  data?: Record<string, unknown>;
}

/**
 * 联合事件类型 - 由各个插件包扩展
 */
export type MonitorEvent = BaseEvent | CustomEvent;
