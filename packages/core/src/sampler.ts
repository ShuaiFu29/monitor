import { logger } from '@monitor/utils';

/**
 * 采样决策结果
 */
export interface SampleDecision {
  /** 是否采样 */
  sampled: boolean;
  /** 当前采样率 */
  sampleRate: number;
  /** 事件类型 */
  eventType: string;
}

/**
 * 动态采样配置
 */
export interface DynamicSamplerConfig {
  /** 初始全局采样率，默认 1.0 */
  baseSampleRate?: number;
  /** 错误率阈值（超过此值降低采样率），默认 0.1 (10%) */
  errorRateThreshold?: number;
  /** 高错误率时的降级采样率，默认 0.5 */
  degradedSampleRate?: number;
  /** 统计窗口时长 (ms)，默认 60000 (1 分钟) */
  windowDuration?: number;
  /** 窗口内最小事件数量（小于此值不触发动态调整），默认 10 */
  minWindowEvents?: number;
  /** 自定义采样率覆盖（按事件类型） */
  typeRates?: Record<string, number>;
}

/**
 * DynamicSampler — 动态采样管理器
 *
 * 功能：
 * 1. 基于事件类型的采样决策（error/performance/network/behavior/replay）
 * 2. 基于错误率的动态采样调整
 *    - 错误率 > 阈值 → 自动降低非错误事件的采样率
 *    - 错误率恢复正常 → 自动恢复采样率
 * 3. 滑动窗口统计，实时计算错误率
 * 4. 错误事件始终 100% 采样（保证不漏报）
 *
 * 设计原则：
 * - 错误永远不丢：错误事件的采样率始终为 1.0
 * - 自动降级：高错误率时自动降低低优先级事件的采样率
 * - 平滑恢复：错误率恢复时自动提升采样率
 */
export class DynamicSampler {
  private config: Required<DynamicSamplerConfig>;

  /** 当前生效的采样率（按类型） */
  private currentRates: Map<string, number> = new Map();

  /** 滑动窗口事件计数 */
  private windowEvents: { timestamp: number; isError: boolean }[] = [];

  /** 当前是否处于降级状态 */
  private degraded: boolean = false;

  /** 上次清理窗口的时间 */
  private lastCleanup: number = 0;

  constructor(config: DynamicSamplerConfig = {}) {
    this.config = {
      baseSampleRate: config.baseSampleRate ?? 1.0,
      errorRateThreshold: config.errorRateThreshold ?? 0.1,
      degradedSampleRate: config.degradedSampleRate ?? 0.5,
      windowDuration: config.windowDuration ?? 60000,
      minWindowEvents: config.minWindowEvents ?? 10,
      typeRates: config.typeRates ?? {},
    };

    // 初始化默认采样率
    this.initRates();
  }

  /**
   * 判断事件是否应该被采样
   *
   * @param eventType 事件类型（如 'error', 'performance', 'network'）
   * @returns 采样决策
   */
  shouldSample(eventType: string): SampleDecision {
    // 错误事件始终采样
    if (eventType === 'error') {
      this.recordEvent(true);
      return { sampled: true, sampleRate: 1.0, eventType };
    }

    // 记录非错误事件
    this.recordEvent(false);

    // 获取当前采样率
    const rate = this.getSampleRate(eventType);
    const sampled = Math.random() < rate;

    return { sampled, sampleRate: rate, eventType };
  }

  /**
   * 获取某类型事件的当前采样率
   */
  getSampleRate(eventType: string): number {
    return this.currentRates.get(eventType) ?? this.config.baseSampleRate;
  }

  /**
   * 手动设置某类型事件的采样率
   */
  setSampleRate(eventType: string, rate: number): void {
    const clamped = Math.max(0, Math.min(1, rate));
    this.currentRates.set(eventType, clamped);
    logger.info(`[Sampler] Set ${eventType} sample rate to ${clamped}`);
  }

  /**
   * 获取当前错误率
   */
  getErrorRate(): number {
    this.cleanupWindow();
    if (this.windowEvents.length === 0) return 0;
    const errorCount = this.windowEvents.filter((e) => e.isError).length;
    return errorCount / this.windowEvents.length;
  }

  /**
   * 是否处于降级状态
   */
  isDegraded(): boolean {
    return this.degraded;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    errorRate: number;
    degraded: boolean;
    windowSize: number;
    rates: Record<string, number>;
  } {
    const rates: Record<string, number> = {};
    for (const [key, value] of this.currentRates) {
      rates[key] = value;
    }
    return {
      errorRate: this.getErrorRate(),
      degraded: this.degraded,
      windowSize: this.windowEvents.length,
      rates,
    };
  }

  /**
   * 重置采样器状态
   */
  reset(): void {
    this.windowEvents = [];
    this.degraded = false;
    this.lastCleanup = 0;
    this.initRates();
  }

  // ─── 内部方法 ───

  /**
   * 初始化默认采样率
   */
  private initRates(): void {
    this.currentRates.clear();
    this.currentRates.set('error', 1.0); // 错误永远 100%
    this.currentRates.set('performance', this.config.typeRates.performance ?? this.config.baseSampleRate);
    this.currentRates.set('network', this.config.typeRates.network ?? this.config.baseSampleRate);
    this.currentRates.set('behavior', this.config.typeRates.behavior ?? this.config.baseSampleRate);
    this.currentRates.set('replay', this.config.typeRates.replay ?? this.config.baseSampleRate);

    // 应用自定义覆盖
    for (const [type, rate] of Object.entries(this.config.typeRates)) {
      if (type !== 'error') {
        this.currentRates.set(type, Math.max(0, Math.min(1, rate)));
      }
    }
  }

  /**
   * 记录事件并触发动态调整
   */
  private recordEvent(isError: boolean): void {
    const now = Date.now();
    this.windowEvents.push({ timestamp: now, isError });

    // 定期清理过期事件（每 5 秒清理一次，避免每次都全量遍历）
    if (now - this.lastCleanup > 5000) {
      this.cleanupWindow();
      this.lastCleanup = now;
    }

    // 检查是否需要动态调整
    this.adjustSampleRates();
  }

  /**
   * 清理滑动窗口中过期的事件
   */
  private cleanupWindow(): void {
    const cutoff = Date.now() - this.config.windowDuration;
    this.windowEvents = this.windowEvents.filter((e) => e.timestamp > cutoff);
  }

  /**
   * 动态调整采样率
   */
  private adjustSampleRates(): void {
    // 事件数不足，不触发调整
    if (this.windowEvents.length < this.config.minWindowEvents) return;

    const errorRate = this.getErrorRate();

    if (errorRate > this.config.errorRateThreshold && !this.degraded) {
      // 进入降级模式：降低非错误事件的采样率
      this.degraded = true;
      for (const [type] of this.currentRates) {
        if (type !== 'error') {
          const currentRate = this.currentRates.get(type) ?? this.config.baseSampleRate;
          this.currentRates.set(type, Math.min(currentRate, this.config.degradedSampleRate));
        }
      }
      logger.warn(
        `[Sampler] Error rate ${(errorRate * 100).toFixed(1)}% exceeded threshold, degrading sample rates`,
      );
    } else if (errorRate <= this.config.errorRateThreshold && this.degraded) {
      // 退出降级模式：恢复采样率
      this.degraded = false;
      this.initRates();
      logger.info('[Sampler] Error rate recovered, restoring sample rates');
    }
  }
}
