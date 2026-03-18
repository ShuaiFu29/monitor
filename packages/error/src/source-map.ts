import type { StackFrame } from '@monitor/types';
import { logger } from '@monitor/utils';

/**
 * SourceMap JSON 结构（V3 版本）
 * @see https://sourcemaps.info/spec.html
 */
export interface RawSourceMap {
  version: number;
  sources: string[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: string;
  file?: string;
  sourceRoot?: string;
}

/**
 * 解码后的映射段
 */
interface MappingSegment {
  /** 生成文件中的列号 */
  generatedColumn: number;
  /** 源文件索引 */
  sourceIndex: number;
  /** 原始行号（0-based） */
  originalLine: number;
  /** 原始列号 */
  originalColumn: number;
  /** 名称索引 */
  nameIndex?: number;
}

/**
 * 解码后的行映射
 */
type MappingLine = MappingSegment[];

/**
 * SourceMap 解析结果
 */
interface ParsedSourceMap {
  raw: RawSourceMap;
  lines: MappingLine[];
}

/**
 * SourceMap 配置
 */
export interface SourceMapConfig {
  /** SourceMap 文件的 URL 模板，{url} 会被替换为原始文件 URL */
  urlTemplate?: string;
  /** 缓存最大条目数，默认 50 */
  maxCacheEntries?: number;
  /** 请求超时时间（ms），默认 5000 */
  fetchTimeout?: number;
  /** 上下文行数（错误行前后各取 N 行），默认 5 */
  contextLines?: number;
  /** 自定义 fetch 函数（用于 Node 环境或测试） */
  fetcher?: (url: string) => Promise<string>;
}

const DEFAULT_CONFIG: Required<SourceMapConfig> = {
  urlTemplate: '{url}.map',
  maxCacheEntries: 50,
  fetchTimeout: 5000,
  contextLines: 5,
  fetcher: defaultFetcher,
};

// ─── VLQ 解码 ───

const VLQ_BASE_SHIFT = 5;
const VLQ_BASE = 1 << VLQ_BASE_SHIFT; // 32
const VLQ_BASE_MASK = VLQ_BASE - 1;   // 0x1F
const VLQ_CONTINUATION = VLQ_BASE;    // 0x20

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_MAP: Record<string, number> = {};
for (let i = 0; i < BASE64_CHARS.length; i++) {
  BASE64_MAP[BASE64_CHARS[i]] = i;
}

/**
 * 解码 VLQ 编码的整数值
 * @returns [value, charsConsumed]
 */
function decodeVLQ(encoded: string, index: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = index;

  while (true) {
    if (pos >= encoded.length) {
      throw new Error('VLQ: unexpected end of input');
    }

    const digit = BASE64_MAP[encoded[pos]];
    if (digit === undefined) {
      throw new Error(`VLQ: invalid base64 char "${encoded[pos]}"`);
    }
    pos++;

    result |= (digit & VLQ_BASE_MASK) << shift;

    if ((digit & VLQ_CONTINUATION) === 0) {
      break;
    }
    shift += VLQ_BASE_SHIFT;
  }

  // 最低位是符号位
  const isNegative = (result & 1) === 1;
  result >>= 1;

  return [isNegative ? -result : result, pos - index];
}

/**
 * 解析 SourceMap mappings 字符串
 */
function parseMappings(mappings: string): MappingLine[] {
  const lines: MappingLine[] = [];
  const groups = mappings.split(';');

  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;

  for (const group of groups) {
    const line: MappingLine = [];

    if (group.length === 0) {
      lines.push(line);
      continue;
    }

    const segments = group.split(',');
    let generatedColumn = 0;

    for (const segmentStr of segments) {
      if (segmentStr.length === 0) continue;

      let pos = 0;
      const fields: number[] = [];

      while (pos < segmentStr.length) {
        const [value, consumed] = decodeVLQ(segmentStr, pos);
        fields.push(value);
        pos += consumed;
      }

      if (fields.length < 1) continue;

      generatedColumn += fields[0];

      const segment: MappingSegment = {
        generatedColumn,
        sourceIndex: 0,
        originalLine: 0,
        originalColumn: 0,
      };

      if (fields.length >= 4) {
        sourceIndex += fields[1];
        originalLine += fields[2];
        originalColumn += fields[3];

        segment.sourceIndex = sourceIndex;
        segment.originalLine = originalLine;
        segment.originalColumn = originalColumn;
      }

      if (fields.length >= 5) {
        nameIndex += fields[4];
        segment.nameIndex = nameIndex;
      }

      line.push(segment);
    }

    lines.push(line);
  }

  return lines;
}

/**
 * 在映射行中二分查找指定列号对应的段
 */
function findSegment(line: MappingLine, column: number): MappingSegment | null {
  if (line.length === 0) return null;

  let low = 0;
  let high = line.length - 1;

  // 二分查找最后一个 generatedColumn <= column 的段
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (line[mid].generatedColumn <= column) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return high >= 0 ? line[high] : line[0];
}

// ─── 默认 fetch 实现 ───

async function defaultFetcher(url: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── SourceMapResolver ───

/**
 * SourceMapResolver — SourceMap 加载、缓存、映射引擎
 *
 * 功能：
 * 1. 根据 JS 文件 URL 加载对应的 .map 文件
 * 2. 解析 VLQ 编码的 mappings，建立源码位置映射
 * 3. 将压缩后的行列号映射回原始源码位置
 * 4. 提取源码上下文（错误行前后 N 行）
 * 5. LRU 缓存已加载的 SourceMap
 */
export class SourceMapResolver {
  private config: Required<SourceMapConfig>;
  private cache: Map<string, ParsedSourceMap> = new Map();
  private pendingFetches: Map<string, Promise<ParsedSourceMap | null>> = new Map();

  constructor(config: SourceMapConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 解析堆栈帧数组 — 为每个帧添加原始源码位置
   *
   * @param frames - 待解析的堆栈帧
   * @returns 增强后的堆栈帧（包含 originalSource, originalLine 等）
   */
  async resolveFrames(frames: StackFrame[]): Promise<StackFrame[]> {
    const resolved: StackFrame[] = [];

    for (const frame of frames) {
      try {
        const resolvedFrame = await this.resolveFrame(frame);
        resolved.push(resolvedFrame);
      } catch {
        // 解析失败保留原始帧
        resolved.push(frame);
      }
    }

    return resolved;
  }

  /**
   * 解析单个堆栈帧
   */
  async resolveFrame(frame: StackFrame): Promise<StackFrame> {
    if (!frame.url || frame.resolved) {
      return frame;
    }

    const sourceMap = await this.loadSourceMap(frame.url);
    if (!sourceMap) {
      return frame;
    }

    // SourceMap 行列号是 0-based，StackFrame 的 line/column 是 1-based
    const line = frame.line - 1;
    const column = frame.column - 1;

    if (line < 0 || line >= sourceMap.lines.length) {
      return frame;
    }

    const mappingLine = sourceMap.lines[line];
    const segment = findSegment(mappingLine, column);
    if (!segment) {
      return frame;
    }

    const sourceIndex = segment.sourceIndex;
    const sources = sourceMap.raw.sources;
    const sourceRoot = sourceMap.raw.sourceRoot || '';

    if (sourceIndex < 0 || sourceIndex >= sources.length) {
      return frame;
    }

    const originalSource = sourceRoot + sources[sourceIndex];
    const originalLine = segment.originalLine + 1; // 转回 1-based
    const originalColumn = segment.originalColumn + 1;

    // 解析函数名
    let originalFunction = frame.function;
    if (segment.nameIndex !== undefined && segment.nameIndex < sourceMap.raw.names.length) {
      originalFunction = sourceMap.raw.names[segment.nameIndex];
    }

    // 提取源码上下文
    let context: StackFrame['context'];
    if (sourceMap.raw.sourcesContent) {
      const content = sourceMap.raw.sourcesContent[sourceIndex];
      if (content) {
        context = this.extractContext(content, segment.originalLine, this.config.contextLines);
      }
    }

    return {
      ...frame,
      resolved: true,
      originalSource,
      originalLine,
      originalColumn,
      originalFunction,
      context,
    };
  }

  /**
   * 加载并解析 SourceMap 文件
   */
  async loadSourceMap(jsUrl: string): Promise<ParsedSourceMap | null> {
    // 检查缓存
    const cached = this.cache.get(jsUrl);
    if (cached) {
      return cached;
    }

    // 检查是否有正在进行的请求（去重）
    const pending = this.pendingFetches.get(jsUrl);
    if (pending) {
      return pending;
    }

    const fetchPromise = this.doLoadSourceMap(jsUrl);
    this.pendingFetches.set(jsUrl, fetchPromise);

    try {
      const result = await fetchPromise;
      return result;
    } finally {
      this.pendingFetches.delete(jsUrl);
    }
  }

  /**
   * 手动注入 SourceMap（用于预加载或测试）
   */
  injectSourceMap(jsUrl: string, rawSourceMap: RawSourceMap): void {
    const parsed: ParsedSourceMap = {
      raw: rawSourceMap,
      lines: parseMappings(rawSourceMap.mappings),
    };
    this.addToCache(jsUrl, parsed);
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  // ─── 私有方法 ───

  /**
   * 实际加载 SourceMap 文件
   */
  private async doLoadSourceMap(jsUrl: string): Promise<ParsedSourceMap | null> {
    const mapUrl = this.config.urlTemplate.replace('{url}', jsUrl);

    try {
      const text = await this.config.fetcher(mapUrl);
      const rawMap: RawSourceMap = JSON.parse(text);

      if (rawMap.version !== 3) {
        logger.warn(`[SourceMap] Unsupported version: ${rawMap.version}`);
        return null;
      }

      const parsed: ParsedSourceMap = {
        raw: rawMap,
        lines: parseMappings(rawMap.mappings),
      };

      this.addToCache(jsUrl, parsed);
      return parsed;
    } catch (error) {
      logger.debug(`[SourceMap] Failed to load ${mapUrl}:`, error as Error);
      return null;
    }
  }

  /**
   * 添加到 LRU 缓存
   */
  private addToCache(key: string, value: ParsedSourceMap): void {
    // LRU 淘汰：超过上限时删除最早的条目
    if (this.cache.size >= this.config.maxCacheEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    // 删除旧的（如果存在），再添加到末尾（保持 LRU 顺序）
    this.cache.delete(key);
    this.cache.set(key, value);
  }

  /**
   * 提取源码上下文
   *
   * @param content - 源文件完整内容
   * @param line - 错误行号（0-based）
   * @param contextLines - 前后取 N 行
   */
  private extractContext(
    content: string,
    line: number,
    contextLines: number,
  ): StackFrame['context'] {
    const lines = content.split('\n');

    if (line < 0 || line >= lines.length) {
      return undefined;
    }

    const preStart = Math.max(0, line - contextLines);
    const postEnd = Math.min(lines.length, line + contextLines + 1);

    return {
      pre: lines.slice(preStart, line),
      line: lines[line],
      post: lines.slice(line + 1, postEnd),
    };
  }
}

// 导出辅助函数供测试使用
export { parseMappings, findSegment, decodeVLQ };
