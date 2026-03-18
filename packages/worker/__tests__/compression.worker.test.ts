import { describe, it, expect } from 'vitest';
import { handleCompressionMessage } from '../src/compression.worker';

describe('CompressionWorker', () => {
  describe('compress', () => {
    it('should compress a string', () => {
      const response = handleCompressionMessage({
        id: 1,
        type: 'compress',
        payload: 'Hello, World! This is test data for compression.',
      });

      expect(response.id).toBe(1);
      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();

      const result = response.result as {
        data: number[];
        originalSize: number;
        compressedSize: number;
      };
      expect(result.data).toBeInstanceOf(Array);
      expect(result.originalSize).toBeGreaterThan(0);
      expect(result.compressedSize).toBeGreaterThan(0);
    });

    it('should compress large repetitive data effectively', () => {
      const payload = 'A'.repeat(10000);
      const response = handleCompressionMessage({
        id: 2,
        type: 'compress',
        payload,
      });

      const result = response.result as {
        data: number[];
        originalSize: number;
        compressedSize: number;
      };
      // Repetitive data should compress very well
      expect(result.compressedSize).toBeLessThan(result.originalSize * 0.1);
    });

    it('should compress JSON data', () => {
      const jsonData = JSON.stringify({
        events: Array.from({ length: 50 }, (_, i) => ({
          id: i,
          type: 'error',
          message: 'Something went wrong',
          timestamp: Date.now(),
        })),
      });

      const response = handleCompressionMessage({
        id: 3,
        type: 'compress',
        payload: jsonData,
      });

      expect(response.error).toBeUndefined();
      const result = response.result as {
        data: number[];
        originalSize: number;
        compressedSize: number;
      };
      expect(result.compressedSize).toBeLessThan(result.originalSize);
    });

    it('should handle empty string', () => {
      const response = handleCompressionMessage({
        id: 4,
        type: 'compress',
        payload: '',
      });

      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();
    });
  });

  describe('decompress', () => {
    it('should decompress compressed data back to original', () => {
      const original = 'Hello, World! Testing round-trip compression.';

      // First compress
      const compressed = handleCompressionMessage({
        id: 1,
        type: 'compress',
        payload: original,
      });

      const compressedData = (compressed.result as { data: number[] }).data;

      // Then decompress
      const decompressed = handleCompressionMessage({
        id: 2,
        type: 'decompress',
        payload: compressedData,
      });

      expect(decompressed.error).toBeUndefined();
      expect((decompressed.result as { text: string }).text).toBe(original);
    });

    it('should handle round-trip with JSON data', () => {
      const original = JSON.stringify({ key: 'value', nested: { arr: [1, 2, 3] } });

      const compressed = handleCompressionMessage({
        id: 1,
        type: 'compress',
        payload: original,
      });

      const decompressed = handleCompressionMessage({
        id: 2,
        type: 'decompress',
        payload: (compressed.result as { data: number[] }).data,
      });

      const result = JSON.parse((decompressed.result as { text: string }).text);
      expect(result).toEqual({ key: 'value', nested: { arr: [1, 2, 3] } });
    });

    it('should handle round-trip with unicode data', () => {
      const original = '中文测试数据 🎉 émoji & spëcial chârs';

      const compressed = handleCompressionMessage({
        id: 1,
        type: 'compress',
        payload: original,
      });

      const decompressed = handleCompressionMessage({
        id: 2,
        type: 'decompress',
        payload: (compressed.result as { data: number[] }).data,
      });

      expect((decompressed.result as { text: string }).text).toBe(original);
    });

    it('should return error for invalid compressed data', () => {
      const response = handleCompressionMessage({
        id: 1,
        type: 'decompress',
        payload: [1, 2, 3, 4, 5], // Not valid gzip
      });

      expect(response.error).toBeDefined();
      expect(response.id).toBe(1);
    });
  });

  describe('unknown type', () => {
    it('should return error for unknown task type', () => {
      const response = handleCompressionMessage({
        id: 1,
        type: 'unknown',
        payload: 'data',
      });

      expect(response.error).toContain('Unknown compression task type');
    });
  });
});
