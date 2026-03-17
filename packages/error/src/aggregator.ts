import type { StackFrame } from '@monitor/types';
import { hashString } from '@monitor/utils';

/**
 * 错误聚合器
 *
 * 职责：
 * 1. 基于错误类型 + 消息 + 堆栈位置生成稳定指纹 (fingerprint)
 * 2. 跟踪错误出现频次，实现去重计数
 * 3. 防止相同错误重复上报（可配置时间窗口）
 *
 * 指纹生成策略：
 * - 取错误名 (e.g. TypeError)
 * - 取错误消息 (e.g. Cannot read property 'x' of undefined)
 * - 取栈顶 N 帧的 url + line + column + function
 * - 对以上组合做 hash → 指纹
 */

/** 错误聚合统计 */
interface ErrorStats {
  /** 首次出现时间 */
  firstSeen: number;
  /** 最后出现时间 */
  lastSeen: number;
  /** 出现次数 */
  count: number;
}

/**
 * 错误聚合器配置
 */
export interface AggregatorConfig {
  /** 用于指纹计算的栈帧数量，默认 5 */
  fingerprintFrames?: number;
  /** 去重时间窗口 (ms)，同一指纹在此窗口内不重复上报，默认 60000 (1min) */
  dedupeInterval?: number;
  /** 最大跟踪指纹数，防止内存溢出，默认 200 */
  maxTracked?: number;
}

const DEFAULT_CONFIG: Required<AggregatorConfig> = {
  fingerprintFrames: 5,
  dedupeInterval: 60_000,
  maxTracked: 200,
};

export class ErrorAggregator {
  private config: Required<AggregatorConfig>;
  private stats: Map<string, ErrorStats> = new Map();

  constructor(config: AggregatorConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 生成错误指纹
   *
   * @param name - 错误名称 (e.g. "TypeError")
   * @param message - 错误消息
   * @param frames - 解析后的堆栈帧
   * @returns 指纹字符串
   */
  generateFingerprint(name: string, message: string, frames: StackFrame[]): string {
    const parts: string[] = [name || 'Error'];

    // 标准化消息：移除动态部分（数字、地址等）
    const normalizedMessage = normalizeMessage(message);
    parts.push(normalizedMessage);

    // 取栈顶 N 帧的关键位置信息
    const topFrames = frames.slice(0, this.config.fingerprintFrames);
    for (const frame of topFrames) {
      // 使用 function + url 的最后部分 + line
      // 不用 column（column 因 minify 差异变化太大）
      const urlPart = extractFileName(frame.url);
      parts.push(`${frame.function || '<anonymous>'}@${urlPart}:${frame.line}`);
    }

    return hashString(parts.join('|'));
  }

  /**
   * 判断该错误是否应被上报（去重）
   *
   * @returns true 表示应上报，false 表示应丢弃（重复）
   */
  shouldReport(fingerprint: string): boolean {
    const now = Date.now();
    const existing = this.stats.get(fingerprint);

    if (existing) {
      // 在去重窗口内
      if (now - existing.lastSeen < this.config.dedupeInterval) {
        existing.lastSeen = now;
        existing.count++;
        return false;
      }
      // 超出窗口，重置计数
      existing.lastSeen = now;
      existing.count = 1;
      return true;
    }

    // 新错误
    this.trackFingerprint(fingerprint, now);
    return true;
  }

  /**
   * 获取某个指纹的统计信息
   */
  getStats(fingerprint: string): ErrorStats | undefined {
    return this.stats.get(fingerprint);
  }

  /**
   * 获取当前跟踪的指纹总数
   */
  getTrackedCount(): number {
    return this.stats.size;
  }

  /**
   * 清空所有统计数据
   */
  clear(): void {
    this.stats.clear();
  }

  /**
   * 记录指纹，超容量时清理最旧条目
   */
  private trackFingerprint(fingerprint: string, now: number): void {
    // 容量控制：超出时移除最旧的
    if (this.stats.size >= this.config.maxTracked) {
      this.evictOldest();
    }

    this.stats.set(fingerprint, {
      firstSeen: now,
      lastSeen: now,
      count: 1,
    });
  }

  /**
   * 淘汰最旧的条目（基于 lastSeen）
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, stats] of this.stats) {
      if (stats.lastSeen < oldestTime) {
        oldestTime = stats.lastSeen;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.stats.delete(oldestKey);
    }
  }
}

/**
 * 标准化错误消息
 * - 移除动态数字（内存地址、端口号等）
 * - 移除行内 URL 的路径参数变化部分
 * - 保留核心语义
 */
function normalizeMessage(message: string): string {
  if (!message) return '';
  return message
    // 将十六进制地址替换为占位符
    .replace(/0x[0-9a-fA-F]+/g, '0x<addr>')
    // 将纯数字替换为占位符（保留紧跟在字母后的数字，如 "utf8"）
    .replace(/(?<![a-zA-Z])\d+(?![a-zA-Z])/g, '<n>')
    // 移除多余空格
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 从 URL 中提取文件名（最后一段路径）
 * e.g. "https://cdn.example.com/assets/app.a1b2c3.js" → "app.a1b2c3.js"
 */
function extractFileName(url: string): string {
  if (!url) return '<unknown>';
  try {
    // 移除查询参数和 hash
    const cleaned = url.split('?')[0].split('#')[0];
    const segments = cleaned.split('/');
    return segments[segments.length - 1] || '<unknown>';
  } catch {
    return '<unknown>';
  }
}
