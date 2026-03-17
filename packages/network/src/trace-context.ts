import { generateId } from '@monitor/utils';

/**
 * 链路追踪上下文
 *
 * 为每个网络请求生成 traceId 和 spanId，
 * 并注入到请求 Header 中，实现前后端链路贯通。
 *
 * 遵循 W3C Trace Context 标准的简化版本：
 * - X-Trace-Id: 全局追踪 ID（整个页面会话内唯一）
 * - X-Span-Id: 单次请求的 Span ID
 * - traceparent: W3C 标准格式 (version-traceId-spanId-flags)
 */

export interface TraceConfig {
  /** 是否启用链路追踪，默认 true */
  enabled?: boolean;
  /** 自定义 header 名称映射 */
  headerNames?: {
    traceId?: string;
    spanId?: string;
    traceparent?: string;
  };
  /** 是否注入 W3C traceparent header，默认 true */
  useW3CFormat?: boolean;
  /** 需要注入追踪 header 的 URL 模式（不配置则全部注入） */
  traceUrls?: (string | RegExp)[];
}

const DEFAULT_CONFIG: Required<TraceConfig> = {
  enabled: true,
  headerNames: {
    traceId: 'X-Trace-Id',
    spanId: 'X-Span-Id',
    traceparent: 'traceparent',
  },
  useW3CFormat: true,
  traceUrls: [],
};

/**
 * 链路追踪上下文管理器
 */
export class TraceContext {
  private config: Required<TraceConfig>;
  /** 当前页面会话的 traceId（整个生命周期不变） */
  private readonly traceId: string;

  constructor(config: TraceConfig = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      headerNames: { ...DEFAULT_CONFIG.headerNames, ...config.headerNames },
    };
    this.traceId = generateTraceId();
  }

  /**
   * 获取当前 traceId
   */
  getTraceId(): string {
    return this.traceId;
  }

  /**
   * 为一次请求生成新的 spanId
   */
  generateSpanId(): string {
    return generateSpanId();
  }

  /**
   * 判断某个 URL 是否需要注入追踪 header
   */
  shouldTrace(url: string): boolean {
    if (!this.config.enabled) return false;

    // 如果没有配置 traceUrls，则全部注入
    if (this.config.traceUrls.length === 0) return true;

    return this.config.traceUrls.some((pattern) => {
      if (typeof pattern === 'string') {
        return url.includes(pattern);
      }
      return pattern.test(url);
    });
  }

  /**
   * 生成要注入到请求中的追踪 headers
   */
  createHeaders(url: string): Record<string, string> {
    if (!this.shouldTrace(url)) return {};

    const spanId = this.generateSpanId();
    const headers: Record<string, string> = {};
    const names = this.config.headerNames;

    if (names.traceId) {
      headers[names.traceId] = this.traceId;
    }
    if (names.spanId) {
      headers[names.spanId] = spanId;
    }
    if (this.config.useW3CFormat && names.traceparent) {
      // W3C traceparent: version-traceId-spanId-flags
      // version = 00, flags = 01 (sampled)
      headers[names.traceparent] = `00-${this.traceId}-${spanId}-01`;
    }

    return headers;
  }
}

// ── 辅助函数 ──

/**
 * 生成 32 字符的 traceId（模拟 128-bit hex）
 */
export function generateTraceId(): string {
  return hexRandom(16);
}

/**
 * 生成 16 字符的 spanId（模拟 64-bit hex）
 */
export function generateSpanId(): string {
  return hexRandom(8);
}

/**
 * 生成指定字节数的随机 hex 字符串
 */
function hexRandom(byteLength: number): string {
  const bytes = new Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    bytes[i] = Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0');
  }
  return bytes.join('');
}
