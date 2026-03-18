import type { ErrorSubType, StackFrame, MonitorInterface, Breadcrumb } from '@monitor/types';
import { logger } from '@monitor/utils';

import { parseStack, extractStack } from './stack-parser';
import { ErrorAggregator, type AggregatorConfig } from './aggregator';
import { BreadcrumbManager, type BreadcrumbConfig } from './breadcrumb';
import { SourceMapResolver, type SourceMapConfig } from './source-map';

/**
 * 错误处理器
 *
 * 负责：
 * 1. 安装全局错误捕获（window.onerror / unhandledrejection / resource error）
 * 2. 将捕获到的原始错误转换为结构化的 ErrorEvent
 * 3. 通过 aggregator 做指纹去重
 * 4. 管理面包屑
 * 5. 最终调用 monitor.captureEvent 上报
 *
 * 自保护原则：
 * - 所有 handler 内部 try-catch 包裹，不向外抛出
 * - 防止因自身错误导致递归捕获（设置 _isHandling 标志位）
 */

export interface ErrorHandlerConfig {
  /** 聚合器配置 */
  aggregator?: AggregatorConfig;
  /** 面包屑配置 */
  breadcrumb?: BreadcrumbConfig;
  /** 忽略的错误消息正则 */
  ignoreErrors?: (string | RegExp)[];
  /** 忽略的 URL 正则（资源加载错误） */
  ignoreUrls?: (string | RegExp)[];
  /** 是否捕获未处理的 Promise 拒绝，默认 true */
  captureUnhandledRejections?: boolean;
  /** 是否捕获资源加载错误，默认 true */
  captureResourceErrors?: boolean;
  /** 最大堆栈帧数，默认 50 */
  maxFrames?: number;
  /** SourceMap 配置。设置后启用 SourceMap 反解 */
  sourceMap?: SourceMapConfig;
}

const DEFAULT_CONFIG: Required<ErrorHandlerConfig> = {
  aggregator: {},
  breadcrumb: {},
  ignoreErrors: [],
  ignoreUrls: [],
  captureUnhandledRejections: true,
  captureResourceErrors: true,
  maxFrames: 50,
  sourceMap: {},
};

export class ErrorHandler {
  private config: Required<ErrorHandlerConfig>;
  private aggregator: ErrorAggregator;
  private breadcrumbManager: BreadcrumbManager;
  private sourceMapResolver: SourceMapResolver | null = null;
  private monitor: MonitorInterface | null = null;

  /** 防止递归标志 */
  private _isHandling: boolean = false;

  // 保存原始 handler 引用，用于卸载
  private _onErrorHandler: OnErrorEventHandler | null = null;
  private _onUnhandledRejectionHandler: ((event: Event) => void) | null = null;
  private _onResourceErrorHandler: ((event: Event) => void) | null = null;

  constructor(config: ErrorHandlerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.aggregator = new ErrorAggregator(this.config.aggregator);
    this.breadcrumbManager = new BreadcrumbManager(this.config.breadcrumb);

    // 初始化 SourceMap 解析器（如果提供了配置）
    if (config.sourceMap) {
      this.sourceMapResolver = new SourceMapResolver(config.sourceMap);
    }
  }

  /**
   * 获取 SourceMap 解析器（供测试和高级用法）
   */
  getSourceMapResolver(): SourceMapResolver | null {
    return this.sourceMapResolver;
  }

  /**
   * 绑定 Monitor 实例，并安装全局错误捕获
   */
  install(monitor: MonitorInterface): void {
    this.monitor = monitor;

    // 监听面包屑事件（从 Core 统一分发）
    monitor.eventBus.on('breadcrumb:add', (data: unknown) => {
      const bc = data as Breadcrumb;
      this.breadcrumbManager.add(bc);
    });

    this.installGlobalHandlers();
  }

  /**
   * 卸载全局错误捕获
   */
  uninstall(): void {
    this.uninstallGlobalHandlers();
    this.monitor = null;
    this.aggregator.clear();
    this.breadcrumbManager.clear();
  }

  /**
   * 获取面包屑管理器（供外部访问）
   */
  getBreadcrumbManager(): BreadcrumbManager {
    return this.breadcrumbManager;
  }

  /**
   * 获取聚合器（供外部访问）
   */
  getAggregator(): ErrorAggregator {
    return this.aggregator;
  }

  /**
   * 手动捕获错误
   */
  captureError(error: Error | string, subType: ErrorSubType = 'js_error'): void {
    const err = typeof error === 'string' ? new Error(error) : error;
    this.handleError(err, subType);
  }

  // ────── 私有方法 ──────

