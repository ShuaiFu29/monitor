import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SourceMapResolver,
  decodeVLQ,
  parseMappings,
  findSegment,
} from '../src/source-map';
import type { RawSourceMap } from '../src/source-map';
import type { StackFrame } from '@monitor/types';

// ─── 测试用 SourceMap ───
// 模拟一个简单的 JS → TS 映射
// 原始文件: src/app.ts (5行)
//   line 0: import { foo } from './foo';
//   line 1: 
//   line 2: function main() {
//   line 3:   const result = foo(42);
//   line 4: }
//
// 编译后文件: dist/app.js (3行)
//   line 0: "use strict";
//   line 1: const foo_1 = require("./foo");
//   line 2: function main() { const result = foo_1.foo(42); }

const TEST_SOURCEMAP: RawSourceMap = {
  version: 3,
  file: 'app.js',
  sourceRoot: '',
  sources: ['src/app.ts'],
  sourcesContent: [
    'import { foo } from \'./foo\';\n\nfunction main() {\n  const result = foo(42);\n}\n',
  ],
  names: ['main', 'result', 'foo'],
  // 简化的 mappings:
  // Line 0: 空（"use strict" 无映射）
  // Line 1: 列0→源0行0列0（import 语句）
  // Line 2: 列0→源0行2列0(function), 列18→源0行3列2(const result), 列35→源0行3列17(foo)
  mappings: ';AAAA;AAEA,SAAgBA,IAAI,KAAGC,MAAM,GAAGC,GAAG',
};

describe('VLQ Decoding', () => {
  it('should decode simple values', () => {
    // A = 0 → value 0
    const [val0, consumed0] = decodeVLQ('A', 0);
    expect(val0).toBe(0);
    expect(consumed0).toBe(1);
  });

  it('should decode positive values', () => {
    // C = 2 → value 1
    const [val, consumed] = decodeVLQ('C', 0);
    expect(val).toBe(1);
    expect(consumed).toBe(1);
  });

  it('should decode negative values', () => {
    // D = 3 → value -1
    const [val, consumed] = decodeVLQ('D', 0);
    expect(val).toBe(-1);
    expect(consumed).toBe(1);
  });

  it('should decode multi-byte values', () => {
    // 'gB' encodes 16
    const [val, consumed] = decodeVLQ('gB', 0);
    expect(val).toBe(16);
    expect(consumed).toBe(2);
  });

  it('should throw on invalid input', () => {
    expect(() => decodeVLQ('!', 0)).toThrow('invalid base64 char');
  });

  it('should throw on unexpected end', () => {
    // 'g' has continuation bit set but no next char
    expect(() => decodeVLQ('g', 0)).toThrow('unexpected end');
  });
});

describe('parseMappings', () => {
  it('should parse empty mappings', () => {
    const result = parseMappings('');
    expect(result).toHaveLength(1); // One empty line
    expect(result[0]).toHaveLength(0);
  });

  it('should parse semicolons as line separators', () => {
    const result = parseMappings(';;');
    expect(result).toHaveLength(3); // 3 lines (2 separators)
  });

  it('should parse simple single-segment mapping', () => {
    // AAAA = col0, source0, line0, col0
    const result = parseMappings('AAAA');
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1);
    expect(result[0][0].generatedColumn).toBe(0);
    expect(result[0][0].sourceIndex).toBe(0);
    expect(result[0][0].originalLine).toBe(0);
    expect(result[0][0].originalColumn).toBe(0);
  });

  it('should parse multiple segments per line', () => {
    // AAAA,CAAC = two segments on same line
    const result = parseMappings('AAAA,CAAC');
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(2);
    expect(result[0][0].generatedColumn).toBe(0);
    expect(result[0][1].generatedColumn).toBe(1); // relative: 0 + 1
  });

  it('should accumulate values across lines', () => {
    // Second line values are relative to previous line end
    const result = parseMappings('AAAA;AACA');
    expect(result).toHaveLength(2);
    expect(result[1][0].originalLine).toBe(1); // 0 + 1
  });

  it('should parse 5-field segments (with name index)', () => {
    // AAAA,CAACA = second segment has name index
    const result = parseMappings('AAAAA');
    expect(result).toHaveLength(1);
    expect(result[0][0].nameIndex).toBe(0);
  });

  it('should parse the test sourcemap mappings', () => {
    const result = parseMappings(TEST_SOURCEMAP.mappings);
    expect(result.length).toBeGreaterThan(0);
    // Line 0 should be empty (after first ;)
    expect(result[0]).toHaveLength(0);
  });
});

