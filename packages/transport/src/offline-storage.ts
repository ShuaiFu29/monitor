import type { BaseEvent } from '@monitor/types';
import { logger, generateId } from '@monitor/utils';

/**
 * 离线存储事件记录
 */
export interface StoredRecord {
  /** 唯一 ID */
  id: string;
  /** 序列化后的事件批次 (JSON string) */
  payload: string;
  /** 存储时间戳 */
  storedAt: number;
  /** 重试次数 */
  retryCount: number;
}

/**
 * 离线存储配置
 */
export interface OfflineStorageConfig {
  /** 数据库名称 */
  dbName?: string;
  /** 对象存储名称 */
  storeName?: string;
  /** 最大存储条目数 */
  maxEntries?: number;
  /** 最大保存时长 (ms)，默认 24 小时 */
  maxAge?: number;
}

const DEFAULT_CONFIG: Required<OfflineStorageConfig> = {
  dbName: 'monitor-sdk-offline',
  storeName: 'pending-events',
  maxEntries: 1000,
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
};

/**
 * IndexedDB 离线存储
 *
 * 当网络不可用或上报失败时，将事件持久化到 IndexedDB。
 * 网络恢复后由 RecoveryManager 负责重新上报。
 *
 * 特性：
 * - 异步读写，不阻塞主线程
 * - 自动清理过期数据（超过 maxAge）
 * - 容量限制（超过 maxEntries 时丢弃最旧数据）
 */
export class OfflineStorage {
  private config: Required<OfflineStorageConfig>;
  private db: IDBDatabase | null = null;

  constructor(config?: OfflineStorageConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 检查 IndexedDB 是否可用
   */
  isAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  /**
   * 打开数据库连接
   */
  async open(): Promise<boolean> {
    if (!this.isAvailable()) {
      logger.warn('[OfflineStorage] IndexedDB is not available.');
      return false;
    }

    if (this.db) return true;

    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(this.config.dbName, 1);

        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(this.config.storeName)) {
            const store = db.createObjectStore(this.config.storeName, { keyPath: 'id' });
            store.createIndex('storedAt', 'storedAt', { unique: false });
          }
        };

        request.onsuccess = () => {
          this.db = request.result;
          resolve(true);
        };

        request.onerror = () => {
          logger.error('[OfflineStorage] Failed to open database:', request.error as DOMException);
          resolve(false);
        };
      } catch (error) {
        logger.error('[OfflineStorage] IndexedDB open error:', error as Error);
        resolve(false);
      }
    });
  }

  /**
   * 存储事件批次
   *
   * @param events 要存储的事件数组
   * @returns 存储记录的 ID
   */
  async store(events: BaseEvent[]): Promise<string | null> {
    if (!await this.ensureOpen()) return null;

    const record: StoredRecord = {
      id: generateId(),
      payload: JSON.stringify(events),
      storedAt: Date.now(),
      retryCount: 0,
    };

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(this.config.storeName, 'readwrite');
        const store = tx.objectStore(this.config.storeName);
        const request = store.add(record);

        request.onsuccess = () => resolve(record.id);
        request.onerror = () => {
          logger.error('[OfflineStorage] Failed to store events:', request.error as DOMException);
          resolve(null);
        };
      } catch (error) {
        logger.error('[OfflineStorage] Store error:', error as Error);
        resolve(null);
      }
    });
  }

  /**
   * 获取所有 pending 记录
   */
  async getPending(): Promise<StoredRecord[]> {
    if (!await this.ensureOpen()) return [];

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(this.config.storeName, 'readonly');
        const store = tx.objectStore(this.config.storeName);
        const request = store.getAll();

        request.onsuccess = () => {
          const records = (request.result as StoredRecord[]) || [];
          // 按存储时间排序（先进先出）
          records.sort((a, b) => a.storedAt - b.storedAt);
          resolve(records);
        };

        request.onerror = () => {
          logger.error('[OfflineStorage] Failed to get pending records.');
          resolve([]);
        };
      } catch (error) {
        logger.error('[OfflineStorage] GetPending error:', error as Error);
        resolve([]);
      }
    });
  }

  /**
   * 删除已发送的记录
   */
  async remove(id: string): Promise<boolean> {
    if (!await this.ensureOpen()) return false;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(this.config.storeName, 'readwrite');
        const store = tx.objectStore(this.config.storeName);
        const request = store.delete(id);

        request.onsuccess = () => resolve(true);
        request.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * 更新记录的重试次数
   */
  async incrementRetryCount(id: string): Promise<boolean> {
    if (!await this.ensureOpen()) return false;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(this.config.storeName, 'readwrite');
        const store = tx.objectStore(this.config.storeName);
        const getReq = store.get(id);

        getReq.onsuccess = () => {
          const record = getReq.result as StoredRecord | undefined;
          if (!record) {
            resolve(false);
            return;
          }
          record.retryCount++;
          const putReq = store.put(record);
          putReq.onsuccess = () => resolve(true);
          putReq.onerror = () => resolve(false);
        };

        getReq.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * 清理过期数据
   */
  async cleanup(): Promise<number> {
    if (!await this.ensureOpen()) return 0;

    const cutoff = Date.now() - this.config.maxAge;
    const records = await this.getPending();
    let removed = 0;

    for (const record of records) {
      if (record.storedAt < cutoff) {
        await this.remove(record.id);
        removed++;
      }
    }

    // 如果超出容量限制，删除最旧的
    const remaining = await this.getPending();
    if (remaining.length > this.config.maxEntries) {
      const toRemove = remaining.length - this.config.maxEntries;
      for (let i = 0; i < toRemove; i++) {
        await this.remove(remaining[i].id);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug(`[OfflineStorage] Cleaned up ${removed} expired/excess records.`);
    }

    return removed;
  }

  /**
   * 获取当前存储的记录数
   */
  async count(): Promise<number> {
    if (!await this.ensureOpen()) return 0;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(this.config.storeName, 'readonly');
        const store = tx.objectStore(this.config.storeName);
        const request = store.count();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(0);
      } catch {
        resolve(0);
      }
    });
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * 清空所有数据
   */
  async clear(): Promise<boolean> {
    if (!await this.ensureOpen()) return false;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(this.config.storeName, 'readwrite');
        const store = tx.objectStore(this.config.storeName);
        const request = store.clear();

        request.onsuccess = () => resolve(true);
        request.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * 确保数据库已打开
   */
  private async ensureOpen(): Promise<boolean> {
    if (this.db) return true;
    return this.open();
  }
}
