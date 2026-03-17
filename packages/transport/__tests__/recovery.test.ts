import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { RecoveryManager } from '../src/recovery';
import { OfflineStorage } from '../src/offline-storage';
import type { TransportEngine } from '../src/transport';
import type { BaseEvent } from '@monitor/types';

describe('RecoveryManager', () => {
  let storage: OfflineStorage;
  let mockEngine: TransportEngine;
  let recovery: RecoveryManager;

  const mockEvent: BaseEvent = {
    id: 'evt-1',
    type: 'error',
    timestamp: Date.now(),
    sessionId: 'session-1',
  } as BaseEvent;

  beforeEach(async () => {
    storage = new OfflineStorage({
      dbName: `test-recovery-${Date.now()}`,
      storeName: 'test-events',
      maxEntries: 100,
      maxAge: 60000,
    });

    mockEngine = {
      send: vi.fn().mockResolvedValue(true),
      getOfflineStorage: () => storage,
    } as unknown as TransportEngine;

    recovery = new RecoveryManager(mockEngine, storage, {
      maxBatchesPerRecovery: 10,
      maxRetryCount: 3,
      batchInterval: 0, // 无间隔加快测试
    });
  });

  afterEach(() => {
    recovery.uninstall();
    storage.close();
  });

  it('install 应注册 online 事件监听器', () => {
    const spy = vi.spyOn(window, 'addEventListener');
    recovery.install();
    expect(spy).toHaveBeenCalledWith('online', expect.any(Function));
    spy.mockRestore();
  });

  it('recover 无 pending 记录时应返回全零', async () => {
    const result = await recovery.recover();
    expect(result).toEqual({ sent: 0, failed: 0, discarded: 0 });
  });

  it('recover 应重发 pending 记录并删除', async () => {
    await storage.store([mockEvent]);
    await storage.store([mockEvent]);
    expect(await storage.count()).toBe(2);

    const result = await recovery.recover();
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(await storage.count()).toBe(0);
  });

  it('recover 重发失败应增加 retryCount', async () => {
    (mockEngine.send as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await storage.store([mockEvent]);
    const result = await recovery.recover();

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);

    // retryCount 应增加
    const records = await storage.getPending();
    expect(records[0].retryCount).toBe(1);
  });

  it('recover 超过 maxRetryCount 应丢弃', async () => {
    await storage.store([mockEvent]);
    // 手动增加 retryCount 到 maxRetryCount
    const records = await storage.getPending();
    for (let i = 0; i < 3; i++) {
      await storage.incrementRetryCount(records[0].id);
    }

    const result = await recovery.recover();
    expect(result.discarded).toBe(1);
    expect(await storage.count()).toBe(0);
  });

  it('recover 应限制 maxBatchesPerRecovery', async () => {
    const limitedRecovery = new RecoveryManager(mockEngine, storage, {
      maxBatchesPerRecovery: 2,
      maxRetryCount: 5,
      batchInterval: 0,
    });

    // 存储 5 条记录
    for (let i = 0; i < 5; i++) {
      await storage.store([{ ...mockEvent, id: `evt-${i}` } as BaseEvent]);
    }

    const result = await limitedRecovery.recover();
    // 应只处理 2 条
    expect(result.sent).toBe(2);
    expect(await storage.count()).toBe(3); // 剩余 3 条
  });

  it('isRecovering 应正确反映状态', async () => {
    expect(recovery.isRecovering()).toBe(false);

    let resolveEngine!: (value: boolean) => void;
    (mockEngine.send as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<boolean>((resolve) => { resolveEngine = resolve; }),
    );

    await storage.store([mockEvent]);
    const recoverPromise = recovery.recover();

    // 等待 engine.send 被调用
    await vi.waitFor(() => {
      expect((mockEngine.send as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });

    expect(recovery.isRecovering()).toBe(true);

    resolveEngine(true);
    await recoverPromise;
    expect(recovery.isRecovering()).toBe(false);
  });

  it('并发 recover 调用应跳过第二次', async () => {
    let resolveEngine!: (value: boolean) => void;
    (mockEngine.send as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<boolean>((resolve) => { resolveEngine = resolve; }),
    );

    await storage.store([mockEvent]);

    const promise1 = recovery.recover();
    const promise2 = recovery.recover();

    // 等待 engine.send 被调用
    await vi.waitFor(() => {
      expect((mockEngine.send as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });

    resolveEngine(true);
    const result1 = await promise1;
    const result2 = await promise2;

    // 第二次应跳过
    expect(result2).toEqual({ sent: 0, failed: 0, discarded: 0 });
    expect(result1.sent).toBe(1);
  });

  it('online 事件应自动触发 recover', async () => {
    await storage.store([mockEvent]);
    recovery.install();

    // 触发 online 事件
    window.dispatchEvent(new Event('online'));

    // 等待异步 recover 完成
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 记录应已被发送并删除
    expect(await storage.count()).toBe(0);
    expect(mockEngine.send).toHaveBeenCalled();
  });

  it('uninstall 应移除 online 事件监听器', () => {
    const spy = vi.spyOn(window, 'removeEventListener');
    recovery.install();
    recovery.uninstall();
    expect(spy).toHaveBeenCalledWith('online', expect.any(Function));
    spy.mockRestore();
  });
});
