import { describe, it, expect } from 'vitest';
import { ReplayCompressor } from '../src/compressor';
import { gunzipSync, strFromU8 } from 'fflate';

describe('ReplayCompressor', () => {
  it('should compress data above threshold', () => {
    const compressor = new ReplayCompressor({ minSize: 100 });
    const data = JSON.stringify({ test: 'a'.repeat(200) });

    const result = compressor.compress(data);

    expect(result.compressed).toBe(true);
    expect(result.data).toBeInstanceOf(Uint8Array);
    expect(result.compressedSize).toBeLessThan(result.originalSize);
  });

  it('should not compress data below threshold', () => {
    const compressor = new ReplayCompressor({ minSize: 1024 });
    const data = 'small data';

    const result = compressor.compress(data);

    expect(result.compressed).toBe(false);
    expect(result.data).toBe(data);
    expect(result.originalSize).toBe(result.compressedSize);
  });

  it('should produce valid gzip that can be decompressed', () => {
    const compressor = new ReplayCompressor({ minSize: 10 });
    const original = JSON.stringify({ hello: 'world', items: [1, 2, 3] });

    const result = compressor.compress(original);
    expect(result.compressed).toBe(true);

    // Decompress and verify
    const decompressed = gunzipSync(result.data as Uint8Array);
    const decompressedStr = strFromU8(decompressed);
    expect(decompressedStr).toBe(original);
  });

  it('should respect compression level', () => {
    const lowLevel = new ReplayCompressor({ level: 1, minSize: 10 });
    const highLevel = new ReplayCompressor({ level: 9, minSize: 10 });
    const data = JSON.stringify({ items: Array(100).fill('test data item') });

    const lowResult = lowLevel.compress(data);
    const highResult = highLevel.compress(data);

    // Higher compression level should produce smaller or equal output
    expect(highResult.compressedSize).toBeLessThanOrEqual(lowResult.compressedSize);
  });

  it('should use default config values', () => {
    const compressor = new ReplayCompressor();
    // Default minSize is 512
    const smallData = 'x'.repeat(100);
    const result = compressor.compress(smallData);
    expect(result.compressed).toBe(false);

    // Data above 512 bytes
    const largeData = 'x'.repeat(600);
    const largeResult = compressor.compress(largeData);
    expect(largeResult.compressed).toBe(true);
  });

  it('should compress empty string without error', () => {
    const compressor = new ReplayCompressor({ minSize: 0 });
    const result = compressor.compress('');
    // Empty string has 0 bytes, which is < 0 is false, so it may compress
    expect(result).toBeDefined();
  });

  it('should handle Chinese characters correctly', () => {
    const compressor = new ReplayCompressor({ minSize: 10 });
    const data = '你好世界，这是一段中文内容，用于测试压缩器的正确性。';

    const result = compressor.compress(data);
    expect(result.compressed).toBe(true);

    // Decompress and verify
    const decompressed = gunzipSync(result.data as Uint8Array);
    const decompressedStr = strFromU8(decompressed);
    expect(decompressedStr).toBe(data);
  });

  describe('compressPayload', () => {
    it('should serialize and compress object', () => {
      const compressor = new ReplayCompressor({ minSize: 10 });
      const payload = {
        snapshot: { node: { id: 1, type: 'document' } },
        mutations: [{ type: 'add', targetId: 1 }],
      };

      const result = compressor.compressPayload(payload);
      expect(result.compressed).toBe(true);

      // Decompress and verify
      const decompressed = gunzipSync(result.data as Uint8Array);
      const decompressedStr = strFromU8(decompressed);
      expect(JSON.parse(decompressedStr)).toEqual(payload);
    });

    it('should handle null payload', () => {
      const compressor = new ReplayCompressor({ minSize: 0 });
      const result = compressor.compressPayload(null);
      expect(result).toBeDefined();
    });
  });

  describe('getCompressionRatio', () => {
    it('should calculate compression ratio', () => {
      const ratio = ReplayCompressor.getCompressionRatio(1000, 300);
      expect(ratio).toBe(0.7);
    });

    it('should return 0 for zero original size', () => {
      const ratio = ReplayCompressor.getCompressionRatio(0, 0);
      expect(ratio).toBe(0);
    });

    it('should return negative ratio if compressed is larger', () => {
      const ratio = ReplayCompressor.getCompressionRatio(100, 150);
      expect(ratio).toBe(-0.5);
    });
  });
});
