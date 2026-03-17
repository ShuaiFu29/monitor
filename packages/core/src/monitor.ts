import type {
  BaseEvent,
  Breadcrumb,
  MonitorConfig,
  MonitorInterface,
  UserInfo,
} from '@monitor/types';
import { generateId, logger, now } from '@monitor/utils';

import { EventBus } from './event-bus';
import { PluginManager } from './plugin';
import { ConfigManager } from './config';
import { SessionManager } from './context';
import { EventQueue } from './queue';

/**
 * Monitor - SDK 核心主类
 *
 * 整合 EventBus + PluginManager + ConfigManager + SessionManager + EventQueue，
 * 实现 MonitorInterface 接口，作为插件与外部代码交互的统一入口。
 *
 * 生命周期：
 * 1. 构造 → 初始化各子系统
 * 2. 安装插件
 * 3. 启动事件队列
 * 4. 运行中 → 接收/处理/上报事件
 * 5. destroy → 反向销毁各子系统
 */
export class Monitor implements MonitorInterface {
  readonly eventBus: EventBus;

  private readonly configManager: ConfigManager;
  private readonly pluginManager: PluginManager;
  private readonly sessionManager: SessionManager;
  private readonly eventQueue: EventQueue;
  private destroyed: boolean = false;

  constructor(config: MonitorConfig) {
    // 1. 初始化配置
    this.configManager = new ConfigManager(config);

    // 2. 初始化事件总线
    this.eventBus = new EventBus();

    // 3. 初始化会话
    this.sessionManager = new SessionManager();

    // 设置用户信息（如果在配置中提供了）
    if (config.userId || config.userName || config.userEmail) {
      this.sessionManager.setUser({
        id: config.userId,
        username: config.userName,
        email: config.userEmail,
      });
    }

    // 4. 初始化插件管理器
    this.pluginManager = new PluginManager(this);

    // 5. 初始化事件队列
    const resolvedConfig = this.configManager.getConfig();
    this.eventQueue = new EventQueue({
      batchSize: resolvedConfig.batchSize,
      flushInterval: resolvedConfig.flushInterval,
    });

    // 设置队列 flush 回调 → 通过 EventBus 通知 Transport 层
    this.eventQueue.setFlushHandler((events) => {
      this.eventBus.emit('transport:send', events);
    });

    // 6. 安装配置中的插件
    if (resolvedConfig.plugins.length > 0) {
      this.pluginManager.installAll(resolvedConfig.plugins);
    }

    // 7. 启动事件队列
    this.eventQueue.start();

    // 8. 通知初始化完成
    this.eventBus.emit('monitor:init', {
      sessionId: this.sessionManager.getSessionId(),
      config: resolvedConfig,
    });

    logger.info('Monitor initialized.', {
      sessionId: this.sessionManager.getSessionId(),
      plugins: this.pluginManager.getPluginNames(),
    });
  }

  /**
   * 上报事件
   *
   * 流程：
   * 1. 填充公共字段（id, timestamp, sessionId 等）
   * 2. 采样判断
   * 3. beforeSend 钩子
   * 4. 放入事件队列
   */
  captureEvent(event: Partial<BaseEvent>): void {
    if (this.destroyed) return;

    try {
      // 填充公共字段
      const enrichedEvent: BaseEvent = {
        id: generateId(),
        type: event.type || 'custom',
        timestamp: now(),
        sessionId: this.sessionManager.getSessionId(),
        userId: this.sessionManager.getUserId(),
        ...this.sessionManager.getEventContext(),
        ...event,
      } as BaseEvent;

      // 采样判断
      if (!this.shouldSample(enrichedEvent)) {
        return;
      }

      // beforeSend 钩子
      const config = this.configManager.getConfig();
      if (config.beforeSend) {
        const processed = config.beforeSend(enrichedEvent);
        if (processed === null) {
          logger.debug('Event dropped by beforeSend hook.');
          return;
        }
      }

      // 通知事件总线（允许插件监听和处理）
      this.eventBus.emit('event:captured', enrichedEvent);

      // 放入事件队列
      this.eventQueue.enqueue(enrichedEvent);
    } catch (error) {
      this.handleInternalError(error as Error);
    }
  }

  /**
   * 设置用户信息
   */
  setUser(user: UserInfo): void {
    this.sessionManager.setUser(user);
    this.eventBus.emit('user:set', user);
  }

  /**
   * 添加面包屑
   */
  addBreadcrumb(breadcrumb: Omit<Breadcrumb, 'timestamp'>): void {
    const bc: Breadcrumb = {
      ...breadcrumb,
      timestamp: now(),
    };
    this.eventBus.emit('breadcrumb:add', bc);
  }

  /**
   * 获取当前 sessionId
   */
  getSessionId(): string {
    return this.sessionManager.getSessionId();
  }

  /**
   * 获取 SDK 配置（只读副本）
   */
  getConfig(): Record<string, unknown> {
    return this.configManager.getConfig() as unknown as Record<string, unknown>;
  }

  /**
   * 立即刷新事件队列
   */
  flush(): void {
    this.eventQueue.flush();
  }

  /**
   * 安装插件（运行时动态安装）
   */
  use(plugin: { name: string; version: string; install: (monitor: MonitorInterface) => void }): void {
    this.pluginManager.install(plugin);
  }

  /**
   * 销毁 SDK
   * 逆序销毁各子系统
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    logger.info('Monitor destroying...');

    // 1. 通知销毁事件
    this.eventBus.emit('monitor:destroy');

    // 2. 刷新剩余事件
    this.eventQueue.destroy();

    // 3. 卸载所有插件
    this.pluginManager.destroy();

    // 4. 清空事件总线
    this.eventBus.clear();

    logger.info('Monitor destroyed.');
  }

  /**
   * 采样判断
   */
  private shouldSample(event: BaseEvent): boolean {
    const config = this.configManager.getConfig();
    let sampleRate = config.sampleRate;

    // 不同类型事件使用不同采样率
    if (event.type === 'error') {
      sampleRate = config.errorSampleRate;
    } else if (event.type === 'performance') {
      sampleRate = config.performanceSampleRate;
    }

    return Math.random() < sampleRate;
  }

  /**
   * 处理 SDK 内部错误
   */
  private handleInternalError(error: Error): void {
    const config = this.configManager.getConfig();
    if (config.onError) {
      try {
        config.onError(error);
      } catch {
        // 防止 onError 自身抛出异常
      }
    }
    logger.error('Internal error:', error);
  }
}
