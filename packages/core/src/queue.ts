import type { BaseEvent } from '@monitor/types';
import { logger } from '@monitor/utils';

/**
 * 事件队列 - 内存缓冲
 *
 * 职责：
 * - 缓冲事件，达到阈值或定时器触发时批量刷新
 * - 提供 flush 回调给 Transport 层
 * - 页面卸载时立即 flush
 *
 * 特性：
 * - 最大容量限制，防止内存溢出
 * - 支持优先级（error 事件立即 flush）
 */
export class EventQueue {
  private queue: BaseEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly batchSize: number;
  private readonly flushInterval: number;
  private readonly maxQueueSize: number;
  private onFlush: ((events: BaseEvent[]) => void) | null = null;

  constructor(options: {
    batchSize?: number;
    flushInterval?: number;
    maxQueueSize?: number;
  } = {}) {
    this.batchSize = options.batchSize ?? 10;
    this.flushInterval = options.flushInterval ?? 5000;
    this.maxQueueSize = options.maxQueueSize ?? 100;
  }

  /**
   * 设置 flush 回调
   */
  setFlushHandler(handler: (events: BaseEvent[]) => void): void {
    this.onFlush = handler;
  }

  /**
   * 启动定时刷新
   */
  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }

  /**
   * 停止定时刷新
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 添加事件到队列
   * 队列满时自动 flush
   */
  enqueue(event: BaseEvent): void {
    if (!event) {
      logger.warn('[EventQueue] Attempted to enqueue null/undefined event, ignored.');
      return;
    }

    this.queue.push(event);

    // 达到批量大小时立即 flush
    if (this.queue.length >= this.batchSize) {
      this.flush();
      return;
    }

    // 队列溢出保护
    if (this.queue.length >= this.maxQueueSize) {
      logger.warn(`[EventQueue] Queue size (${this.queue.length}) reached max limit (${this.maxQueueSize}), forcing flush.`);
      this.flush();
    }
  }

  /**
   * 立即刷新队列中的所有事件
   *
   * 如果 flush 回调抛出异常，会将事件恢复到队列头部，防止数据丢失。
   */
  flush(): void {
    if (this.queue.length === 0) return;

    const events = [...this.queue];
    this.queue = [];

    if (this.onFlush) {
      try {
        this.onFlush(events);
      } catch (error) {
        logger.error('[EventQueue] Flush handler threw error, restoring events to queue:', error as Error);
        // 恢复到队列头部，防止数据丢失
        this.queue.unshift(...events);
      }
    }
  }

  /**
   * 获取当前队列长度
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * 清空队列（不触发 flush）
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * 销毁队列
   * 先 flush 剩余事件，再停止定时器
   */
  destroy(): void {
    this.stop();
    this.flush();
    this.onFlush = null;
  }
}
