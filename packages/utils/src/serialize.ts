/**
 * 安全 JSON 序列化
 * 处理循环引用、BigInt、Error、RegExp 等特殊类型
 */
export function safeStringify(value: unknown, maxDepth: number = 10): string {
  const seen = new WeakSet();
  let currentDepth = 0;

  function replacer(key: string, val: unknown): unknown {
    // 处理特殊原始类型
    if (typeof val === 'bigint') {
      return val.toString();
    }

    if (val instanceof Error) {
      return {
        __type: 'Error',
        name: val.name,
        message: val.message,
        stack: val.stack,
      };
    }

    if (val instanceof RegExp) {
      return val.toString();
    }

    if (val instanceof Date) {
      return val.toISOString();
    }

    // 处理对象循环引用和深度限制
    if (val !== null && typeof val === 'object') {
      if (seen.has(val as object)) {
        return '[Circular]';
      }
      seen.add(val as object);

      // 深度跟踪：通过 key 存在来判断是否为嵌套调用
      if (key !== '') {
        currentDepth++;
        if (currentDepth > maxDepth) {
          currentDepth--;
          return '[Max Depth]';
        }
      }
    }

    return val;
  }

  try {
    const result = JSON.stringify(value, replacer);
    // JSON.stringify 对 undefined 返回 undefined，我们转换为字符串
    return result === undefined ? 'undefined' : result;
  } catch {
    return String(value);
  }
}

/**
 * 安全 JSON 解析
 */
export function safeParse<T = unknown>(json: string, fallback?: T): T | undefined {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * 截断字符串到指定长度
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * 深度克隆 (结构化克隆)
 * 优先使用 structuredClone，不支持时降级为 JSON
 */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // structuredClone 不支持某些类型（如 function），降级
    }
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}
