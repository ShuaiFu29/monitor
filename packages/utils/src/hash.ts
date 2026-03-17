/**
 * 基于 DJB2 算法的快速字符串哈希
 * 适用于错误指纹生成和去重判断
 * 无密码学安全要求，纯性能导向
 */
export function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // hash * 33 + char
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

/**
 * 基于 FNV-1a 算法的哈希 (32位)
 * 比 DJB2 有更好的分布性
 */
export function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0; // FNV prime
  }
  return hash.toString(36);
}

/**
 * 生成简单唯一 ID
 * 格式: 时间戳(base36) + 随机(base36)
 * 不使用 uuid 库以减少体积
 */
export function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}