  /**
   * 安装全局错误处理器
   */
  private installGlobalHandlers(): void {
    if (typeof window === 'undefined') return;

    // 1. window.onerror — 捕获同步 JS 运行时错误
    this._onErrorHandler = (
      message: string | Event,
      source?: string,
      lineno?: number,
      colno?: number,
      error?: Error,
    ) => {
      // 优先使用 error 对象（现代浏览器）
      if (error) {
        this.handleError(error, 'js_error');
      } else {
        // 降级：从 onerror 参数构造错误
        const syntheticError = new Error(typeof message === 'string' ? message : 'Unknown error');
        if (source) {
          syntheticError.stack = `Error: ${syntheticError.message}\n    at ${source}:${lineno || 0}:${colno || 0}`;
        }
        this.handleError(syntheticError, 'js_error');
      }
    };
    window.onerror = this._onErrorHandler;

    // 2. unhandledrejection — 捕获未处理的 Promise 拒绝
    if (this.config.captureUnhandledRejections) {
      this._onUnhandledRejectionHandler = (event: Event) => {
        const reason = (event as unknown as { reason: unknown }).reason;
        const error =
          reason instanceof Error ? reason : new Error(reason ? String(reason) : 'Unhandled Promise rejection');
        this.handleError(error, 'unhandled_rejection');
      };
      window.addEventListener('unhandledrejection', this._onUnhandledRejectionHandler);
    }

    // 3. 资源加载错误 — addEventListener('error', ..., true) 捕获阶段
    if (this.config.captureResourceErrors) {
      this._onResourceErrorHandler = (event: Event) => {
        // 只处理资源加载错误，跳过 JS 运行时错误（js 运行时错误由 onerror 处理）
        const target = event.target as HTMLElement | null;
        if (!target || target === window as unknown || !isResourceElement(target)) {
          return;
        }

        const tagName = target.tagName?.toLowerCase() || 'unknown';
        const src =
          (target as HTMLImageElement).src ||
          (target as HTMLLinkElement).href ||
          (target as HTMLScriptElement).src ||
          'unknown';

        // 检查是否在忽略列表中
        if (this.shouldIgnoreUrl(src)) return;

        const error = new Error(`Resource loading failed: <${tagName}> ${src}`);
        error.name = 'ResourceError';
        // 资源错误没有 JS 堆栈，构造一个位置信息
        error.stack = `ResourceError: ${error.message}\n    at ${src}:0:0`;

        this.handleError(error, 'resource_error');
      };
      window.addEventListener('error', this._onResourceErrorHandler, true);
    }
  }

  /**
   * 卸载全局错误处理器
   */
  private uninstallGlobalHandlers(): void {
    if (typeof window === 'undefined') return;

    if (this._onErrorHandler) {
      // 只有当前 handler 还是我们安装的才移除
      if (window.onerror === this._onErrorHandler) {
        window.onerror = null;
      }
      this._onErrorHandler = null;
    }

    if (this._onUnhandledRejectionHandler) {
      window.removeEventListener('unhandledrejection', this._onUnhandledRejectionHandler);
      this._onUnhandledRejectionHandler = null;
    }

    if (this._onResourceErrorHandler) {
      window.removeEventListener('error', this._onResourceErrorHandler, true);
      this._onResourceErrorHandler = null;
    }
  }

  /**
   * 核心错误处理流程
   */
  private handleError(error: Error, subType: ErrorSubType): void {
    // 防止递归
    if (this._isHandling) return;
    this._isHandling = true;

    try {
      // 1. 检查是否应忽略
      if (this.shouldIgnoreError(error.message)) return;

      // 2. 解析堆栈
      const stackString = extractStack(error);
      const frames = parseStack(stackString, this.config.maxFrames);

      // 3. 生成指纹
      const fingerprint = this.aggregator.generateFingerprint(error.name || 'Error', error.message, frames);

      // 4. 去重判断
      if (!this.aggregator.shouldReport(fingerprint)) return;

      // 5. 获取面包屑快照
      const breadcrumbs = this.breadcrumbManager.getAll();

      // 6. 添加面包屑（记录本次错误）
      this.breadcrumbManager.error(`${error.name}: ${error.message}`, 'error');

      // 7. 如果启用了 SourceMap，异步解析后上报；否则直接上报
      if (this.sourceMapResolver) {
        this.resolveAndReport({
          message: error.message,
          name: error.name,
          stack: stackString,
          frames,
          fingerprint,
          subType,
          breadcrumbs,
        });
      } else {
        this.reportError({
          message: error.message,
          name: error.name,
          stack: stackString,
          frames,
          fingerprint,
          subType,
          breadcrumbs,
        });
      }
    } catch (internalError) {
      // SDK 自身异常不应影响业务页面
      logger.error('[ErrorHandler] Internal error:', internalError as Error);
    } finally {
      this._isHandling = false;
    }
  }

  /**
   * 异步解析 SourceMap 后上报
   */
  private resolveAndReport(data: {
    message: string;
    name?: string;
    stack?: string;
    frames: StackFrame[];
    fingerprint: string;
    subType: ErrorSubType;
    breadcrumbs: Breadcrumb[];
  }): void {
    if (!this.sourceMapResolver) {
      this.reportError(data);
      return;
    }

    this.sourceMapResolver
      .resolveFrames(data.frames)
      .then((resolvedFrames) => {
        this.reportError({ ...data, frames: resolvedFrames });
      })
      .catch(() => {
        // SourceMap 解析失败，仍然使用原始帧上报
        this.reportError(data);
      });
  }

  /**
   * 上报错误到 Monitor
   */
  private reportError(data: {
    message: string;
    name?: string;
    stack?: string;
    frames: StackFrame[];
    fingerprint: string;
    subType: ErrorSubType;
    breadcrumbs: Breadcrumb[];
  }): void {
    if (!this.monitor) return;

    this.monitor.captureEvent({
      type: 'error',
      ...data,
      level: 'error',
    } as Partial<import('@monitor/types').BaseEvent>);
  }

  /**
   * 检查错误消息是否应忽略
   */
  private shouldIgnoreError(message: string): boolean {
    return this.config.ignoreErrors.some((pattern) => {
      if (typeof pattern === 'string') {
        return message.includes(pattern);
      }
      return pattern.test(message);
    });
  }

  /**
   * 检查 URL 是否应忽略
   */
  private shouldIgnoreUrl(url: string): boolean {
    return this.config.ignoreUrls.some((pattern) => {
      if (typeof pattern === 'string') {
        return url.includes(pattern);
      }
      return pattern.test(url);
    });
  }
}

/**
 * 判断元素是否为资源元素
 */
function isResourceElement(target: EventTarget): boolean {
  const el = target as HTMLElement;
  if (!el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return ['img', 'script', 'link', 'audio', 'video', 'source', 'object', 'embed'].includes(tag);
}