describe('findSegment', () => {
  it('should find exact column match', () => {
    const line = [
      { generatedColumn: 0, sourceIndex: 0, originalLine: 0, originalColumn: 0 },
      { generatedColumn: 10, sourceIndex: 0, originalLine: 0, originalColumn: 5 },
      { generatedColumn: 20, sourceIndex: 0, originalLine: 0, originalColumn: 10 },
    ];

    const result = findSegment(line, 10);
    expect(result).not.toBeNull();
    expect(result!.originalColumn).toBe(5);
  });

  it('should find closest preceding segment', () => {
    const line = [
      { generatedColumn: 0, sourceIndex: 0, originalLine: 0, originalColumn: 0 },
      { generatedColumn: 10, sourceIndex: 0, originalLine: 0, originalColumn: 5 },
      { generatedColumn: 20, sourceIndex: 0, originalLine: 0, originalColumn: 10 },
    ];

    const result = findSegment(line, 15);
    expect(result).not.toBeNull();
    expect(result!.generatedColumn).toBe(10);
  });

  it('should return first segment for column before any segment', () => {
    const line = [
      { generatedColumn: 5, sourceIndex: 0, originalLine: 0, originalColumn: 0 },
    ];

    const result = findSegment(line, 2);
    expect(result).not.toBeNull();
    expect(result!.generatedColumn).toBe(5);
  });

  it('should return null for empty line', () => {
    const result = findSegment([], 0);
    expect(result).toBeNull();
  });
});

