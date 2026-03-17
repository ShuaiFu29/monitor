import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Monitor } from '@monitor/core';
import { errorPlugin } from '../src/index';

/**
 * ErrorPlugin + Core 集成测试
 *
 * 验证：
 * 1. ErrorPlugin 能通过 Monitor 正确安装
 * 2. 错误捕获后事件能流转到 EventBus → captureEvent → EventQueue
 * 3. 面包屑在错误发生时正确附带
 * 4. destroy 时正确清理
 * 5. SDK 自身异常不崩溃
 */
describe('ErrorPlugin + Core 集成测试', () => {
  let monitor: Monitor;
  let plugin: ReturnType<typeof errorPlugin>;
  let capturedEvents: unknown[];
  let originalOnerror: OnErrorEventHandler;

  beforeEach(() => {
    originalOnerror = window.onerror;
    capturedEvents = [];

    plugin = errorPlugin({
      aggregator: { dedupeInterval: 100 }, // 短窗口方便测试
      breadcrumb: { maxSize: 20 },
    });

    monitor = new Monitor({
      dsn: 'https://test.example.com/api/report',
      plugins: [plugin],
      sampleRate: 1,
      errorSampleRate: 1,
    });

    // 监听 transport:send 来捕获最终事件
    monitor.eventBus.on('event:captured', (event: unknown) => {
      capturedEvents.push(event);
    });
  });

  afterEach(() => {
    monitor.destroy();
    window.onerror = originalOnerror;
  });

  // ────── 插件安装 ──────
  it('ErrorPlugin 应通过 Monitor 正确安装', () => {
    // 验证 window.onerror 已被设置
    expect(window.onerror).toBeDefined();
    expect(window.onerror).not.toBe(originalOnerror);
  });

  // ────── JS 错误 → 事件流转 ──────
  it('JS 错误应触发完整事件流转', () => {
    const error = new Error('Integration test error');
    error.name = 'TypeError';

    // 触发 window.onerror
    window.onerror!(
      'Uncaught TypeError: Integration test error',
      'http://example.com/app.js',
      42,
      10,
      error,
    );

    // 验证事件被捕获
    expect(capturedEvents.length).toBe(1);

    const event = capturedEvents[0] as Record<string, unknown>;
    expect(event.type).toBe('error');
    expect(event.message).toBe('Integration test error');
    expect(event.subType).toBe('js_error');
    expect(event.fingerprint).toBeTruthy();
    expect(event.level).toBe('error');

    // 应包含公共字段（由 Monitor.captureEvent 填充）
    expect(event.id).toBeTruthy();
    expect(event.timestamp).toBeGreaterThan(0);
    expect(event.sessionId).toBeTruthy();
  });

  // ────── 面包屑附带 ──────
  it('错误事件应包含之前的面包屑', () => {
    // 先添加一些面包屑
    monitor.addBreadcrumb({
      message: 'User clicked submit',
      category: 'ui',
      level: 'info',
    });

    monitor.addBreadcrumb({
      message: 'API request to /users',
      category: 'network',
      level: 'info',
    });

    // 触发错误
    const error = new Error('Breadcrumb test');
    window.onerror!(error.message, '', 0, 0, error);

    const event = capturedEvents[0] as Record<string, unknown>;
    const breadcrumbs = event.breadcrumbs as Array<{ message: string; category: string }>;
    expect(breadcrumbs).toBeDefined();
    expect(breadcrumbs.length).toBeGreaterThanOrEqual(2);

    // 验证面包屑内容（按时间顺序排列）
    const messages = breadcrumbs.map((b) => b.message);
    expect(messages).toContain('User clicked submit');
    expect(messages).toContain('API request to /users');
  });

  // ────── 手动捕获 ──────
  it('手动 captureError 应正确工作', () => {
    plugin.captureError(new Error('Manual capture'));

    expect(capturedEvents.length).toBe(1);
    const event = capturedEvents[0] as Record<string, unknown>;
    expect(event.message).toBe('Manual capture');
    expect(event.type).toBe('error');
  });

  // ────── destroy 清理 ──────
  it('destroy 应清理全局事件监听', () => {
    // destroy 后 window.onerror 应被恢复
    monitor.destroy();

    // 之后触发错误不应被捕获
    const error = new Error('After destroy');
    if (window.onerror) {
      window.onerror(error.message, '', 0, 0, error);
    }

    // 不应有新事件
    expect(capturedEvents.length).toBe(0);
  });

  // ────── 去重 ──────
  it('相同错误在去重窗口内不应重复上报', () => {
    const error = new Error('Duplicate error');
    window.onerror!(error.message, 'http://a.js', 1, 1, error);
    window.onerror!(error.message, 'http://a.js', 1, 1, error);
    window.onerror!(error.message, 'http://a.js', 1, 1, error);

    expect(capturedEvents.length).toBe(1);
  });

  // ────── 错误结构完整性 ──────
  it('错误事件应包含完整的结构化信息', () => {
    const error = new Error('Structure test');
    error.name = 'RangeError';
    window.onerror!(error.message, '', 0, 0, error);

    const event = capturedEvents[0] as Record<string, unknown>;

    // 必须有的字段
    expect(event.type).toBe('error');
    expect(event.message).toBe('Structure test');
    expect(event.name).toBe('RangeError');
    expect(event.subType).toBe('js_error');
    expect(event.level).toBe('error');
    expect(event.fingerprint).toBeTruthy();
    expect(event.stack).toBeTruthy();
    expect(event.frames).toBeDefined();
    expect(event.breadcrumbs).toBeDefined();

    // Monitor 填充的公共字段
    expect(event.id).toBeTruthy();
    expect(event.timestamp).toBeGreaterThan(0);
    expect(event.sessionId).toBeTruthy();
  });

  // ────── SDK 自保护 ──────
  describe('SDK 自保护', () => {
    it('beforeSend 抛出异常不应崩溃', () => {
      const fragileMonitor = new Monitor({
        dsn: 'https://test.example.com/api/report',
        plugins: [errorPlugin()],
        sampleRate: 1,
        errorSampleRate: 1,
        beforeSend: () => {
          throw new Error('beforeSend exploded');
        },
      });

      // 不应抛出
      expect(() => {
        const error = new Error('test');
        window.onerror!(error.message, '', 0, 0, error);
      }).not.toThrow();

      fragileMonitor.destroy();
    });

    it('连续大量错误不应导致栈溢出', () => {
      // 临时调整 dedupeInterval 为 0，让每个错误都能上报
      const massMonitor = new Monitor({
        dsn: 'https://test.example.com/api/report',
        plugins: [
          errorPlugin({
            aggregator: { dedupeInterval: 0 },
          }),
        ],
        sampleRate: 1,
        errorSampleRate: 1,
      });

      expect(() => {
        for (let i = 0; i < 100; i++) {
          const error = new Error(`Error ${i}`);
          window.onerror!(error.message, `http://file${i}.js`, i, 0, error);
        }
      }).not.toThrow();

      massMonitor.destroy();
    });
  });
});
