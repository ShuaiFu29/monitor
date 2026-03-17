import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RetryManager, calculateBackoffDelay } from '../src/retry';

describe('calculateBackoffDelay', () => {
  const config = { maxRetries: 3, baseDelay: 1000, maxDelay: 30000, jitter: false };

  it('attempt 0 应返回 baseDelay', () => {
    expect(calculateBackoffDelay(0, config)).toBe(1000);
  });

  it('attempt 1 应返回 2 * baseDelay', () => {
    expect(calculateBackoffDelay(1, config)).toBe(2000);
  });

  it('attempt 2 应返回 4 * baseDelay', () => {
    expect(calculateBackoffDelay(2, config)).toBe(4000);
  });

  it('不应超过 maxDelay', () => {
    const smallMax = { ...config, maxDelay: 5000 };
    // 2^10 * 1000 = 1024000 >> 5000
    expect(calculateBackoffDelay(10, smallMax)).toBe(5000);
  });

  it('启用 jitter 时延迟应大于等于基础值', () => {
    const jitterConfig = { ...config, jitter: true };
    const delay = calculateBackoffDelay(0, jitterConfig);
    expect(delay).toBeGreaterThanOrEqual(1000);
    // jitter 最多增加 30%
    expect(delay).toBeLessThan(1300 + 1);
  });
});

describe('RetryManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('第一次成功应返回 attempts: 1', async () => {
    vi.useRealTimers();
    const retrier = new RetryManager({ maxRetries: 3, baseDelay: 10, jitter: false });
    const operation = vi.fn().mockResolvedValue(true);

    const result = await retrier.execute(operation);
    expect(result).toEqual({ success: true, attempts: 1 });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('第一次失败第二次成功应返回 attempts: 2', async () => {
    vi.useRealTimers();
    const retrier = new RetryManager({ maxRetries: 3, baseDelay: 10, jitter: false });
    const operation = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const result = await retrier.execute(operation);
    expect(result).toEqual({ success: true, attempts: 2 });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('所有重试失败应返回 success: false', async () => {
    vi.useRealTimers();
    const retrier = new RetryManager({ maxRetries: 2, baseDelay: 10, jitter: false });
    const operation = vi.fn().mockResolvedValue(false);

    const result = await retrier.execute(operation);
    expect(result).toEqual({ success: false, attempts: 3 }); // 1 initial + 2 retries
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('操作抛出异常应视为失败', async () => {
    vi.useRealTimers();
    const retrier = new RetryManager({ maxRetries: 1, baseDelay: 10, jitter: false });
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(true);

    const result = await retrier.execute(operation);
    expect(result).toEqual({ success: true, attempts: 2 });
  });

  it('应调用 onRetry 回调', async () => {
    vi.useRealTimers();
    const retrier = new RetryManager({ maxRetries: 2, baseDelay: 10, jitter: false });
    const operation = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const onRetry = vi.fn();

    await retrier.execute(operation, onRetry);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Number));
    expect(onRetry).toHaveBeenCalledWith(2, expect.any(Number));
  });

  it('getConfig 应返回配置副本', () => {
    const retrier = new RetryManager({ maxRetries: 5, baseDelay: 2000 });
    const config = retrier.getConfig();
    expect(config.maxRetries).toBe(5);
    expect(config.baseDelay).toBe(2000);
    expect(config.maxDelay).toBe(30000); // default
    expect(config.jitter).toBe(true); // default
  });

  it('maxRetries 为 0 时只尝试一次', async () => {
    vi.useRealTimers();
    const retrier = new RetryManager({ maxRetries: 0, baseDelay: 10, jitter: false });
    const operation = vi.fn().mockResolvedValue(false);

    const result = await retrier.execute(operation);
    expect(result).toEqual({ success: false, attempts: 1 });
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
