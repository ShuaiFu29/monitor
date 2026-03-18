import { logger } from '@monitor/utils';

/**
 * 自定义行为事件
 */
export interface CustomBehaviorEvent {
  /** 事件名称 */
  name: string;
  /** 事件类别 */
  category: string;
  /** 事件附加数据 */
  data?: Record<string, unknown>;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 自定义事件管理器配置
 */
export interface CustomEventsConfig {
  /** 最大缓冲数量，默认 200 */
  maxBuffer?: number;
  /** flush 间隔 (ms)，默认 5000 */
  flushInterval?: number;
}

export type CustomEventsFlushCallback = (events: CustomBehaviorEvent[]) => void;

/**
 * CustomEventsManager — 自定义行为事件管理器
 *
 * 功能：
 * 1. 允许业务代码手动上报自定义行为事件
 * 2. 缓冲事件，定时批量 flush
 * 3. 事件支持名称 + 类别 + 自定义数据
 *
 * 使用场景：
 * - 关键业务操作追踪（如"添加购物车"、"完成支付"）
 * - A/B 测试事件
 * - 功能使用频率统计
 */
export class CustomEventsManager {
  private callback: CustomEventsFlushCallback;
  private config: Required<CustomEventsConfig>;
  private buffer: CustomBehaviorEvent[] = [];
  private flushTimerId: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(callback: CustomEventsFlushCallback, config: CustomEventsConfig = {}) {
    this.callback = callback;
    this.config = {
      maxBuffer: config.maxBuffer ?? 200,
      flushInterval: config.flushInterval ?? 5000,
    };
  }

  /**
   * 启动定时 flush
   */
  start(): void {
    if (this.started) return;

    this.flushTimerId = setInterval(() => this.flush(), this.config.flushInterval);
    this.started = true;
    logger.info('[CustomEventsManager] Started');
  }

  /**
   * 停止
   */
  stop(): void {
    if (!this.started) return;

    if (this.flushTimerId !== null) {
      clearInterval(this.flushTimerId);
      this.flushTimerId = null;
    }

    this.flush();
    this.started = false;
    logger.info('[CustomEventsManager] Stopped');
  }

  /**
   * 记录自定义事件
   *
   * @param name 事件名称，如 'add_to_cart'
   * @param category 事件类别，如 'ecommerce'
   * @param data 附加数据
   */
  track(name: string, category: string, data?: Record<string, unknown>): void {
    const event: CustomBehaviorEvent = {
      name,
      category,
      data,
      timestamp: Date.now(),
    };

    this.buffer.push(event);

    // 超过缓冲上限时立即 flush
    if (this.buffer.length >= this.config.maxBuffer) {
      this.flush();
    }
  }

  /**
   * 手动 flush
   */
  flush(): void {
    if (this.buffer.length === 0) return;
    const events = this.buffer;
    this.buffer = [];
    this.callback(events);
  }

  /**
   * 获取当前缓冲区大小
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * 是否已启动
   */
  isActive(): boolean {
    return this.started;
  }
}
