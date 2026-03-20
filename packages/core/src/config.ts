import type { MonitorConfig, ResolvedConfig } from '@monitor/types';
import { logger } from '@monitor/utils';

/**
 * 默认配置值
 */
const DEFAULT_CONFIG: Omit<ResolvedConfig, 'dsn'> = {
  release: '0.0.0',
  environment: 'production',
  sampleRate: 1.0,
  errorSampleRate: 1.0,
  performanceSampleRate: 0.1,
  context: {},
  plugins: [],
  batchSize: 10,
  flushInterval: 5000,
  maxRetries: 3,
};

/**
 * 配置管理器
 *
 * 职责：
 * - 合并默认值与用户传入的配置
 * - 校验必填字段
 * - 动态更新配置（如运行时修改采样率）
 */
export class ConfigManager {
  private config: ResolvedConfig;

  constructor(userConfig: MonitorConfig) {
    this.validate(userConfig);
    this.config = this.merge(userConfig);
  }

  /**
   * 校验用户配置
   */
  private validate(config: MonitorConfig): void {
    if (!config.dsn) {
      throw new Error('[Monitor] "dsn" is required in MonitorConfig.');
    }

    if (config.sampleRate !== undefined && (config.sampleRate < 0 || config.sampleRate > 1)) {
      throw new Error('[Monitor] "sampleRate" must be between 0 and 1.');
    }

    if (
      config.errorSampleRate !== undefined &&
      (config.errorSampleRate < 0 || config.errorSampleRate > 1)
    ) {
      throw new Error('[Monitor] "errorSampleRate" must be between 0 and 1.');
    }

    if (
      config.performanceSampleRate !== undefined &&
      (config.performanceSampleRate < 0 || config.performanceSampleRate > 1)
    ) {
      throw new Error('[Monitor] "performanceSampleRate" must be between 0 and 1.');
    }
  }

  /**
   * 合并用户配置与默认配置
   */
  private merge(userConfig: MonitorConfig): ResolvedConfig {
    return {
      ...DEFAULT_CONFIG,
      ...userConfig,
      context: {
        ...DEFAULT_CONFIG.context,
        ...(userConfig.context || {}),
      },
      plugins: userConfig.plugins || [],
    };
  }

  /**
   * 获取完整配置
   */
  getConfig(): ResolvedConfig {
    return { ...this.config };
  }

  /**
   * 获取指定配置项
   */
  get<K extends keyof ResolvedConfig>(key: K): ResolvedConfig[K] {
    return this.config[key];
  }

  /**
   * 动态更新配置（部分更新）
   */
  update(patch: Partial<MonitorConfig>): void {
    // 不允许更新 dsn
    if (patch.dsn && patch.dsn !== this.config.dsn) {
      logger.warn('[ConfigManager] Cannot change "dsn" after initialization.');
      return;
    }

    // 验证并更新采样率字段
    if (patch.sampleRate !== undefined) {
      if (patch.sampleRate < 0 || patch.sampleRate > 1) {
        logger.warn('[ConfigManager] "sampleRate" must be between 0 and 1, ignoring update.');
        return;
      }
      this.config.sampleRate = patch.sampleRate;
    }

    if (patch.errorSampleRate !== undefined) {
      if (patch.errorSampleRate < 0 || patch.errorSampleRate > 1) {
        logger.warn('[ConfigManager] "errorSampleRate" must be between 0 and 1, ignoring update.');
        return;
      }
      this.config.errorSampleRate = patch.errorSampleRate;
    }

    if (patch.performanceSampleRate !== undefined) {
      if (patch.performanceSampleRate < 0 || patch.performanceSampleRate > 1) {
        logger.warn('[ConfigManager] "performanceSampleRate" must be between 0 and 1, ignoring update.');
        return;
      }
      this.config.performanceSampleRate = patch.performanceSampleRate;
    }

    // 验证并更新数值型配置
    if (patch.batchSize !== undefined) {
      if (!Number.isInteger(patch.batchSize) || patch.batchSize <= 0) {
        logger.warn('[ConfigManager] "batchSize" must be a positive integer, ignoring update.');
        return;
      }
      this.config.batchSize = patch.batchSize;
    }

    if (patch.flushInterval !== undefined) {
      if (!Number.isInteger(patch.flushInterval) || patch.flushInterval <= 0) {
        logger.warn('[ConfigManager] "flushInterval" must be a positive integer, ignoring update.');
        return;
      }
      this.config.flushInterval = patch.flushInterval;
    }

    if (patch.maxRetries !== undefined) {
      if (!Number.isInteger(patch.maxRetries) || patch.maxRetries < 0) {
        logger.warn('[ConfigManager] "maxRetries" must be a non-negative integer, ignoring update.');
        return;
      }
      this.config.maxRetries = patch.maxRetries;
    }

    // 更新其他字段
    if (patch.context) {
      this.config.context = { ...this.config.context, ...patch.context };
    }

    if (patch.release !== undefined) {
      this.config.release = patch.release;
    }

    if (patch.environment !== undefined) {
      this.config.environment = patch.environment;
    }

    if (patch.beforeSend !== undefined) {
      this.config.beforeSend = patch.beforeSend;
    }

    if (patch.onError !== undefined) {
      this.config.onError = patch.onError;
    }
  }
}
