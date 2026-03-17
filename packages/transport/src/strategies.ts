import { logger } from '@monitor/utils';

/**
 * 传输策略接口
 *
 * 每种策略实现统一的 send 接口，由 TransportEngine 按优先级调度。
 */
export interface SendStrategy {
  /** 策略名称 */
  readonly name: string;
  /** 检查当前环境是否支持此策略 */
  isAvailable(): boolean;
  /** 发送数据，返回是否成功 */
  send(url: string, data: string | Uint8Array, headers?: Record<string, string>): Promise<boolean>;
}

// ── Beacon 策略 ──

/**
 * navigator.sendBeacon 策略
 *
 * 优点：异步、不阻塞页面卸载、浏览器保证发送
 * 缺点：无法获取响应状态、Payload 限制 64KB
 */
export class BeaconStrategy implements SendStrategy {
  readonly name = 'beacon';

  isAvailable(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function';
  }

  async send(url: string, data: string | Uint8Array, headers?: Record<string, string>): Promise<boolean> {
    try {
      let blob: Blob;
      if (data instanceof Uint8Array) {
        blob = new Blob([data], {
          type: headers?.['Content-Type'] || 'application/octet-stream',
        });
      } else {
        blob = new Blob([data], {
          type: headers?.['Content-Type'] || 'application/json',
        });
      }
      return navigator.sendBeacon(url, blob);
    } catch (error) {
      logger.warn('[BeaconStrategy] sendBeacon failed:', error as Error);
      return false;
    }
  }
}

// ── Fetch 策略 ──

/**
 * Fetch API 策略
 *
 * 优点：支持自定义 Header、可获取响应、支持 keepalive
 * 缺点：部分浏览器 keepalive 有 64KB 限制
 */
export class FetchStrategy implements SendStrategy {
  readonly name = 'fetch';

  isAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.fetch === 'function';
  }

  async send(url: string, data: string | Uint8Array, headers?: Record<string, string>): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        body: data,
        headers: {
          'Content-Type': data instanceof Uint8Array
            ? 'application/octet-stream'
            : 'application/json',
          ...headers,
        },
        keepalive: true,
      });
      return response.ok;
    } catch (error) {
      logger.warn('[FetchStrategy] fetch failed:', error as Error);
      return false;
    }
  }
}

// ── XHR 策略 ──

/**
 * XMLHttpRequest 策略
 *
 * 优点：兼容性好、支持同步模式（卸载场景）
 * 缺点：API 较老、不支持 keepalive
 */
export class XHRStrategy implements SendStrategy {
  readonly name = 'xhr';

  /** 是否使用同步模式（仅在页面卸载时使用） */
  private sync: boolean;

  constructor(options?: { sync?: boolean }) {
    this.sync = options?.sync ?? false;
  }

  isAvailable(): boolean {
    return typeof XMLHttpRequest !== 'undefined';
  }

  async send(url: string, data: string | Uint8Array, headers?: Record<string, string>): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, !this.sync);

        // 设置默认 Content-Type
        const contentType = data instanceof Uint8Array
          ? 'application/octet-stream'
          : 'application/json';
        xhr.setRequestHeader('Content-Type', headers?.['Content-Type'] || contentType);

        // 设置自定义 headers
        if (headers) {
          for (const [key, value] of Object.entries(headers)) {
            if (key !== 'Content-Type') {
              xhr.setRequestHeader(key, value);
            }
          }
        }

        if (this.sync) {
          xhr.send(data instanceof Uint8Array ? new Blob([data]) : data);
          resolve(xhr.status >= 200 && xhr.status < 300);
        } else {
          xhr.onloadend = () => {
            resolve(xhr.status >= 200 && xhr.status < 300);
          };
          xhr.onerror = () => resolve(false);
          xhr.ontimeout = () => resolve(false);
          xhr.timeout = 10000;
          xhr.send(data instanceof Uint8Array ? new Blob([data]) : data);
        }
      } catch (error) {
        logger.warn('[XHRStrategy] XHR failed:', error as Error);
        resolve(false);
      }
    });
  }
}

// ── Image 策略 ──

/**
 * Image Ping 策略（最后手段）
 *
 * 优点：极简、跨域无限制
 * 缺点：只能 GET、无法发送大 Payload（URL 长度限制约 2KB）
 * 适用场景：发送一个简单的 "数据丢失" 通知
 */
export class ImageStrategy implements SendStrategy {
  readonly name = 'image';

  isAvailable(): boolean {
    return typeof Image !== 'undefined';
  }

  async send(url: string, data: string | Uint8Array): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        // 将数据编码为 URL 参数（截断以避免超长）
        const payload = typeof data === 'string' ? data : '';
        const truncated = payload.substring(0, 2000);
        const encodedData = encodeURIComponent(truncated);
        const separator = url.includes('?') ? '&' : '?';

        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = `${url}${separator}d=${encodedData}&t=${Date.now()}`;
      } catch (error) {
        logger.warn('[ImageStrategy] Image ping failed:', error as Error);
        resolve(false);
      }
    });
  }
}

// ── 策略工厂 ──

/** 默认策略优先级顺序 */
const DEFAULT_STRATEGY_ORDER = ['beacon', 'fetch', 'xhr', 'image'] as const;

/**
 * 创建策略实例
 */
export function createStrategy(name: string, options?: { sync?: boolean }): SendStrategy | null {
  switch (name) {
    case 'beacon': return new BeaconStrategy();
    case 'fetch': return new FetchStrategy();
    case 'xhr': return new XHRStrategy(options);
    case 'image': return new ImageStrategy();
    default: return null;
  }
}

/**
 * 创建默认策略列表（按优先级排序，过滤掉不可用的）
 */
export function createDefaultStrategies(): SendStrategy[] {
  return DEFAULT_STRATEGY_ORDER
    .map((name) => createStrategy(name))
    .filter((s): s is SendStrategy => s !== null && s.isAvailable());
}

/**
 * 使用降级策略发送数据
 *
 * 按优先级依次尝试各策略，直到成功或全部失败。
 */
export async function sendWithFallback(
  strategies: SendStrategy[],
  url: string,
  data: string | Uint8Array,
  headers?: Record<string, string>,
): Promise<{ success: boolean; strategy?: string }> {
  for (const strategy of strategies) {
    if (!strategy.isAvailable()) continue;

    const success = await strategy.send(url, data, headers);
    if (success) {
      return { success: true, strategy: strategy.name };
    }
    logger.debug(`[Transport] Strategy "${strategy.name}" failed, trying next...`);
  }

  return { success: false };
}
