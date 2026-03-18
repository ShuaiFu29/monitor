import type { Plugin, MonitorInterface } from '@monitor/types';
import { ErrorHandler, type ErrorHandlerConfig } from './error-handler';

/**
 * 错误监控插件
 *
 * 功能：
 * 1. 自动捕获 JS 运行时错误 (window.onerror)
 * 2. 自动捕获未处理的 Promise 拒绝 (unhandledrejection)
 * 3. 自动捕获资源加载错误 (<img>, <script>, <link> 等)
 * 4. 堆栈解析（Chrome/Firefox/Safari 三种格式）
 * 5. 错误指纹生成和去重
 * 6. 面包屑管理（环形缓冲）
 * 7. SDK 自保护（内部异常不崩溃业务页面）
 *
 * 用法：
 * ```ts
 * import { createMonitor } from '@monitor/browser';
 * import { errorPlugin } from '@monitor/error';
 *
 * const monitor = createMonitor({
 *   dsn: 'https://your-server.com/api/report',
 *   plugins: [errorPlugin()],
 * });
 * ```
 */

export type ErrorPluginConfig = ErrorHandlerConfig;

class ErrorPlugin implements Plugin {
  readonly name = '@monitor/error';
  readonly version = '0.1.0';

  private errorHandler: ErrorHandler;

  constructor(config: ErrorPluginConfig = {}) {
    this.errorHandler = new ErrorHandler(config);
  }

  /**
   * 插件安装 — 由 Core 的 PluginManager 调用
   */
  install(monitor: MonitorInterface): void {
    this.errorHandler.install(monitor);
  }

  /**
   * 插件卸载 — 由 Core 的 PluginManager 调用
   */
  uninstall(): void {
    this.errorHandler.uninstall();
  }

  /**
   * 手动捕获一个错误
   */
  captureError(error: Error | string): void {
    this.errorHandler.captureError(error);
  }

  /**
   * 获取错误处理器（用于测试和高级用法）
   */
  getErrorHandler(): ErrorHandler {
    return this.errorHandler;
  }
}

/**
 * 创建错误监控插件的工厂函数
 *
 * @param config - 插件配置
 * @returns ErrorPlugin 实例
 */
export function errorPlugin(config?: ErrorPluginConfig): ErrorPlugin {
  return new ErrorPlugin(config);
}

// 导出子模块供高级用户使用
export { ErrorHandler, type ErrorHandlerConfig } from './error-handler';
export { parseStack, extractStack, detectStackFormat } from './stack-parser';
export { ErrorAggregator, type AggregatorConfig } from './aggregator';
export { BreadcrumbManager, type BreadcrumbConfig } from './breadcrumb';
export { SourceMapResolver, type SourceMapConfig, type RawSourceMap } from './source-map';
