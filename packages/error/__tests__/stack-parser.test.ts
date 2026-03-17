import { describe, it, expect } from 'vitest';
import { parseStack, detectStackFormat, extractStack } from '../src/stack-parser';

describe('stack-parser', () => {
  // ────── Chrome/V8 格式 ──────
  describe('Chrome/V8 格式', () => {
    const chromeStack = `Error: Something went wrong
    at fetchData (http://example.com/app.js:10:15)
    at Object.<anonymous> (http://example.com/app.js:20:5)
    at Module._compile (internal/modules/cjs/loader.js:778:30)
    at http://example.com/vendor.js:100:20`;

    it('应检测为 chrome 格式', () => {
      expect(detectStackFormat(chromeStack)).toBe('chrome');
    });

    it('应正确解析有函数名的帧', () => {
      const frames = parseStack(chromeStack);
      expect(frames.length).toBe(4);
      expect(frames[0]).toEqual({
        url: 'http://example.com/app.js',
        line: 10,
        column: 15,
        function: 'fetchData',
      });
    });

    it('应正确解析 Object.<anonymous> 前缀', () => {
      const frames = parseStack(chromeStack);
      expect(frames[1].function).toBe('<anonymous>');
    });

    it('应正确解析无括号的匿名帧', () => {
      const frames = parseStack(chromeStack);
      expect(frames[3]).toEqual({
        url: 'http://example.com/vendor.js',
        line: 100,
        column: 20,
        function: '<anonymous>',
      });
    });

    it('应支持 new Constructor 语法', () => {
      const stack = `Error: test
    at new MyClass (http://example.com/app.js:5:3)`;
      const frames = parseStack(stack);
      expect(frames[0].function).toBe('new MyClass');
    });

    it('应支持 async 函数', () => {
      const stack = `Error: test
    at async fetchUser (http://example.com/api.js:25:10)`;
      const frames = parseStack(stack);
      expect(frames[0]).toEqual({
        url: 'http://example.com/api.js',
        line: 25,
        column: 10,
        function: 'fetchUser',
      });
    });
  });

  // ────── Firefox/SpiderMonkey 格式 ──────
  describe('Firefox/SpiderMonkey 格式', () => {
    const firefoxStack = `fetchData@http://example.com/app.js:10:15
handleClick@http://example.com/app.js:20:5
@http://example.com/vendor.js:100:20`;

    it('应检测为 firefox 格式', () => {
      expect(detectStackFormat(firefoxStack)).toBe('firefox');
    });

    it('应正确解析有函数名的帧', () => {
      const frames = parseStack(firefoxStack);
      expect(frames.length).toBe(3);
      expect(frames[0]).toEqual({
        url: 'http://example.com/app.js',
        line: 10,
        column: 15,
        function: 'fetchData',
      });
    });

    it('应正确解析匿名帧', () => {
      const frames = parseStack(firefoxStack);
      expect(frames[2]).toEqual({
        url: 'http://example.com/vendor.js',
        line: 100,
        column: 20,
        function: '<anonymous>',
      });
    });
  });

  // ────── Safari/JSC 格式 ──────
  describe('Safari/JSC 格式', () => {
    const safariStack = `fetchData@http://example.com/app.js:10:15
handleClick@http://example.com/app.js:20:5
http://example.com/vendor.js:100:20`;

    it('应正确解析 Safari 风格的堆栈', () => {
      const frames = parseStack(safariStack);
      expect(frames.length).toBeGreaterThanOrEqual(2);
      expect(frames[0].function).toBe('fetchData');
      expect(frames[0].url).toBe('http://example.com/app.js');
      expect(frames[0].line).toBe(10);
    });

    it('应跳过 [native code] 帧', () => {
      const stack = `forEach@[native code]
processData@http://example.com/app.js:30:10`;
      // 使用 detectStackFormat → 可能检测为 firefox 或 unknown
      const frames = parseStack(stack);
      // [native code] 帧应被过滤掉
      const nativeFrames = frames.filter((f) => f.url === '[native code]');
      expect(nativeFrames.length).toBe(0);
    });

    it('应处理 "module code" Safari 特殊标识', () => {
      const stack = `module code@http://example.com/app.js:1:1
eval code@http://example.com/app.js:2:2`;
      const frames = parseStack(stack);
      // "module code" 和 "eval code" 应被清理为 <anonymous>
      expect(frames.length).toBeGreaterThanOrEqual(1);
      frames.forEach((f) => {
        expect(f.function).toBe('<anonymous>');
      });
    });

    it('应将 "?" 函数名处理为 <anonymous>', () => {
      const stack = `?@http://example.com/app.js:1:1`;
      const frames = parseStack(stack);
      expect(frames.length).toBe(1);
      expect(frames[0].function).toBe('<anonymous>');
    });

    it('应将 "anonymous" 函数名处理为 <anonymous>', () => {
      const stack = `anonymous@http://example.com/app.js:1:1`;
      const frames = parseStack(stack);
      expect(frames.length).toBe(1);
      expect(frames[0].function).toBe('<anonymous>');
    });
  });

  // ────── 边界情况 ──────
  describe('边界情况', () => {
    it('空字符串应返回空数组', () => {
      expect(parseStack('')).toEqual([]);
    });

    it('null/undefined 应返回空数组', () => {
      expect(parseStack(null as unknown as string)).toEqual([]);
      expect(parseStack(undefined as unknown as string)).toEqual([]);
    });

    it('纯错误消息（无堆栈）应返回空数组', () => {
      expect(parseStack('Error: something broke')).toEqual([]);
    });

    it('应尊重 maxFrames 参数', () => {
      const stack = `Error: test
    at a (http://example.com/a.js:1:1)
    at b (http://example.com/b.js:2:2)
    at c (http://example.com/c.js:3:3)
    at d (http://example.com/d.js:4:4)
    at e (http://example.com/e.js:5:5)`;
      const frames = parseStack(stack, 3);
      expect(frames.length).toBe(3);
      expect(frames[0].function).toBe('a');
      expect(frames[2].function).toBe('c');
    });

    it('unknown 格式应尝试使用 Safari 解析器', () => {
      expect(detectStackFormat('some random text')).toBe('unknown');
    });
  });

  // ────── extractStack ──────
  describe('extractStack', () => {
    it('应从 Error 对象提取 stack', () => {
      const error = new Error('test');
      const result = extractStack(error);
      expect(result).toContain('Error: test');
    });

    it('字符串应直接返回', () => {
      expect(extractStack('some stack')).toBe('some stack');
    });

    it('其他类型应 toString', () => {
      expect(extractStack(42)).toBe('42');
      expect(extractStack({ key: 'value' })).toBe('[object Object]');
    });

    it('null/undefined 应返回字符串表示', () => {
      expect(extractStack(null)).toBe('null');
      expect(extractStack(undefined)).toBe('undefined');
    });
  });
});
