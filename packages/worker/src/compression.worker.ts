/**
 * 压缩 Worker — 在独立线程中执行 gzip 压缩/解压
 *
 * 通信协议：
 * 主线程 → Worker: { id: number, type: 'compress' | 'decompress', payload: string | number[] }
 * Worker → 主线程: { id: number, result: { data: number[], originalSize: number, compressedSize: number } }
 *                 | { id: number, error: string }
 *
 * 注意：Uint8Array 不能直接通过 postMessage 传递（某些环境下），
 * 因此使用普通 number[] 传输，由主线程转换。
 */

import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';

/** fflate 接受的压缩级别 */
type GzipLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * Worker 消息处理函数（可独立测试）
 */
export function handleCompressionMessage(
  data: { id: number; type: string; payload: unknown },
): { id: number; result?: unknown; error?: string } {
  const { id, type, payload } = data;

  try {
    if (type === 'compress') {
      const str = payload as string;
      const raw = strToU8(str);
      const originalSize = raw.length;
      const level: GzipLevel = 6;
      const compressed = gzipSync(raw, { level });

      return {
        id,
        result: {
          data: Array.from(compressed),
          originalSize,
          compressedSize: compressed.length,
        },
      };
    }

    if (type === 'decompress') {
      const arr = new Uint8Array(payload as number[]);
      const decompressed = gunzipSync(arr);
      const text = strFromU8(decompressed);

      return {
        id,
        result: { text },
      };
    }

    return {
      id,
      error: `Unknown compression task type: ${type}`,
    };
  } catch (error) {
    return {
      id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 在 Worker 全局上下文中注册 onmessage
 * 仅当作为真正的 Worker 加载时执行（检测 self 是否为 WorkerGlobalScope）
 */
function initWorker(): void {
  if (
    typeof self !== 'undefined' &&
    typeof (self as unknown as { onmessage: unknown }).onmessage !== 'undefined'
  ) {
    self.onmessage = (event: MessageEvent) => {
      const response = handleCompressionMessage(event.data);
      self.postMessage(response);
    };
  }
}

initWorker();
