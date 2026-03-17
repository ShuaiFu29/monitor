import { describe, it, expect } from 'vitest';
import { compress, decompress, shouldCompress, getCompressionRatio } from '../src/compression';

describe('compression', () => {
  describe('compress / decompress', () => {
    it('压缩后解压应还原原始数据', () => {
      const original = JSON.stringify({ events: [{ type: 'error', message: 'test error' }] });
      const compressed = compress(original);
      const decompressed = decompress(compressed);
      expect(decompressed).toBe(original);
    });

    it('压缩后体积应小于原始数据', () => {
      // 重复数据压缩效果最好
      const original = JSON.stringify({
        events: Array.from({ length: 100 }, (_, i) => ({
          type: 'error',
          message: `Error ${i}`,
          timestamp: Date.now(),
          sessionId: 'abc123',
        })),
      });

      const compressed = compress(original);
      expect(compressed.length).toBeLessThan(original.length);
    });

    it('应返回 Uint8Array', () => {
      const compressed = compress('test data');
      expect(compressed).toBeInstanceOf(Uint8Array);
    });

    it('空字符串也能正常压缩解压', () => {
      const compressed = compress('');
      const decompressed = decompress(compressed);
      expect(decompressed).toBe('');
    });

    it('中文字符串应正确压缩解压', () => {
      const original = '这是一段中文错误信息：TypeError at line 42';
      const compressed = compress(original);
      const decompressed = decompress(compressed);
      expect(decompressed).toBe(original);
    });

    it('自定义压缩级别应生效', () => {
      const data = 'x'.repeat(10000);
      const level1 = compress(data, 1);
      const level9 = compress(data, 9);

      // 高压缩级别应产生更小的输出（或相同）
      expect(level9.length).toBeLessThanOrEqual(level1.length);

      // 两种级别解压后都应得到原始数据
      expect(decompress(level1)).toBe(data);
      expect(decompress(level9)).toBe(data);
    });
  });

  describe('shouldCompress', () => {
    it('大于阈值应返回 true', () => {
      const data = 'x'.repeat(2000);
      expect(shouldCompress(data, 1024)).toBe(true);
    });

    it('小于阈值应返回 false', () => {
      const data = 'short';
      expect(shouldCompress(data, 1024)).toBe(false);
    });

    it('等于阈值应返回 true', () => {
      const data = 'x'.repeat(1024);
      expect(shouldCompress(data, 1024)).toBe(true);
    });

    it('默认阈值为 1024', () => {
      expect(shouldCompress('x'.repeat(1024))).toBe(true);
      expect(shouldCompress('x'.repeat(1023))).toBe(false);
    });
  });

  describe('getCompressionRatio', () => {
    it('应计算正确的压缩率', () => {
      expect(getCompressionRatio(1000, 300)).toBe(0.3);
    });

    it('原始大小为 0 应返回 1', () => {
      expect(getCompressionRatio(0, 0)).toBe(1);
    });

    it('未压缩时比率为 1', () => {
      expect(getCompressionRatio(500, 500)).toBe(1);
    });
  });
});
