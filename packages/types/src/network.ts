import type { BaseEvent } from './event';

/**
 * 网络请求事件
 */
export interface NetworkEvent extends BaseEvent {
  type: 'network';
  /** 请求方法 */
  method: string;
  /** 请求 URL */
  url: string;
  /** 响应状态码 */
  status: number;
  /** 请求耗时 (ms) */
  duration: number;
  /** 请求体大小 */
  requestSize?: number;
  /** 响应体大小 */
  responseSize?: number;
  /** 链路追踪 ID */
  traceId?: string;
  /** Span ID */
  spanId?: string;
  /** 请求发起来源 */
  initiator: 'fetch' | 'xhr';
  /** 是否成功 */
  ok: boolean;
}
