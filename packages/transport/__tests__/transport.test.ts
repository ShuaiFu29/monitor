import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { TransportEngine, parseDsn } from '../src/transport';
import type { SendStrategy } from '../src/strategies';
import type { BaseEvent } from '@monitor/types';

/**
 * 创建 mock 策略
 */
function mockStrategy(name: string, success: boolean): SendStrategy {
  return {
    name,
    isAvailable: () => true,
    send: vi.fn().mockResolvedValue(success),
  };
}

describe('TransportEngine', () => {
  const mockEvents: BaseEvent[] = [
    { id: 'e1', type: 'error', timestamp: 1000, sessionId: 's1' } as BaseEvent,
    { id: 'e2', type: 'error', timestamp: 2000, sessionId: 's1' } as BaseEvent,
  ];

  let engine: TransportEngine;

  afterEach(() => {
    engine?.destroy();
  });

  it('send 成功时返回 true', async () => {
    const strategy = mockStrategy('mock', true);
    engine = new TransportEngine({
      endpoint: 'https://test.com/api',
      strategies: [strategy],
      retryConfig: { maxRetries: 0, baseDelay: 10, jitter: false },
      offline: false,
    });

    const result = await engine.send(mockEvents);
    expect(result).toBe(true);
    expect(strategy.send).toHaveBeenCalledTimes(1);
  });

  it('send 失败应重试后最终失败', async () => {
    const strategy = mockStrategy('mock', false);
    engine = new TransportEngine({
      endpoint: 'https://test.com/api',
      strategies: [strategy],
      retryConfig: { maxRetries: 2, baseDelay: 10, jitter: false },
      offline: false,
    });

    const result = await engine.send(mockEvents);
    expect(result).toBe(false);
    // 1 initial + 2 retries = 3 总调用
    expect(strategy.send).toHaveBeenCalledTimes(3);
  });

  it('send 失败后应写入离线存储', async () => {
    const strategy = mockStrategy('mock', false);
    engine = new TransportEngine({
      endpoint: 'https://test.com/api',
      strategies: [strategy],
      retryConfig: { maxRetries: 0, baseDelay: 10, jitter: false },
      offline: true,
      offlineConfig: { dbName: `test-offline-${Date.now()}` },
    });

    await engine.send(mockEvents);

    const storage = engine.getOfflineStorage();
    expect(storage).not.toBeNull();
    const records = await storage!.getPending();
    expect(records.length).toBe(1);
  });

  it('空事件数组应直接返回 true', async () => {
    engine = new TransportEngine({
      endpoint: 'https://test.com/api',
      strategies: [mockStrategy('mock', true)],
      offline: false,
    });

    const result = await engine.send([]);
    expect(result).toBe(true);
  });

  it('压缩开启时大数据应压缩后发送', async () => {
    const strategy = mockStrategy('mock', true);
    engine = new TransportEngine({
      endpoint: 'https://test.com/api',
      strategies: [strategy],
      compression: true,
      compressionThreshold: 10, // 非常低的阈值确保触发压缩
      retryConfig: { maxRetries: 0, baseDelay: 10, jitter: false },
      offline: false,
    });

    await engine.send(mockEvents);

    // 验证 send 被调用且数据是 Uint8Array（压缩后）
    const sendCall = (strategy.send as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sendCall[1]).toBeInstanceOf(Uint8Array);
  });

  it('压缩关闭时应发送原始 JSON', async () => {
    const strategy = mockStrategy('mock', true);
    engine = new TransportEngine({
      endpoint: 'https://test.com/api',
      strategies: [strategy],
      compression: false,
      retryConfig: { maxRetries: 0, baseDelay: 10, jitter: false },
      offline: false,
    });

    await engine.send(mockEvents);

    const sendCall = (strategy.send as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(typeof sendCall[1]).toBe('string');
  });

  it('isSending 状态应正确切换', async () => {
    let resolveSend!: (value: boolean) => void;
    const strategy: SendStrategy = {
      name: 'mock',
      isAvailable: () => true,
      send: vi.fn().mockImplementation(
        () => new Promise<boolean>((resolve) => { resolveSend = resolve; }),
      ),
    };

    engine = new TransportEngine({
      endpoint: 'https://test.com/api',
      strategies: [strategy],
      retryConfig: { maxRetries: 0, baseDelay: 10, jitter: false },
      offline: false,
    });

    expect(engine.isSending()).toBe(false);
    const sendPromise = engine.send(mockEvents);
    expect(engine.isSending()).toBe(true);
    resolveSend(true);
    await sendPromise;
    expect(engine.isSending()).toBe(false);
  });

  it('sendUrgent 应使用 sendBeacon', () => {
    Object.defineProperty(navigator, 'sendBeacon', {
      value: vi.fn().mockReturnValue(true),
      writable: true,
      configurable: true,
    });

    engine = new TransportEngine({
      endpoint: 'https://test.com/api',
      strategies: [],
      offline: false,
    });

    const result = engine.sendUrgent(mockEvents);
    expect(result).toBe(true);
    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);
  });

  it('sendUrgent 空事件应返回 true', () => {
    engine = new TransportEngine({
      endpoint: 'https://test.com/api',
      strategies: [],
      offline: false,
    });

    expect(engine.sendUrgent([])).toBe(true);
  });

  it('sendUrgent beacon 失败应降级到 XHR', () => {
    Object.defineProperty(navigator, 'sendBeacon', {
      value: vi.fn().mockReturnValue(false),
      writable: true,
      configurable: true,
    });

    engine = new TransportEngine({
      endpoint: 'https://test.com/api',
      strategies: [],
      offline: false,
    });

    // sendUrgent 尝试 beacon 失败后应尝试 XHR
    const result = engine.sendUrgent(mockEvents);
    expect(typeof result).toBe('boolean');
    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);
  });

  it('自定义 headers 应被传递给策略', async () => {
    const strategy = mockStrategy('mock', true);
    engine = new TransportEngine({
      endpoint: 'https://test.com/api',
      strategies: [strategy],
      compression: false,
      headers: { 'X-Custom': 'value' },
      retryConfig: { maxRetries: 0, baseDelay: 10, jitter: false },
      offline: false,
    });

    await engine.send(mockEvents);

    const sendCall = (strategy.send as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sendCall[2]).toEqual(expect.objectContaining({ 'X-Custom': 'value' }));
  });
});

describe('parseDsn', () => {
  it('应正确解析标准 DSN', () => {
    const result = parseDsn('https://abc123@monitor.example.com/42');
    expect(result).toEqual({
      endpoint: 'https://monitor.example.com/api/v1/events/42',
      key: 'abc123',
    });
  });

  it('应处理带路径的 DSN', () => {
    const result = parseDsn('https://key@host.com/project/1');
    expect(result).not.toBeNull();
    expect(result!.key).toBe('key');
  });

  it('无效 DSN 应返回 null', () => {
    expect(parseDsn('not-a-url')).toBeNull();
  });

  it('缺少 key 应返回 null', () => {
    expect(parseDsn('https://monitor.example.com/42')).toBeNull();
  });
});
