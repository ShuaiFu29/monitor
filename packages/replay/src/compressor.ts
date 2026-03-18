import { gzipSync, strToU8 } from 'fflate';

/**
 * gzip 压缩级别（fflate 要求字面量联合类型）
 */
type GzipLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * 压缩配置
 */
export interface CompressorConfig {
  /** 压缩级别 0-9，默认 6 */
  level: GzipLevel;
  /** 最小压缩阈值（字节），小于此值不压缩，默认 512 */
  minSize: number;
}

const DEFAULT_CONFIG: CompressorConfig = {
  level: 6,
  minSize: 512,
};

/**
 * ReplayCompressor — 录制数据压缩器
 *
 * 负责将录制数据（JSON 字符串）进行 gzip 压缩，
 * 减少传输数据量和存储空间。
 *
 * 特点：
 * - 基于 fflate（轻量级纯 JS gzip 实现）
 * - 可配置压缩级别和最小压缩阈值
 * - 小于阈值的数据不压缩，避免负优化
 */
export class ReplayCompressor {
  private config: CompressorConfig;

  constructor(config: Partial<CompressorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 压缩数据
   *
   * @param data - JSON 字符串
   * @returns 压缩结果，包含压缩后的数据和是否实际压缩的标志
   */
  compress(data: string): CompressResult {
    const bytes = strToU8(data);

    // 小于阈值不压缩
    if (bytes.length < this.config.minSize) {
      return {
        data,
        compressed: false,
        originalSize: bytes.length,
        compressedSize: bytes.length,
      };
    }

    const compressed = gzipSync(bytes, { level: this.config.level });
    return {
      data: compressed,
      compressed: true,
      originalSize: bytes.length,
      compressedSize: compressed.length,
    };
  }

  /**
   * 序列化并压缩录制数据
   *
   * @param payload - 要序列化的对象
   * @returns 压缩结果
   */
  compressPayload(payload: unknown): CompressResult {
    const json = JSON.stringify(payload);
    return this.compress(json);
  }

  /**
   * 获取压缩率
   */
  static getCompressionRatio(original: number, compressed: number): number {
    if (original === 0) return 0;
    return 1 - compressed / original;
  }
}

/**
 * 压缩结果
 */
export interface CompressResult {
  /** 压缩后的数据（string 如果未压缩，Uint8Array 如果已压缩） */
  data: string | Uint8Array;
  /** 是否已压缩 */
  compressed: boolean;
  /** 原始大小（字节） */
  originalSize: number;
  /** 压缩后大小（字节） */
  compressedSize: number;
}
