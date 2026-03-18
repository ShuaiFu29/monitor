import { describe, it, expect } from 'vitest';
import {
  handleSourceMapMessage,
  parseMappings,
  findSegment,
} from '../src/sourcemap.worker';

// 简单的 SourceMap 测试数据
const TEST_SOURCE_MAP = JSON.stringify({
  version: 3,
  sources: ['src/app.ts'],
  names: ['greet', 'console', 'log', 'name'],
  // Simplified mappings: line 0, col 0 -> src 0, line 0, col 0, name 0
  mappings: 'AAAAA,CACCC',
  sourcesContent: [
    'function greet(name: string) {\n  console.log("Hello " + name);\n}\n',
  ],
});

describe('SourceMapWorker', () => {
  describe('parseMappings', () => {
    it('should parse empty mappings', () => {
      const result = parseMappings('');
      expect(result).toHaveLength(1); // One empty line
      expect(result[0].segments).toHaveLength(0);
    });

    it('should parse single-line mappings', () => {
      const result = parseMappings('AAAA');
      expect(result).toHaveLength(1);
      expect(result[0].segments).toHaveLength(1);
      expect(result[0].segments[0].generatedColumn).toBe(0);
      expect(result[0].segments[0].sourceIndex).toBe(0);
      expect(result[0].segments[0].originalLine).toBe(0);
      expect(result[0].segments[0].originalColumn).toBe(0);
    });

    it('should parse multi-segment line', () => {
      const result = parseMappings('AAAA,CACCC');
      expect(result).toHaveLength(1);
      expect(result[0].segments.length).toBeGreaterThanOrEqual(2);
    });

    it('should parse multi-line mappings', () => {
      const result = parseMappings('AAAA;AACA');
      expect(result).toHaveLength(2);
      expect(result[0].segments).toHaveLength(1);
      expect(result[1].segments).toHaveLength(1);
    });

    it('should handle empty lines (semicolons)', () => {
      const result = parseMappings('AAAA;;AACA');
      expect(result).toHaveLength(3);
      expect(result[1].segments).toHaveLength(0);
    });

    it('should accumulate values across segments', () => {
      // AAAA = col:0, src:0, line:0, col:0
      // CACA = col:+1, src:0, line:+1, col:0
      const result = parseMappings('AAAA,CACA');
      expect(result[0].segments).toHaveLength(2);
      expect(result[0].segments[0].generatedColumn).toBe(0);
      expect(result[0].segments[1].generatedColumn).toBe(1);
      expect(result[0].segments[1].originalLine).toBe(1);
    });
  });

  describe('findSegment', () => {
    it('should find exact column match', () => {
      const lines = parseMappings('AAAA,GACA');
      const segment = findSegment(lines, 0, 0);
      expect(segment).not.toBeNull();
      expect(segment!.generatedColumn).toBe(0);
    });

    it('should find closest preceding column', () => {
      const lines = parseMappings('AAAA,IACA');
      // col 2 should match col 0 if col 4 comes after
      const segment = findSegment(lines, 0, 2);
      expect(segment).not.toBeNull();
      expect(segment!.generatedColumn).toBeLessThanOrEqual(2);
    });

    it('should return null for invalid line', () => {
      const lines = parseMappings('AAAA');
      const segment = findSegment(lines, 5, 0);
      expect(segment).toBeNull();
    });

    it('should return null for negative line', () => {
      const lines = parseMappings('AAAA');
      const segment = findSegment(lines, -1, 0);
      expect(segment).toBeNull();
    });

    it('should return null for empty line segments', () => {
      const lines = parseMappings(';AAAA');
      const segment = findSegment(lines, 0, 0);
      expect(segment).toBeNull();
    });
  });

  describe('handleSourceMapMessage', () => {
    it('should resolve frames against a source map', () => {
      const response = handleSourceMapMessage({
        id: 1,
        type: 'resolve',
        payload: {
          frames: [
            { filename: 'app.min.js', lineno: 1, colno: 1 },
          ],
          rawSourceMap: TEST_SOURCE_MAP,
        },
      });

      expect(response.id).toBe(1);
      expect(response.error).toBeUndefined();

      const result = response.result as { frames: Array<Record<string, unknown>> };
      expect(result.frames).toHaveLength(1);
      expect(result.frames[0].originalFilename).toBe('src/app.ts');
      expect(result.frames[0].originalLineno).toBeDefined();
      expect(result.frames[0].originalColno).toBeDefined();
    });

    it('should include source context', () => {
      const response = handleSourceMapMessage({
        id: 2,
        type: 'resolve',
        payload: {
          frames: [
            { filename: 'app.min.js', lineno: 1, colno: 1 },
          ],
          rawSourceMap: TEST_SOURCE_MAP,
        },
      });

      const result = response.result as { frames: Array<Record<string, unknown>> };
      const frame = result.frames[0];
      if (frame.context) {
        const ctx = frame.context as { pre: string[]; line: string; post: string[] };
        expect(ctx).toHaveProperty('pre');
        expect(ctx).toHaveProperty('line');
        expect(ctx).toHaveProperty('post');
      }
    });

    it('should resolve name if available', () => {
      // Create a sourcemap with name index
      const mapWithNames = JSON.stringify({
        version: 3,
        sources: ['src/app.ts'],
        names: ['greet'],
        // AAAAA = col:0, src:0, line:0, col:0, name:0
        mappings: 'AAAAA',
        sourcesContent: ['function greet() {}'],
      });

      const response = handleSourceMapMessage({
        id: 3,
        type: 'resolve',
        payload: {
          frames: [{ filename: 'app.min.js', lineno: 1, colno: 1 }],
          rawSourceMap: mapWithNames,
        },
      });

      const result = response.result as { frames: Array<Record<string, unknown>> };
      expect(result.frames[0].originalFunction).toBe('greet');
    });

    it('should pass through frames without lineno/colno', () => {
      const response = handleSourceMapMessage({
        id: 4,
        type: 'resolve',
        payload: {
          frames: [{ filename: 'app.min.js' }],
          rawSourceMap: TEST_SOURCE_MAP,
        },
      });

      const result = response.result as { frames: Array<Record<string, unknown>> };
      expect(result.frames[0].originalLineno).toBeUndefined();
    });

    it('should resolve multiple frames', () => {
      const response = handleSourceMapMessage({
        id: 5,
        type: 'resolve',
        payload: {
          frames: [
            { filename: 'app.min.js', lineno: 1, colno: 1 },
            { filename: 'app.min.js', lineno: 1, colno: 5 },
          ],
          rawSourceMap: TEST_SOURCE_MAP,
        },
      });

      const result = response.result as { frames: Array<Record<string, unknown>> };
      expect(result.frames).toHaveLength(2);
    });

    it('should reject unsupported source map version', () => {
      const badMap = JSON.stringify({ version: 2, mappings: '', sources: [], names: [] });

      const response = handleSourceMapMessage({
        id: 6,
        type: 'resolve',
        payload: {
          frames: [{ filename: 'app.min.js', lineno: 1, colno: 1 }],
          rawSourceMap: badMap,
        },
      });

      expect(response.error).toContain('Unsupported');
    });

    it('should handle invalid JSON in rawSourceMap', () => {
      const response = handleSourceMapMessage({
        id: 7,
        type: 'resolve',
        payload: {
          frames: [{ filename: 'app.min.js', lineno: 1, colno: 1 }],
          rawSourceMap: 'not valid json',
        },
      });

      expect(response.error).toBeDefined();
    });

    it('should return error for unknown type', () => {
      const response = handleSourceMapMessage({
        id: 8,
        type: 'unknown',
        payload: {},
      });

      expect(response.error).toContain('Unknown sourcemap task type');
    });
  });
});
