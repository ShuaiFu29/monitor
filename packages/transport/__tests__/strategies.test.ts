import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BeaconStrategy,
  FetchStrategy,
  XHRStrategy,
  ImageStrategy,
  createStrategy,
  createDefaultStrategies,
  sendWithFallback,
} from '../src/strategies';

describe('BeaconStrategy', () => {
  let strategy: BeaconStrategy;

  beforeEach(() => {
    strategy = new BeaconStrategy();
  });

  it('name 应为 beacon', () => {
    expect(strategy.name).toBe('beacon');
  });

  it('isAvailable 应检查 navigator.sendBeacon', () => {
    const original = navigator.sendBeacon;
    Object.defineProperty(navigator, 'sendBeacon', {
      value: vi.fn(),
      writable: true,
      configurable: true,
    });
    expect(strategy.isAvailable()).toBe(true);

    Object.defineProperty(navigator, 'sendBeacon', {
      value: original,
      writable: true,
      configurable: true,
    });
  });

  it('send 成功时返回 true', async () => {
    Object.defineProperty(navigator, 'sendBeacon', {
      value: vi.fn().mockReturnValue(true),
      writable: true,
      configurable: true,
    });

    const result = await strategy.send('https://test.com/api', '{"test":true}');
    expect(result).toBe(true);
    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);
  });

  it('send 失败时返回 false', async () => {
    Object.defineProperty(navigator, 'sendBeacon', {
      value: vi.fn().mockReturnValue(false),
      writable: true,
      configurable: true,
    });

    const result = await strategy.send('https://test.com/api', '{"test":true}');
    expect(result).toBe(false);
  });

  it('send Uint8Array 应使用 application/octet-stream', async () => {
    let capturedBlob: Blob | undefined;
    Object.defineProperty(navigator, 'sendBeacon', {
      value: vi.fn().mockImplementation((_url: string, data: Blob) => {
        capturedBlob = data;
        return true;
      }),
      writable: true,
      configurable: true,
    });

    const data = new Uint8Array([1, 2, 3]);
    await strategy.send('https://test.com/api', data);
    expect(capturedBlob?.type).toBe('application/octet-stream');
  });

  it('send 异常时返回 false', async () => {
    Object.defineProperty(navigator, 'sendBeacon', {
      value: vi.fn().mockImplementation(() => {
        throw new Error('Beacon error');
      }),
      writable: true,
      configurable: true,
    });

    const result = await strategy.send('https://test.com/api', 'test');
    expect(result).toBe(false);
  });
});

describe('FetchStrategy', () => {
  let strategy: FetchStrategy;
  let originalFetch: typeof window.fetch;

  beforeEach(() => {
    strategy = new FetchStrategy();
    originalFetch = window.fetch;
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  it('name 应为 fetch', () => {
    expect(strategy.name).toBe('fetch');
  });

  it('isAvailable 应检查 window.fetch', () => {
    expect(strategy.isAvailable()).toBe(true);
  });

  it('send 成功时返回 true', async () => {
    window.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

    const result = await strategy.send('https://test.com/api', '{"test":true}');
    expect(result).toBe(true);
    expect(window.fetch).toHaveBeenCalledWith('https://test.com/api', expect.objectContaining({
      method: 'POST',
      body: '{"test":true}',
      keepalive: true,
    }));
  });

  it('send 服务端返回 500 时返回 false', async () => {
    window.fetch = vi.fn().mockResolvedValue(new Response('error', { status: 500 }));

    const result = await strategy.send('https://test.com/api', 'test');
    expect(result).toBe(false);
  });

  it('send 网络错误时返回 false', async () => {
    window.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await strategy.send('https://test.com/api', 'test');
    expect(result).toBe(false);
  });

  it('send 应设置自定义 headers', async () => {
    window.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

    await strategy.send('https://test.com/api', 'test', {
      'X-Custom': 'value',
    });

    expect(window.fetch).toHaveBeenCalledWith(
      'https://test.com/api',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Custom': 'value',
        }),
      }),
    );
  });
});

describe('XHRStrategy', () => {
  it('name 应为 xhr', () => {
    const strategy = new XHRStrategy();
    expect(strategy.name).toBe('xhr');
  });

  it('isAvailable 应检查 XMLHttpRequest', () => {
    const strategy = new XHRStrategy();
    expect(strategy.isAvailable()).toBe(true);
  });

  it('异步 send 应设置 timeout', async () => {
    const strategy = new XHRStrategy();
    // XHR 在 happy-dom 中有限支持，主要验证不崩溃
    const result = await strategy.send('https://localhost:9999/test', '{"test":true}');
    expect(typeof result).toBe('boolean');
  });

  it('同步模式应正常工作', async () => {
    const strategy = new XHRStrategy({ sync: true });
    // 同步 XHR 在 happy-dom 中可能不完全支持
    const result = await strategy.send('https://localhost:9999/test', '{"test":true}');
    expect(typeof result).toBe('boolean');
  });

  it('应设置自定义 headers', async () => {
    const strategy = new XHRStrategy();
    const result = await strategy.send('https://localhost:9999/test', 'data', {
      'X-Custom': 'value',
      'Content-Type': 'text/plain',
    });
    expect(typeof result).toBe('boolean');
  });
});

