import type { MonitorConfig } from '@monitor/types';
import { Monitor } from '@monitor/core';
import { logger } from '@monitor/utils';

/**
 * 浏览器环境检测
 */
function isBrowserEnvironment(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * 创建浏览器监控实例
 *
 * 这是用户使用 SDK 的主入口函数，负责：
 * 1. 浏览器环境检测
 * 2. 实例化 Monitor
 * 3. 注册页面卸载事件（确保数据上报）
 * 4. 注册页面可见性变化事件
 *
 * @example
 * ```ts
 * import { createMonitor } from '@monitor/browser';
 *
 * const monitor = createMonitor({
 *   dsn: 'https://xxx@monitor.example.com/1',
 *   plugins: [errorPlugin(), performancePlugin()],
 * });
 * ```
 */
export function createMonitor(config: MonitorConfig): Monitor {
  if (!isBrowserEnvironment()) {
    logger.warn('Monitor SDK requires a browser environment.');
  }

  const monitor = new Monitor(config);

  // 注册页面卸载事件 — 确保最后的事件能被上报
  registerUnloadHandlers(monitor);

  // 注册可见性变化事件
  registerVisibilityHandler(monitor);

  return monitor;
}

/**
 * 注册页面卸载处理器
 * 使用三重保险: beforeunload + pagehide + visibilitychange(hidden)
 */
function registerUnloadHandlers(monitor: Monitor): void {
  let flushed = false;

  const flushOnce = () => {
    if (flushed) return;
    flushed = true;
    monitor.flush();
  };

  // beforeunload - 传统方式
  window.addEventListener('beforeunload', flushOnce);

  // pagehide - 更可靠的移动端支持
  window.addEventListener('pagehide', flushOnce);

  // 在 monitor 销毁时移除监听器
  monitor.eventBus.on('monitor:destroy', () => {
    window.removeEventListener('beforeunload', flushOnce);
    window.removeEventListener('pagehide', flushOnce);
  });
}

/**
 * 注册页面可见性变化处理器
 * 页面切到后台时 flush 一次
 */
function registerVisibilityHandler(monitor: Monitor): void {
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      monitor.flush();
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);

  monitor.eventBus.on('monitor:destroy', () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  });
}
