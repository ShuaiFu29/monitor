import type { StackFrame } from '@monitor/types';

/**
 * 堆栈解析器
 *
 * 支持 Chrome/Edge (V8)、Firefox (SpiderMonkey)、Safari (JavaScriptCore) 三种
 * 主流浏览器引擎的堆栈格式，将原始 Error.stack 字符串解析为结构化的 StackFrame 数组。
 *
 * 格式示例：
 *
 * Chrome/Edge:
 *   at functionName (http://example.com/file.js:10:5)
 *   at http://example.com/file.js:10:5
 *   at Object.<anonymous> (http://example.com/file.js:10:5)
 *   at new Constructor (http://example.com/file.js:10:5)
 *   at async functionName (http://example.com/file.js:10:5)
 *
 * Firefox:
 *   functionName@http://example.com/file.js:10:5
 *   @http://example.com/file.js:10:5
 *
 * Safari:
 *   functionName@http://example.com/file.js:10:5
 *   module code@http://example.com/file.js:10:5
 *   eval code@[native code]
 */

// ── Chrome/V8 格式 ──
// 匹配：at [async] functionName (url:line:col) 或 at url:line:col
const CHROME_REGEX =
  /^\s*at\s+(?:async\s+)?(?:(new\s+)?(.+?)\s+\((.+?):(\d+):(\d+)\)|(.+?):(\d+):(\d+))\s*$/;

// ── Firefox/SpiderMonkey 格式 ──
// 匹配：functionName@url:line:col
const FIREFOX_REGEX = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/;

// ── Safari/JSC 格式（与 Firefox 类似，但 anonymous 函数有不同表示） ──
// Safari 可能有 "module code@..." 或 "eval code@..." 等特殊标识
const SAFARI_REGEX = /^\s*(?:([^@]*)@)?(.+?):(\d+):(\d+)\s*$/;

/**
 * 检测堆栈字符串属于哪种浏览器引擎格式
 */
export function detectStackFormat(stack: string): 'chrome' | 'firefox' | 'safari' | 'unknown' {
  const lines = stack.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Error') || trimmed.startsWith('TypeError')) {
      continue;
    }
    if (trimmed.startsWith('at ')) {
      return 'chrome';
    }
    if (FIREFOX_REGEX.test(trimmed)) {
      return 'firefox';
    }
  }

  return 'unknown';
}

/**
 * 解析 Chrome/V8 格式的堆栈行
 */
function parseChromeFrame(line: string): StackFrame | null {
  const match = CHROME_REGEX.exec(line);
  if (!match) return null;

  // 有括号形式: at [new] functionName (url:line:col)
  if (match[3]) {
    const isNew = !!match[1];
    const funcName = match[2];
    return {
      url: match[3],
      line: parseInt(match[4], 10),
      column: parseInt(match[5], 10),
      function: isNew ? `new ${funcName}` : cleanFunctionName(funcName),
    };
  }

  // 无括号形式: at url:line:col
  if (match[6]) {
    return {
      url: match[6],
      line: parseInt(match[7], 10),
      column: parseInt(match[8], 10),
      function: '<anonymous>',
    };
  }

  return null;
}

/**
 * 解析 Firefox 格式的堆栈行
 */
function parseFirefoxFrame(line: string): StackFrame | null {
  const match = FIREFOX_REGEX.exec(line);
  if (!match) return null;

  return {
    url: match[2],
    line: parseInt(match[3], 10),
    column: parseInt(match[4], 10),
    function: cleanFunctionName(match[1]) || '<anonymous>',
  };
}

/**
 * 解析 Safari 格式的堆栈行
 */
function parseSafariFrame(line: string): StackFrame | null {
  const match = SAFARI_REGEX.exec(line);
  if (!match) return null;

  const funcName = match[1];
  const url = match[2];

  // 跳过 [native code] 等内置引用
  if (url === '[native code]') return null;

  return {
    url,
    line: parseInt(match[3], 10),
    column: parseInt(match[4], 10),
    function: cleanFunctionName(funcName) || '<anonymous>',
  };
}

/**
 * 清理函数名
 * - 移除 "Object." 前缀
 * - 移除 "module code" 等 Safari 特殊标识
 * - 空值或 "?" 统一为 undefined（由外层设为 <anonymous>）
 */
function cleanFunctionName(name: string | undefined): string | undefined {
  if (!name || name === '?' || name === 'anonymous') return undefined;

  // 移除 "Object." 前缀 (Chrome)
  let cleaned = name.replace(/^Object\./, '');

  // 移除 "module code"/"eval code" 等 Safari 标识
  cleaned = cleaned.replace(/^(module|eval)\s+code$/, '');

  return cleaned || undefined;
}

/**
 * 解析错误堆栈字符串为结构化帧数组
 *
 * @param stack - Error.stack 原始字符串
 * @param maxFrames - 最大解析帧数，默认 50
 * @returns 解析后的 StackFrame 数组（从栈顶到栈底）
 */
export function parseStack(stack: string, maxFrames: number = 50): StackFrame[] {
  if (!stack || typeof stack !== 'string') return [];

  const format = detectStackFormat(stack);
  const lines = stack.split('\n');
  const frames: StackFrame[] = [];

  let parser: (line: string) => StackFrame | null;

  switch (format) {
    case 'chrome':
      parser = parseChromeFrame;
      break;
    case 'firefox':
      parser = parseFirefoxFrame;
      break;
    case 'safari':
    default:
      // Safari 和 unknown 都尝试使用 Safari 解析器（兼容 Firefox 格式）
      parser = parseSafariFrame;
      break;
  }

  for (const line of lines) {
    if (frames.length >= maxFrames) break;

    const trimmed = line.trim();
    // 跳过空行和错误消息行
    if (!trimmed || /^[\w]*Error:?\s/.test(trimmed)) continue;

    const frame = parser(trimmed);
    if (frame) {
      frames.push(frame);
    }
  }

  return frames;
}

/**
 * 从 Error 对象或字符串提取堆栈
 */
export function extractStack(error: unknown): string {
  if (error instanceof Error && error.stack) {
    return error.stack;
  }

  if (typeof error === 'string') {
    return error;
  }

  // 尝试 toString
  try {
    return String(error);
  } catch {
    return '<unknown error>';
  }
}
