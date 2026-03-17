import type { BaseEvent } from './event';
import type { Breadcrumb } from './error';
import type { UserInfo } from './user';

/**
 * EventBus 接口
 */
export interface EventBusInterface {
  on(eventName: string, handler: (...args: unknown[]) => void | Promise<void>, priority?: number): void;
  once(eventName: string, handler: (...args: unknown[]) => void | Promise<void>, priority?: number): void;
  off(eventName: string, handler: (...args: unknown[]) => void | Promise<void>): void;
  emit(eventName: string, data?: unknown): Promise<void>;
  clear(): void;
}

/**
 * 监控器公共接口 - 插件通过此接口与核心交互
 */
export interface MonitorInterface {
  /** 事件总线 */
  readonly eventBus: EventBusInterface;
  /** 上报事件 */
  captureEvent(event: Partial<BaseEvent>): void;
  /** 设置用户信息 */
  setUser(user: UserInfo): void;
  /** 添加面包屑 */
  addBreadcrumb(breadcrumb: Omit<Breadcrumb, 'timestamp'>): void;
  /** 获取当前会话 ID */
  getSessionId(): string;
  /** 获取 SDK 配置 */
  getConfig(): Record<string, unknown>;
  /** 销毁 */
  destroy(): void;
}
