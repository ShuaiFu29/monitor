import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { OfflineStorage } from '../src/offline-storage';
import type { BaseEvent } from '@monitor/types';

let dbCounter = 0;

describe('OfflineStorage', () => {
  let storage: OfflineStorage;

  const mockEvent: BaseEvent = {
    id: 'evt-1',
    type: 'error',
    timestamp: Date.now(),
    sessionId: 'session-1',
  } as BaseEvent;

  beforeEach(async () => {
    dbCounter++;
    storage = new OfflineStorage({
      dbName: `test-db-${dbCounter}`, // 每个测试用独立数据库
      storeName: 'test-events',
      maxEntries: 5,
      maxAge: 1000 * 60, // 1 minute for tests
    });
  });

  afterEach(() => {
    storage.close();
  });

  it('isAvailable 应返回 true（fake-indexeddb）', () => {
    expect(storage.isAvailable()).toBe(true);
  });

  it('open 应成功打开数据库', async () => {
    const result = await storage.open();
    expect(result).toBe(true);
  });

  it('store 应存储事件并返回 ID', async () => {
    const id = await storage.store([mockEvent]);
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('getPending 应返回存储的记录', async () => {
    await storage.store([mockEvent]);
    const records = await storage.getPending();

    expect(records.length).toBe(1);
    expect(records[0].retryCount).toBe(0);

    // payload 应包含序列化后的事件
    const events = JSON.parse(records[0].payload);
    expect(events[0].id).toBe('evt-1');
    expect(events[0].type).toBe('error');
  });

  it('getPending 应按存储时间排序', async () => {
    await storage.store([{ ...mockEvent, id: 'evt-a' } as BaseEvent]);
    await storage.store([{ ...mockEvent, id: 'evt-b' } as BaseEvent]);
    await storage.store([{ ...mockEvent, id: 'evt-c' } as BaseEvent]);

    const records = await storage.getPending();
    expect(records.length).toBe(3);
    // 按时间排序（先进先出）
    expect(records[0].storedAt).toBeLessThanOrEqual(records[1].storedAt);
    expect(records[1].storedAt).toBeLessThanOrEqual(records[2].storedAt);
  });

  it('remove 应删除指定记录', async () => {
    const id = await storage.store([mockEvent]);
    expect(await storage.count()).toBe(1);

    const removed = await storage.remove(id!);
    expect(removed).toBe(true);
    expect(await storage.count()).toBe(0);
  });

  it('incrementRetryCount 应增加重试次数', async () => {
    const id = await storage.store([mockEvent]);
    await storage.incrementRetryCount(id!);
    await storage.incrementRetryCount(id!);

    const records = await storage.getPending();
    expect(records[0].retryCount).toBe(2);
  });

  it('incrementRetryCount 对不存在的 ID 返回 false', async () => {
    await storage.open();
    const result = await storage.incrementRetryCount('nonexistent');
    expect(result).toBe(false);
  });

  it('count 应返回正确数量', async () => {
    expect(await storage.count()).toBe(0);
    await storage.store([mockEvent]);
    expect(await storage.count()).toBe(1);
    await storage.store([mockEvent]);
    expect(await storage.count()).toBe(2);
  });

  it('clear 应清空所有记录', async () => {
    await storage.store([mockEvent]);
    await storage.store([mockEvent]);
    expect(await storage.count()).toBe(2);

    await storage.clear();
    expect(await storage.count()).toBe(0);
  });

  it('cleanup 应清理超出容量的记录', async () => {
    // maxEntries = 5
    for (let i = 0; i < 8; i++) {
      await storage.store([{ ...mockEvent, id: `evt-${i}` } as BaseEvent]);
    }

    expect(await storage.count()).toBe(8);
    const removed = await storage.cleanup();
    expect(removed).toBeGreaterThan(0);
    expect(await storage.count()).toBeLessThanOrEqual(5);
  });

  it('close 后再操作应自动重新打开', async () => {
    await storage.store([mockEvent]);
    storage.close();

    // 关闭后 getPending 应自动重新打开
    const records = await storage.getPending();
    expect(records.length).toBe(1);
  });
});
