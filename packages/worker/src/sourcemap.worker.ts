/**
 * SourceMap Worker — 在独立线程中执行 SourceMap 解析和帧映射
 *
 * 通信协议：
 * 主线程 → Worker:
 *   { id, type: 'resolve', payload: { frames: StackFrame[], sourceMapUrl: string, rawSourceMap?: string } }
 * Worker → 主线程:
 *   { id, result: { frames: ResolvedFrame[] } }
 *   | { id, error: string }
 *
 * 将 CPU 密集的 VLQ 解码和 SourceMap 解析移到 Worker 线程，
 * 避免阻塞主线程的用户交互。
 */

/**
 * Base64 VLQ 字符映射表
 */
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_MAP: Record<string, number> = {};
for (let i = 0; i < BASE64_CHARS.length; i++) {
  BASE64_MAP[BASE64_CHARS[i]] = i;
}

const VLQ_BASE_SHIFT = 5;
const VLQ_BASE_MASK = (1 << VLQ_BASE_SHIFT) - 1; // 31
const VLQ_CONTINUATION = 1 << VLQ_BASE_SHIFT; // 32

/**
 * 解码 VLQ 值
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
    if ((digit & VLQ_CONTINUATION) === 0) break;
    shift += VLQ_BASE_SHIFT;
  }

  const isNegative = (result & 1) === 1;
  result >>= 1;
  return [isNegative ? -result : result, pos - index];
}

interface MappingSegment {
  generatedColumn: number;
  sourceIndex: number;
  originalLine: number;
  originalColumn: number;
  nameIndex: number;
}

interface MappingLine {
  segments: MappingSegment[];
}

/**
 * 解析 SourceMap V3 mappings 字符串
 */
function parseMappings(mappings: string): MappingLine[] {
  const lines: MappingLine[] = [];
  const groups = mappings.split(';');

  let srcIdx = 0;
  let srcLine = 0;
  let srcCol = 0;
  let nameIdx = 0;

  for (const group of groups) {
    const line: MappingLine = { segments: [] };

    if (group.length === 0) {
      lines.push(line);
      continue;
    }

    let genCol = 0;
    const segmentStrs = group.split(',');

    for (const seg of segmentStrs) {
      let pos = 0;
      const fields: number[] = [];

      while (pos < seg.length) {
        const [value, consumed] = decodeVLQ(seg, pos);
        fields.push(value);
        pos += consumed;
      }

      if (fields.length >= 4) {
        genCol += fields[0];
        srcIdx += fields[1];
        srcLine += fields[2];
        srcCol += fields[3];

        const segment: MappingSegment = {
          generatedColumn: genCol,
          sourceIndex: srcIdx,
          originalLine: srcLine,
          originalColumn: srcCol,
          nameIndex: -1,
        };

        if (fields.length >= 5) {
          nameIdx += fields[4];
          segment.nameIndex = nameIdx;
        }

        line.segments.push(segment);
      } else if (fields.length >= 1) {
        genCol += fields[0];
      }
    }

    lines.push(line);
  }

  return lines;
}

/**
 * 二分查找最近的 segment
 */
function findSegment(
  parsedMappings: MappingLine[],
  line: number,
  column: number,
): MappingSegment | null {
  if (line < 0 || line >= parsedMappings.length) return null;
  const segments = parsedMappings[line].segments;
  if (segments.length === 0) return null;

  let lo = 0;
  let hi = segments.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].generatedColumn === column) return segments[mid];
    if (segments[mid].generatedColumn < column) lo = mid + 1;
    else hi = mid - 1;
  }

  return hi >= 0 ? segments[hi] : segments[0];
}

interface StackFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
}

interface ResolvedFrame extends StackFrame {
  originalFilename?: string;
  originalFunction?: string;
  originalLineno?: number;
  originalColno?: number;
  context?: {
    pre: string[];
    line: string;
    post: string[];
  };
}

interface RawSourceMap {
  version: number;
  sources: string[];
  names: string[];
  mappings: string;
  sourcesContent?: (string | null)[];
}

/**
 * 解析帧映射
 */
function resolveFrame(
  frame: StackFrame,
  sourceMap: RawSourceMap,
  parsedMappings: MappingLine[],
  contextLines: number = 5,
): ResolvedFrame {
  const resolved: ResolvedFrame = { ...frame };

  if (frame.lineno === undefined || frame.colno === undefined) {
    return resolved;
  }

  // SourceMap 使用 0-based 行号，堆栈使用 1-based
  const line0 = frame.lineno - 1;
  const col0 = frame.colno - 1;

  const segment = findSegment(parsedMappings, line0, col0);
  if (!segment) return resolved;

  resolved.originalLineno = segment.originalLine + 1; // 转回 1-based
  resolved.originalColno = segment.originalColumn + 1;

  if (segment.sourceIndex >= 0 && segment.sourceIndex < sourceMap.sources.length) {
    resolved.originalFilename = sourceMap.sources[segment.sourceIndex];
  }

  if (segment.nameIndex >= 0 && segment.nameIndex < sourceMap.names.length) {
    resolved.originalFunction = sourceMap.names[segment.nameIndex];
  }

  // 提取源码上下文
  if (
    resolved.originalFilename &&
    sourceMap.sourcesContent &&
    segment.sourceIndex >= 0 &&
    segment.sourceIndex < sourceMap.sourcesContent.length
  ) {
    const content = sourceMap.sourcesContent[segment.sourceIndex];
    if (content) {
      const lines = content.split('\n');
      const targetLine = segment.originalLine; // 0-based
      const start = Math.max(0, targetLine - contextLines);
      const end = Math.min(lines.length, targetLine + contextLines + 1);

      resolved.context = {
        pre: lines.slice(start, targetLine),
        line: lines[targetLine] || '',
        post: lines.slice(targetLine + 1, end),
      };
    }
  }

  return resolved;
}

/**
 * Worker 消息处理函数（可独立测试）
 */
export function handleSourceMapMessage(
  data: { id: number; type: string; payload: unknown },
): { id: number; result?: unknown; error?: string } {
  const { id, type, payload } = data;

  try {
    if (type === 'resolve') {
      const { frames, rawSourceMap } = payload as {
        frames: StackFrame[];
        rawSourceMap: string;
      };

      const sourceMap: RawSourceMap = JSON.parse(rawSourceMap);
      if (sourceMap.version !== 3) {
        return { id, error: 'Unsupported SourceMap version' };
      }

      const parsedMappings = parseMappings(sourceMap.mappings);

      const resolvedFrames = frames.map((frame) =>
        resolveFrame(frame, sourceMap, parsedMappings),
      );

      return {
        id,
        result: { frames: resolvedFrames },
      };
    }

    return {
      id,
      error: `Unknown sourcemap task type: ${type}`,
    };
  } catch (error) {
    return {
      id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// 导出解析函数供主线程降级使用
export { parseMappings, findSegment, resolveFrame };
export type { StackFrame, ResolvedFrame, RawSourceMap, MappingSegment, MappingLine };

/**
 * 在 Worker 全局上下文中注册 onmessage
 */
function initWorker(): void {
  if (
    typeof self !== 'undefined' &&
    typeof (self as unknown as { onmessage: unknown }).onmessage !== 'undefined'
  ) {
    self.onmessage = (event: MessageEvent) => {
      const response = handleSourceMapMessage(event.data);
      self.postMessage(response);
    };
  }
}

initWorker();
