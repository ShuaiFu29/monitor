import { logger } from '@monitor/utils';

import type { OfflineStorage, StoredRecord } from './offline-storage';
import type { TransportEngine } from './transport';

/**
 * 网络恢复配置
 */
export interface RecoveryConfig {
  /** 恢复后重发的最大批次数，默认 10 */
  maxBatchesPerRecovery?: number;
  /** 超过此重试次数的记录将被丢弃，默认 5 */
  maxRetryCount?: number;
  /** 批次间发送间隔 (ms)，默认 1000 */
  batchInterval?: number;
}

const DEFAULT_RECOVERY_CONFIG: Required<RecoveryConfig> = {
  maxBatchesPerRecovery: 10,
  maxRetryCount: 5,
  batchInterval: 1000,
};

/**
 * 网络恢复管理器
 *
 * 监听浏览器 `online` 事件，在网络恢复后：
 * 1. 从 IndexedDB 读取所有 pending 记录
 * 2. 逐批重新发送
 * 3. 成功的记录从 IndexedDB 删除
 * 4. 超过最大重试次数的记录丢弃
 *
 * 设计考量：
 * - 批次间有间隔，避免网络恢复时瞬间发送大量请求
 * - 使用 maxRetryCount 避免无限重试
 * - cleanup 清理过期数据
 */
export class RecoveryManager {
  private config: Required<RecoveryConfig>;
  private engine: TransportEngine;
  private storage: OfflineStorage;
  private recovering: boolean = false;
  private onlineHandler: (() => void) | null = null;

  constructor(
    engine: TransportEngine,
    storage: OfflineStorage,
    config?: RecoveryConfig,
  ) {
    this.engine = engine;
    this.storage = storage;
    this.config = { ...DEFAULT_RECOVERY_CONFIG, ...config };
  }

  /**
   * 安装网络恢复监听器
   */
  install(): void {
    this.onlineHandler = () => {
      logger.info('[RecoveryManager] Network recovered, starting re-upload...');
      void this.recover();
    };
    window.addEventListener('online', this.onlineHandler);

    logger.debug('[RecoveryManager] Installed online event listener.');
  }

  /**
   * 执行恢复操作
   *
   * 从 IndexedDB 读取 pending 记录并逐批重发。
   */
  async recover(): Promise<{ sent: number; failed: number; discarded: number }> {
    if (this.recovering) {
      logger.debug('[RecoveryManager] Already recovering, skipping.');
      return { sent: 0, failed: 0, discarded: 0 };
    }

    this.recovering = true;
    let sent = 0;
    let failed = 0;
    let discarded = 0;

    try {
      // 先清理过期数据
      await this.storage.cleanup();

      // 获取所有 pending 记录
      const records = await this.storage.getPending();
      if (records.length === 0) {
        logger.debug('[RecoveryManager] No pending records to recover.');
        return { sent, failed, discarded };
      }

      logger.info(`[RecoveryManager] Found ${records.length} pending records.`);

      // 限制每次恢复的批次数
      const batchesToProcess = records.slice(0, this.config.maxBatchesPerRecovery);

      for (const record of batchesToProcess) {
        // 超过最大重试次数的记录丢弃
        if (record.retryCount >= this.config.maxRetryCount) {
          logger.warn(`[RecoveryManager] Discarding record ${record.id} (retryCount: ${record.retryCount}).`);
          await this.storage.remove(record.id);
          discarded++;
          continue;
        }

        // 尝试重发
        const success = await this.resendRecord(record);

        if (success) {
          await this.storage.remove(record.id);
          sent++;
        } else {
          await this.storage.incrementRetryCount(record.id);
          failed++;
        }

        // 批次间间隔
        if (this.config.batchInterval > 0) {
          await this.sleep(this.config.batchInterval);
        }
      }

      logger.info(
        `[RecoveryManager] Recovery complete: sent=${sent}, failed=${failed}, discarded=${discarded}`,
      );
    } catch (error) {
      logger.error('[RecoveryManager] Recovery error:', error as Error);
    } finally {
      this.recovering = false;
    }

    return { sent, failed, discarded };
  }

  /**
   * 是否正在恢复
   */
  isRecovering(): boolean {
    return this.recovering;
  }

  /**
   * 卸载网络监听器
   */
  uninstall(): void {
    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }
    logger.debug('[RecoveryManager] Uninstalled online event listener.');
  }

  /**
   * 重发单条记录
   */
  private async resendRecord(record: StoredRecord): Promise<boolean> {
    try {
      const events = JSON.parse(record.payload);
      return await this.engine.send(events);
    } catch (error) {
      logger.error(`[RecoveryManager] Failed to resend record ${record.id}:`, error as Error);
      return false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
