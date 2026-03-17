import { logger } from '@monitor/utils';

/**
 * 重试配置
 */
export interface RetryConfig {
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 基础延迟 (ms)，默认 1000 */
  baseDelay?: number;
  /** 最大延迟 (ms)，默认 30000 */
  maxDelay?: number;
  /** 是否添加抖动 (jitter)，默认 true */
  jitter?: boolean;
}

const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  jitter: true,
};

/**
 * 计算指数退避延迟
 *
 * delay = min(baseDelay * 2^attempt, maxDelay) + jitter
 * jitter 为 [0, 0.3 * delay) 的随机值，避免惊群效应
 */
export function calculateBackoffDelay(
  attempt: number,
  config: Required<RetryConfig>,
): number {
  const exponentialDelay = config.baseDelay * Math.pow(2, attempt);
  const clampedDelay = Math.min(exponentialDelay, config.maxDelay);

  if (config.jitter) {
    const jitter = Math.random() * clampedDelay * 0.3;
    return Math.floor(clampedDelay + jitter);
  }

  return clampedDelay;
}

/**
 * 等待指定毫秒数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 重试管理器
 *
 * 对任意异步操作执行指数退避重试。
 * 每次失败后等待 baseDelay * 2^attempt 毫秒再重试。
 *
 * @example
 * ```ts
 * const retrier = new RetryManager({ maxRetries: 3, baseDelay: 1000 });
 * const result = await retrier.execute(
 *   async () => await sendToServer(data),
 * );
 * ```
 */
export class RetryManager {
  private config: Required<RetryConfig>;

  constructor(config?: RetryConfig) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  /**
   * 执行带重试的异步操作
   *
   * @param operation 要执行的操作，返回 true 表示成功
   * @param onRetry 每次重试前的回调（可选）
   * @returns 最终执行结果
   */
  async execute(
    operation: () => Promise<boolean>,
    onRetry?: (attempt: number, delay: number) => void,
  ): Promise<{ success: boolean; attempts: number }> {
    let attempts = 0;

    // 第一次尝试
    attempts++;
    const firstResult = await this.safeExecute(operation);
    if (firstResult) {
      return { success: true, attempts };
    }

    // 重试
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      const delay = calculateBackoffDelay(attempt, this.config);
      logger.debug(`[RetryManager] Attempt ${attempt + 1}/${this.config.maxRetries}, retrying in ${delay}ms...`);

      if (onRetry) {
        onRetry(attempt + 1, delay);
      }

      await sleep(delay);

      attempts++;
      const result = await this.safeExecute(operation);
      if (result) {
        return { success: true, attempts };
      }
    }

    logger.warn(`[RetryManager] All ${this.config.maxRetries} retries exhausted.`);
    return { success: false, attempts };
  }

  /**
   * 获取当前配置
   */
  getConfig(): Required<RetryConfig> {
    return { ...this.config };
  }

  /**
   * 安全执行操作，捕获异常返回 false
   */
  private async safeExecute(operation: () => Promise<boolean>): Promise<boolean> {
    try {
      return await operation();
    } catch (error) {
      logger.debug('[RetryManager] Operation threw error:', error as Error);
      return false;
    }
  }
}
