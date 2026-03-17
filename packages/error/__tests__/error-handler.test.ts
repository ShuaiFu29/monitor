import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MonitorInterface, EventBusInterface, BaseEvent, Breadcrumb, UserInfo } from '@monitor/types';
import { ErrorHandler } from '../src/error-handler';

/**
 * 创建 Mock Monitor 实例
 */
function createMockMonitor(): MonitorInterface & {
  capturedEvents: Partial<BaseEvent>[];
  breadcrumbHandlers: Array<(data: unknown) => void>;
} {
  const capturedEvents: Partial<BaseEvent>[] = [];
  const breadcrumbHandlers: Array<(data: unknown) => void> = [];

  const eventBus: EventBusInterface = {
    on: vi.fn((eventName: string, handler: (...args: unknown[]) => void) => {
      if (eventName === 'breadcrumb:add') {
        breadcrumbHandlers.push(handler);
      }
    }),
    once: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    clear: vi.fn(),
  };

  return {
    eventBus,
    capturedEvents,
    breadcrumbHandlers,
    captureEvent: vi.fn((event: Partial<BaseEvent>) => {
      capturedEvents.push(event);
    }),
    setUser: vi.fn(),
    addBreadcrumb: vi.fn(),
    getSessionId: vi.fn(() => 'session-123'),
    getConfig: vi.fn(() => ({})),
    destroy: vi.fn(),
  };
}