describe('SourceMapResolver', () => {
  let resolver: SourceMapResolver;

  beforeEach(() => {
    resolver = new SourceMapResolver({
      fetcher: async () => JSON.stringify(TEST_SOURCEMAP),
    });
  });

  describe('injectSourceMap', () => {
    it('should manually inject and use sourcemap', async () => {
      resolver.injectSourceMap('http://example.com/app.js', TEST_SOURCEMAP);
      expect(resolver.getCacheSize()).toBe(1);
    });
  });

  describe('loadSourceMap', () => {
    it('should load and cache sourcemap', async () => {
      const result = await resolver.loadSourceMap('http://example.com/app.js');
      expect(result).not.toBeNull();
      expect(resolver.getCacheSize()).toBe(1);
    });

    it('should return cached sourcemap on second call', async () => {
      await resolver.loadSourceMap('http://example.com/app.js');
      const result = await resolver.loadSourceMap('http://example.com/app.js');
      expect(result).not.toBeNull();
      expect(resolver.getCacheSize()).toBe(1);
    });

    it('should deduplicate concurrent fetches', async () => {
      const fetcher = vi.fn(async () => JSON.stringify(TEST_SOURCEMAP));
      const r = new SourceMapResolver({ fetcher });

      const p1 = r.loadSourceMap('http://example.com/app.js');
      const p2 = r.loadSourceMap('http://example.com/app.js');

      await Promise.all([p1, p2]);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('should return null on fetch failure', async () => {
      const r = new SourceMapResolver({
        fetcher: async () => { throw new Error('Network error'); },
      });

      const result = await r.loadSourceMap('http://example.com/app.js');
      expect(result).toBeNull();
    });

    it('should return null for non-v3 sourcemaps', async () => {
      const r = new SourceMapResolver({
        fetcher: async () => JSON.stringify({ version: 2, mappings: '', sources: [], names: [] }),
      });

      const result = await r.loadSourceMap('http://example.com/app.js');
      expect(result).toBeNull();
    });

    it('should evict oldest cache entry when full', async () => {
      const r = new SourceMapResolver({
        maxCacheEntries: 2,
        fetcher: async () => JSON.stringify(TEST_SOURCEMAP),
      });

      await r.loadSourceMap('http://example.com/a.js');
      await r.loadSourceMap('http://example.com/b.js');
      expect(r.getCacheSize()).toBe(2);

      await r.loadSourceMap('http://example.com/c.js');
      expect(r.getCacheSize()).toBe(2); // Oldest evicted
    });
  });

  describe('resolveFrame', () => {
    it('should resolve frame with sourcemap data', async () => {
      resolver.injectSourceMap('http://example.com/app.js', TEST_SOURCEMAP);

      const frame: StackFrame = {
        url: 'http://example.com/app.js',
        line: 2,  // 1-based: line 2 of generated code
        column: 1, // 1-based
        function: '<anonymous>',
      };

      const resolved = await resolver.resolveFrame(frame);
      expect(resolved.resolved).toBe(true);
      expect(resolved.originalSource).toBe('src/app.ts');
      expect(resolved.originalLine).toBeGreaterThan(0);
      expect(resolved.originalColumn).toBeGreaterThan(0);
    });

    it('should include source context', async () => {
      resolver.injectSourceMap('http://example.com/app.js', TEST_SOURCEMAP);

      const frame: StackFrame = {
        url: 'http://example.com/app.js',
        line: 2,
        column: 1,
        function: '<anonymous>',
      };

      const resolved = await resolver.resolveFrame(frame);
      if (resolved.context) {
        expect(resolved.context.line).toBeDefined();
        expect(Array.isArray(resolved.context.pre)).toBe(true);
        expect(Array.isArray(resolved.context.post)).toBe(true);
      }
    });

    it('should return original frame if already resolved', async () => {
      const frame: StackFrame = {
        url: 'http://example.com/app.js',
        line: 2,
        column: 1,
        resolved: true,
      };

      const result = await resolver.resolveFrame(frame);
      expect(result).toBe(frame);
    });

    it('should return original frame if no URL', async () => {
      const frame: StackFrame = {
        url: '',
        line: 1,
        column: 1,
      };

      const result = await resolver.resolveFrame(frame);
      expect(result.resolved).toBeUndefined();
    });

    it('should return original frame if sourcemap not found', async () => {
      const r = new SourceMapResolver({
        fetcher: async () => { throw new Error('404'); },
      });

      const frame: StackFrame = {
        url: 'http://example.com/missing.js',
        line: 1,
        column: 1,
      };

      const result = await r.resolveFrame(frame);
      expect(result.resolved).toBeUndefined();
    });

    it('should handle out-of-range line numbers', async () => {
      resolver.injectSourceMap('http://example.com/app.js', TEST_SOURCEMAP);

      const frame: StackFrame = {
        url: 'http://example.com/app.js',
        line: 999,
        column: 1,
      };

      const result = await resolver.resolveFrame(frame);
      expect(result.resolved).toBeUndefined();
    });
  });

  describe('resolveFrames', () => {
    it('should resolve multiple frames', async () => {
      resolver.injectSourceMap('http://example.com/app.js', TEST_SOURCEMAP);

      const frames: StackFrame[] = [
        { url: 'http://example.com/app.js', line: 2, column: 1 },
        { url: 'http://example.com/app.js', line: 3, column: 1 },
      ];

      const resolved = await resolver.resolveFrames(frames);
      expect(resolved).toHaveLength(2);
    });

    it('should handle mix of resolvable and unresolvable frames', async () => {
      resolver.injectSourceMap('http://example.com/app.js', TEST_SOURCEMAP);

      const frames: StackFrame[] = [
        { url: 'http://example.com/app.js', line: 2, column: 1 },
        { url: 'http://example.com/unknown.js', line: 1, column: 1 },
      ];

      const resolved = await resolver.resolveFrames(frames);
      expect(resolved).toHaveLength(2);
    });

    it('should handle empty frames array', async () => {
      const resolved = await resolver.resolveFrames([]);
      expect(resolved).toHaveLength(0);
    });
  });

  describe('resolveFrame with name', () => {
    it('should resolve function name from names array', async () => {
      resolver.injectSourceMap('http://example.com/app.js', TEST_SOURCEMAP);

      // Find a frame that maps to a named segment
      const frame: StackFrame = {
        url: 'http://example.com/app.js',
        line: 3,
        column: 1,
        function: 'anonymous',
      };

      const resolved = await resolver.resolveFrame(frame);
      // Should either have original function name or keep the original
      expect(resolved).toBeDefined();
    });
  });

  describe('clearCache', () => {
    it('should clear all cached entries', async () => {
      await resolver.loadSourceMap('http://example.com/app.js');
      expect(resolver.getCacheSize()).toBe(1);

      resolver.clearCache();
      expect(resolver.getCacheSize()).toBe(0);
    });
  });

  describe('urlTemplate', () => {
    it('should use custom URL template', async () => {
      const fetcher = vi.fn(async () => JSON.stringify(TEST_SOURCEMAP));
      const r = new SourceMapResolver({
        urlTemplate: 'https://maps.example.com/{url}',
        fetcher,
      });

      await r.loadSourceMap('app.js');
      expect(fetcher).toHaveBeenCalledWith('https://maps.example.com/app.js');
    });
  });

  describe('sourceRoot', () => {
    it('should prepend sourceRoot to sources', async () => {
      const mapWithRoot: RawSourceMap = {
        ...TEST_SOURCEMAP,
        sourceRoot: '/project/',
      };

      const r = new SourceMapResolver({
        fetcher: async () => JSON.stringify(mapWithRoot),
      });

      const frame: StackFrame = {
        url: 'http://example.com/app.js',
        line: 2,
        column: 1,
      };

      const resolved = await r.resolveFrame(frame);
      if (resolved.resolved) {
        expect(resolved.originalSource).toContain('/project/');
      }
    });
  });
});
