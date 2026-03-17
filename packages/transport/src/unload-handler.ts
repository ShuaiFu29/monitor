import type { BaseEvent } from '@monitor/types';
import { logger } from '@monitor/utils';

import type { TransportEngine } from './transport';

/**
 * 页面卸载处理器
 *
 * 在页面隐藏或卸载时，确保缓冲区中的事件被可靠发送。
 *
 * 监听事件优先级：
 * 1. visibilitychange → hidden: 最可靠，现代浏览器推荐
 * 2. pagehide: iOS Safari 兼容
 * 3. beforeunload: 传统兼容，但不推荐依赖
 *
 * 发送方式：
 * - 优先使用 navigator.sendBeacon（异步、不阻塞）
 * - 降级到同步 XMLHttpRequest（可能被浏览器阻止）
 */
export class UnloadHandler {
  private engine: TransportEngine;
  private getBufferedEvents: () => BaseEvent[];
  private handlers: Array<{ event: string; handler: EventListener }> = [];
  private flushed: boolean = false;

  constructor(
    engine: TransportEngine,
    getBufferedEvents: () => BaseEvent[],
  ) {
    this.engine = engine;
    this.getBufferedEvents = getBufferedEvents;
  }

  /**
   * 安装卸载事件监听器
   */
  install(): void {
    // visibilitychange → hidden
    const visibilityHandler = (() => {
      if (document.visibilityState === 'hidden') {
        this.flush();
      }
    }) as EventListener;
    document.addEventListener('visibilitychange', visibilityHandler);
    this.handlers.push({ event: 'visibilitychange', handler: visibilityHandler });

    // pagehide (iOS Safari)
    const pagehideHandler = (() => {
      this.flush();
    }) as EventListener;
    window.addEventListener('pagehide', pagehideHandler);
    this.handlers.push({ event: 'pagehide', handler: pagehideHandler });

    // beforeunload (最后手段)
    const beforeunloadHandler = (() => {
      this.flush();
    }) as EventListener;
    window.addEventListener('beforeunload', beforeunloadHandler);
    this.handlers.push({ event: 'beforeunload', handler: beforeunloadHandler });

    logger.debug('[UnloadHandler] Installed unload listeners.');
  }

  /**
   * 紧急刷新：发送所有缓冲事件
   */
  flush(): void {
    if (this.flushed) return;
    this.flushed = true;

    try {
      const events = this.getBufferedEvents();
      if (events.length === 0) return;

      logger.debug(`[UnloadHandler] Flushing ${events.length} buffered events on page unload.`);
      this.engine.sendUrgent(events);
    } catch (error) {
      logger.error('[UnloadHandler] Flush failed:', error as Error);
    }

    // 重置 flushed 标志（页面可能从 bfcache 恢复）
    setTimeout(() => {
      this.flushed = false;
    }, 0);
  }

  /**
   * 卸载监听器
   */
  uninstall(): void {
    for (const { event, handler } of this.handlers) {
      if (event === 'visibilitychange') {
        document.removeEventListener(event, handler);
      } else {
        window.removeEventListener(event, handler);
      }
    }
    this.handlers = [];
    logger.debug('[UnloadHandler] Uninstalled unload listeners.');
  }
}