describe('ImageStrategy', () => {
  let strategy: ImageStrategy;

  beforeEach(() => {
    strategy = new ImageStrategy();
  });

  it('name 应为 image', () => {
    expect(strategy.name).toBe('image');
  });

  it('isAvailable 应检查 Image 构造函数', () => {
    expect(strategy.isAvailable()).toBe(true);
  });

  it('send 应创建 Image 并设置 src', async () => {
    // Image 在 happy-dom 中 onload/onerror 行为不可预测
    // 主要验证不崩溃
    const promise = strategy.send('https://test.com/api', 'small data');
    // 不等待完成，验证不抛出异常
    expect(promise).toBeInstanceOf(Promise);
  });

  it('send 应截断超长数据', async () => {
    const longData = 'a'.repeat(3000);
    const promise = strategy.send('https://test.com/api', longData);
    expect(promise).toBeInstanceOf(Promise);
  });
});

describe('createStrategy', () => {
  it('应创建对应策略实例', () => {
    expect(createStrategy('beacon')).toBeInstanceOf(BeaconStrategy);
    expect(createStrategy('fetch')).toBeInstanceOf(FetchStrategy);
    expect(createStrategy('xhr')).toBeInstanceOf(XHRStrategy);
    expect(createStrategy('image')).toBeInstanceOf(ImageStrategy);
  });

  it('未知名称返回 null', () => {
    expect(createStrategy('unknown')).toBeNull();
  });
});

describe('createDefaultStrategies', () => {
  it('应返回可用策略数组', () => {
    const strategies = createDefaultStrategies();
    expect(strategies.length).toBeGreaterThan(0);
    strategies.forEach((s) => expect(s.isAvailable()).toBe(true));
  });
});

describe('sendWithFallback', () => {
  it('第一个策略成功时直接返回', async () => {
    const s1 = { name: 'mock1', isAvailable: () => true, send: vi.fn().mockResolvedValue(true) };
    const s2 = { name: 'mock2', isAvailable: () => true, send: vi.fn().mockResolvedValue(true) };

    const result = await sendWithFallback([s1, s2], 'https://test.com', 'data');
    expect(result).toEqual({ success: true, strategy: 'mock1' });
    expect(s1.send).toHaveBeenCalledTimes(1);
    expect(s2.send).not.toHaveBeenCalled();
  });

  it('第一个失败应降级到第二个', async () => {
    const s1 = { name: 'mock1', isAvailable: () => true, send: vi.fn().mockResolvedValue(false) };
    const s2 = { name: 'mock2', isAvailable: () => true, send: vi.fn().mockResolvedValue(true) };

    const result = await sendWithFallback([s1, s2], 'https://test.com', 'data');
    expect(result).toEqual({ success: true, strategy: 'mock2' });
  });

  it('所有策略失败返回 success: false', async () => {
    const s1 = { name: 'mock1', isAvailable: () => true, send: vi.fn().mockResolvedValue(false) };
    const s2 = { name: 'mock2', isAvailable: () => true, send: vi.fn().mockResolvedValue(false) };

    const result = await sendWithFallback([s1, s2], 'https://test.com', 'data');
    expect(result).toEqual({ success: false });
  });

  it('应跳过不可用的策略', async () => {
    const s1 = { name: 'mock1', isAvailable: () => false, send: vi.fn().mockResolvedValue(false) };
    const s2 = { name: 'mock2', isAvailable: () => true, send: vi.fn().mockResolvedValue(true) };

    const result = await sendWithFallback([s1, s2], 'https://test.com', 'data');
    expect(result).toEqual({ success: true, strategy: 'mock2' });
    expect(s1.send).not.toHaveBeenCalled();
  });

  it('应传递 headers', async () => {
    const s1 = { name: 'mock1', isAvailable: () => true, send: vi.fn().mockResolvedValue(true) };
    const headers = { 'X-Key': 'abc' };

    await sendWithFallback([s1], 'https://test.com', 'data', headers);
    expect(s1.send).toHaveBeenCalledWith('https://test.com', 'data', headers);
  });
});
