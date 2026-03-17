import type { EventBusInterface } from '@monitor/types';
import { logger } from '@monitor/utils';

/**
 * 事件监听器
 */
interface EventListener {
  handler: (...args: unknown[]) => void | Promise<void>;
  priority: number;
  once: boolean;
}

/**
 * 事件总线 - SDK 内部的发布/订阅系统
 *
 * 特性：
 * - 支持优先级排序
 * - 支持 once 一次性订阅
 * - 异步 handler 异常隔离（一个 handler 失败不影响其他）
 * - emit 时复制监听器列表，避免迭代中修改
 */
export class EventBus implements EventBusInterface {
  private listeners: Map<string, EventListener[]> = new Map();

  /**
   * 订阅事件
   * @param eventName 事件名
   * @param handler 处理函数
   * @param priority 优先级（越大越先执行），默认 0
   */
  on(
    eventName: string,
    handler: (...args: unknown[]) => void | Promise<void>,
    priority: number = 0,
  ): void {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }

    const listeners = this.listeners.get(eventName)!;
    listeners.push({ handler, priority, once: false });
    // 按优先级降序排列
    listeners.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 一次性订阅
   */
  once(
    eventName: string,
    handler: (...args: unknown[]) => void | Promise<void>,
    priority: number = 0,
  ): void {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }

    const listeners = this.listeners.get(eventName)!;
    listeners.push({ handler, priority, once: true });
    listeners.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 取消订阅
   */
  off(eventName: string, handler: (...args: unknown[]) => void | Promise<void>): void {
    const listeners = this.listeners.get(eventName);
    if (!listeners) return;

    const index = listeners.findIndex((l) => l.handler === handler);
    if (index >= 0) {
      listeners.splice(index, 1);
    }

    // 如果没有监听器了，清理 Map entry
    if (listeners.length === 0) {
      this.listeners.delete(eventName);
    }
  }

  /**
   * 触发事件
   * 异步执行所有 handler，单个 handler 失败不影响其他
   */
  async emit(eventName: string, data?: unknown): Promise<void> {
    const listeners = this.listeners.get(eventName);
    if (!listeners || listeners.length === 0) return;

    // 复制列表，因为 handler 中可能会修改监听器列表
    const listenersCopy = [...listeners];

    for (const listener of listenersCopy) {
      try {
        await listener.handler(data);
      } catch (error) {
        logger.error(`Error in event handler for "${eventName}":`, error);
      }

      // once 类型的监听器触发后自动移除
      if (listener.once) {
        this.off(eventName, listener.handler);
      }
    }
  }

  /**
   * 获取指定事件的监听器数量
   */
  listenerCount(eventName: string): number {
    return this.listeners.get(eventName)?.length ?? 0;
  }

  /**
   * 获取所有已注册事件名
   */
  eventNames(): string[] {
    return Array.from(this.listeners.keys());
  }

  /**
   * 清空所有监听器
   */
  clear(): void {
    this.listeners.clear();
  }
}
