import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';
import { logger } from '@monitor/utils';

/**
 * 数据压缩模块
 *
 * 使用 fflate 库进行 gzip 压缩/解压。
 * fflate 体积小（~3KB gzipped），纯 JS 实现，兼容浏览器和 Node.js。
 *
 * 压缩策略：
 * - JSON 数据通常可压缩 70-90%
 * - 压缩后使用 Uint8Array 发送，配合 Content-Encoding: gzip
 */

/** fflate 接受的压缩级别 */
type GzipLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * 压缩字符串数据为 gzip 格式
 *
 * @param data 原始字符串（通常是 JSON）
 * @param level 压缩级别 0-9，默认 6（平衡速度和体积）
 * @returns 压缩后的 Uint8Array
 */
export function compress(data: string, level: GzipLevel = 6): Uint8Array {
  try {
    const raw = strToU8(data);
    return gzipSync(raw, { level });
  } catch (error) {
    logger.error('[Compression] Failed to compress data:', error as Error);
    throw error;
  }
}

/**
 * 解压 gzip 数据为字符串
 *
 * @param data 压缩后的 Uint8Array
 * @returns 解压后的字符串
 */
export function decompress(data: Uint8Array): string {
  try {
    const decompressed = gunzipSync(data);
    return strFromU8(decompressed);
  } catch (error) {
    logger.error('[Compression] Failed to decompress data:', error as Error);
    throw error;
  }
}

/**
 * 计算压缩率
 *
 * @returns 压缩率百分比，如 0.3 表示压缩后体积为原始的 30%
 */
export function getCompressionRatio(originalSize: number, compressedSize: number): number {
  if (originalSize === 0) return 1;
  return compressedSize / originalSize;
}

/**
 * 判断数据是否值得压缩
 *
 * 小于 1KB 的数据压缩收益不大，gzip header 开销反而可能增加体积。
 */
export function shouldCompress(data: string, threshold: number = 1024): boolean {
  return data.length >= threshold;
}