describe('ErrorHandler', () => {
  let handler: ErrorHandler;
  let monitor: ReturnType<typeof createMockMonitor>;

  // 保存原始 window 事件注册
  let originalOnerror: OnErrorEventHandler;
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalOnerror = window.onerror;
    addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    handler = new ErrorHandler({
      aggregator: { dedupeInterval: 60_000 },
      breadcrumb: { maxSize: 10 },
    });
    monitor = createMockMonitor();
  });

  afterEach(() => {
    handler.uninstall();
    window.onerror = originalOnerror;
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  // ────── install / uninstall ──────
  describe('install / uninstall', () => {
    it('install 应设置 window.onerror', () => {
      handler.install(monitor);
      expect(window.onerror).toBeDefined();
      expect(window.onerror).not.toBe(originalOnerror);
    });

    it('install 应注册 unhandledrejection 监听', () => {
      handler.install(monitor);
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'unhandledrejection',
        expect.any(Function),
      );
    });

    it('install 应注册资源错误监听（捕获阶段）', () => {
      handler.install(monitor);
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'error',
        expect.any(Function),
        true, // capture phase
      );
    });

    it('uninstall 应清除 window.onerror', () => {
      handler.install(monitor);
      handler.uninstall();
      expect(window.onerror).toBeNull();
    });

    it('uninstall 应移除事件监听', () => {
      handler.install(monitor);
      handler.uninstall();
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'unhandledrejection',
        expect.any(Function),
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'error',
        expect.any(Function),
        true,
      );
    });

    it('install 应监听 breadcrumb:add 事件', () => {
      handler.install(monitor);
      expect(monitor.eventBus.on).toHaveBeenCalledWith(
        'breadcrumb:add',
        expect.any(Function),
      );
    });
  });

  // ────── JS 错误捕获 ──────
  describe('JS 错误捕获 (window.onerror)', () => {
    it('应捕获并上报 Error 对象', () => {
      handler.install(monitor);

      const error = new Error('Test error');
      error.name = 'TypeError';
      // 模拟 window.onerror 被调用
      window.onerror!(
        'Uncaught TypeError: Test error',
        'http://example.com/app.js',
        10,
        5,
        error,
      );

      expect(monitor.captureEvent).toHaveBeenCalledTimes(1);
      const event = monitor.capturedEvents[0];
      expect(event.type).toBe('error');
      expect((event as Record<string, unknown>).message).toBe('Test error');
      expect((event as Record<string, unknown>).subType).toBe('js_error');
    });

    it('无 Error 对象时应降级构造', () => {
      handler.install(monitor);

      window.onerror!(
        'Script error',
        'http://example.com/app.js',
        10,
        5,
        undefined,
      );

      expect(monitor.captureEvent).toHaveBeenCalledTimes(1);
      const event = monitor.capturedEvents[0] as Record<string, unknown>;
      expect(event.message).toBe('Script error');
    });
  });

  // ────── Promise 拒绝捕获 ──────
  describe('Promise 拒绝捕获', () => {
    /**
     * happy-dom 没有 PromiseRejectionEvent，
     * 用 Event + reason 属性模拟
     */
    function createRejectionEvent(reason: unknown): Event {
      const event = new Event('unhandledrejection');
      (event as unknown as Record<string, unknown>).reason = reason;
      (event as unknown as Record<string, unknown>).promise = Promise.resolve();
      return event;
    }

    it('应捕获 Error 类型的 rejection', () => {
      handler.install(monitor);

      const error = new Error('Promise failed');
      window.dispatchEvent(createRejectionEvent(error));

      expect(monitor.captureEvent).toHaveBeenCalledTimes(1);
      const captured = monitor.capturedEvents[0] as Record<string, unknown>;
      expect(captured.message).toBe('Promise failed');
      expect(captured.subType).toBe('unhandled_rejection');
    });

    it('应处理非 Error 类型的 rejection reason', () => {
      handler.install(monitor);

      window.dispatchEvent(createRejectionEvent('string rejection'));

      expect(monitor.captureEvent).toHaveBeenCalledTimes(1);
      const captured = monitor.capturedEvents[0] as Record<string, unknown>;
      expect(captured.message).toBe('string rejection');
    });

    it('可通过配置禁用 Promise 拒绝捕获', () => {
      const customHandler = new ErrorHandler({ captureUnhandledRejections: false });
      customHandler.install(monitor);

      expect(addEventListenerSpy).not.toHaveBeenCalledWith(
        'unhandledrejection',
        expect.any(Function),
      );

      customHandler.uninstall();
    });
  });

  // ────── 错误忽略 ──────
  describe('错误忽略', () => {
    it('应忽略匹配 ignoreErrors 字符串的错误', () => {
      const filteredHandler = new ErrorHandler({
        ignoreErrors: ['ResizeObserver loop'],
      });
      filteredHandler.install(monitor);

      const error = new Error('ResizeObserver loop limit exceeded');
      window.onerror!(error.message, '', 0, 0, error);

      expect(monitor.captureEvent).not.toHaveBeenCalled();

      filteredHandler.uninstall();
    });

    it('应忽略匹配 ignoreErrors 正则的错误', () => {
      const filteredHandler = new ErrorHandler({
        ignoreErrors: [/^Script error\.?$/],
      });
      filteredHandler.install(monitor);

      const error = new Error('Script error.');
      window.onerror!(error.message, '', 0, 0, error);

      expect(monitor.captureEvent).not.toHaveBeenCalled();

      filteredHandler.uninstall();
    });

    it('不匹配的错误应正常上报', () => {
      const filteredHandler = new ErrorHandler({
        ignoreErrors: ['ResizeObserver'],
      });
      filteredHandler.install(monitor);

      const error = new Error('Real error');
      window.onerror!(error.message, '', 0, 0, error);

      expect(monitor.captureEvent).toHaveBeenCalledTimes(1);

      filteredHandler.uninstall();
    });
  });

  // ────── 去重 ──────
  describe('去重', () => {
    it('相同错误在去重窗口内不应重复上报', () => {
      handler.install(monitor);

      const error = new Error('Duplicate error');
      window.onerror!(error.message, 'http://a.js', 1, 1, error);
      window.onerror!(error.message, 'http://a.js', 1, 1, error);
      window.onerror!(error.message, 'http://a.js', 1, 1, error);

      // 只有第一次应该上报
      expect(monitor.captureEvent).toHaveBeenCalledTimes(1);
    });
  });

  // ────── 面包屑 ──────
  describe('面包屑', () => {
    it('上报的错误应包含面包屑快照', () => {
      handler.install(monitor);

      // 通过 EventBus 模拟面包屑添加
      const breadcrumbHandler = monitor.breadcrumbHandlers[0];
      breadcrumbHandler({
        message: 'user clicked button',
        category: 'ui',
        level: 'info',
        timestamp: Date.now(),
      });

      const error = new Error('After click');
      window.onerror!(error.message, '', 0, 0, error);

      const event = monitor.capturedEvents[0] as Record<string, unknown>;
      const breadcrumbs = event.breadcrumbs as Array<{ message: string }>;
      expect(breadcrumbs).toBeDefined();
      expect(breadcrumbs.length).toBeGreaterThanOrEqual(1);
      expect(breadcrumbs[0].message).toBe('user clicked button');
    });
  });

  // ────── 手动捕获 ──────
  describe('captureError', () => {
    it('应支持手动捕获 Error 对象', () => {
      handler.install(monitor);
      handler.captureError(new Error('Manual error'));

      expect(monitor.captureEvent).toHaveBeenCalledTimes(1);
      const event = monitor.capturedEvents[0] as Record<string, unknown>;
      expect(event.message).toBe('Manual error');
    });

    it('应支持手动捕获字符串', () => {
      handler.install(monitor);
      handler.captureError('String error');

      expect(monitor.captureEvent).toHaveBeenCalledTimes(1);
      const event = monitor.capturedEvents[0] as Record<string, unknown>;
      expect(event.message).toBe('String error');
    });
  });

  // ────── 自保护 ──────
  describe('SDK 自保护', () => {
    it('handler 内部异常不应向外抛出', () => {
      handler.install(monitor);

      // 让 captureEvent 抛出异常
      (monitor.captureEvent as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('captureEvent exploded');
      });

      // 不应抛出
      expect(() => {
        const error = new Error('test');
        window.onerror!(error.message, '', 0, 0, error);
      }).not.toThrow();
    });

    it('不应递归捕获自身错误', () => {
      handler.install(monitor);

      // 模拟处理中再次触发错误
      let callCount = 0;
      (monitor.captureEvent as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // 在处理第一个错误时再触发一个
          const error = new Error('recursive');
          window.onerror!(error.message, '', 0, 0, error);
        }
      });

      const error = new Error('first');
      window.onerror!(error.message, '', 0, 0, error);

      // 只应处理第一个（递归的被 _isHandling 拦截）
      expect(callCount).toBe(1);
    });
  });

  // ────── 配置选项 ──────
  describe('配置选项', () => {
    it('可禁用资源错误捕获', () => {
      const noResourceHandler = new ErrorHandler({ captureResourceErrors: false });
      noResourceHandler.install(monitor);

      // 不应注册捕获阶段的 error 监听
      const errorCalls = addEventListenerSpy.mock.calls.filter(
        (call) => call[0] === 'error' && call[2] === true,
      );
      expect(errorCalls.length).toBe(0);

      noResourceHandler.uninstall();
    });
  });

  // ────── 访问器方法 ──────
  describe('访问器方法', () => {
    it('getBreadcrumbManager 应返回面包屑管理器', () => {
      const mgr = handler.getBreadcrumbManager();
      expect(mgr).toBeDefined();
      expect(typeof mgr.add).toBe('function');
      expect(typeof mgr.getAll).toBe('function');
    });

    it('getAggregator 应返回聚合器', () => {
      const agg = handler.getAggregator();
      expect(agg).toBeDefined();
      expect(typeof agg.generateFingerprint).toBe('function');
      expect(typeof agg.shouldReport).toBe('function');
    });
  });

  // ────── 资源错误捕获 ──────
  describe('资源错误捕获', () => {
    it('应捕获 img 资源加载错误', () => {
      handler.install(monitor);

      // 找到捕获阶段 error handler
      const resourceCall = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'error' && call[2] === true,
      );
      expect(resourceCall).toBeDefined();
      const resourceHandler = resourceCall![1] as (event: Event) => void;

      // 模拟 img 资源加载错误
      const imgEl = document.createElement('img');
      (imgEl as HTMLImageElement).src = 'http://example.com/broken.png';
      const event = new Event('error');
      Object.defineProperty(event, 'target', { value: imgEl });

      resourceHandler(event);

      expect(monitor.captureEvent).toHaveBeenCalledTimes(1);
      const captured = monitor.capturedEvents[0] as Record<string, unknown>;
      expect(captured.subType).toBe('resource_error');
      expect((captured.message as string)).toContain('broken.png');
    });

    it('应捕获 script 资源加载错误', () => {
      handler.install(monitor);

      const resourceCall = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'error' && call[2] === true,
      );
      const resourceHandler = resourceCall![1] as (event: Event) => void;

      const scriptEl = document.createElement('script');
      (scriptEl as HTMLScriptElement).src = 'http://example.com/broken.js';
      const event = new Event('error');
      Object.defineProperty(event, 'target', { value: scriptEl });

      resourceHandler(event);

      expect(monitor.captureEvent).toHaveBeenCalledTimes(1);
    });

    it('应忽略非资源元素的 error 事件', () => {
      handler.install(monitor);

      const resourceCall = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'error' && call[2] === true,
      );
      const resourceHandler = resourceCall![1] as (event: Event) => void;

      // div 不是资源元素
      const divEl = document.createElement('div');
      const event = new Event('error');
      Object.defineProperty(event, 'target', { value: divEl });

      resourceHandler(event);

      expect(monitor.captureEvent).not.toHaveBeenCalled();
    });

    it('应忽略 window 对象触发的 error 事件', () => {
      handler.install(monitor);

      const resourceCall = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'error' && call[2] === true,
      );
      const resourceHandler = resourceCall![1] as (event: Event) => void;

      const event = new Event('error');
      Object.defineProperty(event, 'target', { value: window });

      resourceHandler(event);

      expect(monitor.captureEvent).not.toHaveBeenCalled();
    });

    it('应忽略 target 为 null 的 error 事件', () => {
      handler.install(monitor);

      const resourceCall = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'error' && call[2] === true,
      );
      const resourceHandler = resourceCall![1] as (event: Event) => void;

      const event = new Event('error');
      Object.defineProperty(event, 'target', { value: null });

      resourceHandler(event);

      expect(monitor.captureEvent).not.toHaveBeenCalled();
    });
  });

  // ────── URL 忽略 ──────
  describe('URL 忽略 (ignoreUrls)', () => {
    it('应忽略匹配 ignoreUrls 字符串的资源错误', () => {
      const filteredHandler = new ErrorHandler({
        ignoreUrls: ['analytics.example.com'],
      });
      filteredHandler.install(monitor);

      const resourceCall = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'error' && call[2] === true,
      );
      const resourceHandler = resourceCall![1] as (event: Event) => void;

      const imgEl = document.createElement('img');
      (imgEl as HTMLImageElement).src = 'http://analytics.example.com/pixel.gif';
      const event = new Event('error');
      Object.defineProperty(event, 'target', { value: imgEl });

      resourceHandler(event);

      expect(monitor.captureEvent).not.toHaveBeenCalled();

      filteredHandler.uninstall();
    });

    it('应忽略匹配 ignoreUrls 正则的资源错误', () => {
      const filteredHandler = new ErrorHandler({
        ignoreUrls: [/\.tracking\./],
      });
      filteredHandler.install(monitor);

      const resourceCall = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'error' && call[2] === true,
      );
      const resourceHandler = resourceCall![1] as (event: Event) => void;

      const imgEl = document.createElement('img');
      (imgEl as HTMLImageElement).src = 'http://cdn.tracking.net/pixel.gif';
      const event = new Event('error');
      Object.defineProperty(event, 'target', { value: imgEl });

      resourceHandler(event);

      expect(monitor.captureEvent).not.toHaveBeenCalled();

      filteredHandler.uninstall();
    });
  });

  // ────── captureError 扩展 ──────
  describe('captureError 扩展', () => {
    it('应支持指定 subType', () => {
      handler.install(monitor);
      handler.captureError(new Error('Custom error'), 'unhandled_rejection');

      expect(monitor.captureEvent).toHaveBeenCalledTimes(1);
      const event = monitor.capturedEvents[0] as Record<string, unknown>;
      expect(event.subType).toBe('unhandled_rejection');
    });
  });

  // ────── Promise 拒绝: null/undefined reason ──────
  describe('Promise 拒绝 — 特殊 reason', () => {
    function createRejectionEvent(reason: unknown): Event {
      const event = new Event('unhandledrejection');
      (event as unknown as Record<string, unknown>).reason = reason;
      (event as unknown as Record<string, unknown>).promise = Promise.resolve();
      return event;
    }

    it('应处理 null reason', () => {
      handler.install(monitor);
      window.dispatchEvent(createRejectionEvent(null));

      expect(monitor.captureEvent).toHaveBeenCalledTimes(1);
      const event = monitor.capturedEvents[0] as Record<string, unknown>;
      expect(event.message).toContain('Unhandled Promise rejection');
    });

    it('应处理 undefined reason', () => {
      handler.install(monitor);
      window.dispatchEvent(createRejectionEvent(undefined));

      expect(monitor.captureEvent).toHaveBeenCalledTimes(1);
    });
  });

  // ────── uninstall 详细行为 ──────
  describe('uninstall 详细行为', () => {
    it('uninstall 应清空聚合器和面包屑', () => {
      handler.install(monitor);

      // 添加面包屑
      handler.getBreadcrumbManager().info('test message', 'test');

      // 触发一个错误以给聚合器添加记录
      handler.captureError(new Error('test'));

      // uninstall
      handler.uninstall();

      // 面包屑和聚合器应被清空
      expect(handler.getBreadcrumbManager().getAll().length).toBe(0);
    });

    it('uninstall 后不影响被第三方覆盖的 window.onerror', () => {
      handler.install(monitor);

      // 第三方覆盖了 window.onerror
      const thirdPartyHandler = () => {};
      window.onerror = thirdPartyHandler;

      handler.uninstall();

      // 不应清除第三方的 handler
      expect(window.onerror).toBe(thirdPartyHandler);
    });
  });
});
