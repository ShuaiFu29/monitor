import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkerPool } from '../src/pool';

// 模拟 Worker 类
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private terminated = false;

  postMessage(data: unknown): void {
    if (this.terminated) return;
    // 模拟异步响应
    const { id, type, payload } = data as { id: number; type: string; payload: unknown };
    setTimeout(() => {
      if (this.terminated || !this.onmessage) return;
      if (type === 'fail') {
        this.onmessage(new MessageEvent('message', {
          data: { id, error: 'Task failed' },
        }));
      } else if (type === 'slow') {
        // 不响应，模拟超时
      } else {
        this.onmessage(new MessageEvent('message', {
          data: { id, result: { processed: payload } },
        }));
      }
    }, 10);
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('WorkerPool', () => {
  let pool: WorkerPool;

  beforeEach(() => {
    vi.useFakeTimers();
    // 替换全局 Worker 构造函数
    vi.stubGlobal('Worker', MockWorker);
  });

  afterEach(() => {
    if (pool) pool.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('initialization', () => {
    it('should create a pool with default size', () => {
      pool = new WorkerPool({ workerScript: 'test.js', poolSize: 2 });
      const status = pool.getStatus();
      expect(status.poolSize).toBe(2);
      expect(status.useWorker).toBe(true);
    });

    it('should fallback when Worker is not available', () => {
      vi.stubGlobal('Worker', undefined);
      const fallbackFn = vi.fn(() => 'fallback-result');

      pool = new WorkerPool({
        workerScript: 'test.js',
        fallbackToMainThread: true,
        fallbackFn,
      });

      expect(pool.getStatus().useWorker).toBe(false);
    });

    it('should handle Worker creation failure', () => {
      vi.stubGlobal('Worker', class {
        constructor() {
          throw new Error('Worker creation failed');
        }
      });

      pool = new WorkerPool({
        workerScript: 'test.js',
        poolSize: 2,
        fallbackToMainThread: true,
        fallbackFn: vi.fn(),
      });

      expect(pool.getStatus().useWorker).toBe(false);
    });
  });

  describe('submit', () => {
    it('should execute a task and return result', async () => {
      pool = new WorkerPool({ workerScript: 'test.js', poolSize: 1 });

      const promise = pool.submit('echo', { message: 'hello' });
      vi.advanceTimersByTime(50);
      const result = await promise;

      expect(result).toEqual({ processed: { message: 'hello' } });
    });

    it('should handle multiple tasks concurrently', async () => {
      pool = new WorkerPool({ workerScript: 'test.js', poolSize: 2 });

      const p1 = pool.submit('echo', 'task1');
      const p2 = pool.submit('echo', 'task2');

      vi.advanceTimersByTime(50);
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toEqual({ processed: 'task1' });
      expect(r2).toEqual({ processed: 'task2' });
    });

    it('should queue tasks when all workers are busy', async () => {
      pool = new WorkerPool({ workerScript: 'test.js', poolSize: 1 });

      const p1 = pool.submit('echo', 'task1');
      const p2 = pool.submit('echo', 'task2');

      expect(pool.getQueueLength()).toBe(1);

      vi.advanceTimersByTime(50);
      await p1;

      // Task 2 should be dispatched now
      vi.advanceTimersByTime(50);
      const r2 = await p2;

      expect(r2).toEqual({ processed: 'task2' });
      expect(pool.getQueueLength()).toBe(0);
    });

    it('should handle task errors', async () => {
      pool = new WorkerPool({ workerScript: 'test.js', poolSize: 1 });

      const promise = pool.submit('fail', 'data');
      vi.advanceTimersByTime(50);

      await expect(promise).rejects.toThrow('Task failed');
    });

    it('should reject when pool is destroyed', async () => {
      pool = new WorkerPool({ workerScript: 'test.js', poolSize: 1 });
      pool.destroy();

      await expect(pool.submit('echo', 'data')).rejects.toThrow('destroyed');
    });
  });

  describe('timeout', () => {
    it('should reject task on timeout', async () => {
      pool = new WorkerPool({
        workerScript: 'test.js',
        poolSize: 1,
        taskTimeout: 100,
      });

      const promise = pool.submit('slow', 'data');
      vi.advanceTimersByTime(150);

      await expect(promise).rejects.toThrow(/timed out/);
    });
  });

  describe('fallback', () => {
    it('should use fallback function when Worker is not available', async () => {
      vi.stubGlobal('Worker', undefined);
      const fallbackFn = vi.fn((type: string, payload: unknown) => ({
        type,
        result: payload,
      }));

      pool = new WorkerPool({
        workerScript: 'test.js',
        fallbackToMainThread: true,
        fallbackFn,
      });

      const result = await pool.submit('compress', { data: 'test' });
      expect(result).toEqual({ type: 'compress', result: { data: 'test' } });
      expect(fallbackFn).toHaveBeenCalledWith('compress', { data: 'test' });
    });

    it('should handle async fallback function', async () => {
      vi.stubGlobal('Worker', undefined);
      const fallbackFn = vi.fn(async () => 'async-result');

      pool = new WorkerPool({
        workerScript: 'test.js',
        fallbackToMainThread: true,
        fallbackFn,
      });

      const result = await pool.submit('task', null);
      expect(result).toBe('async-result');
    });

    it('should reject when no fallback is provided', async () => {
      vi.stubGlobal('Worker', undefined);

      pool = new WorkerPool({
        workerScript: 'test.js',
        fallbackToMainThread: true,
      });

      await expect(pool.submit('task', null)).rejects.toThrow(/no fallback/i);
    });

    it('should handle fallback function errors', async () => {
      vi.stubGlobal('Worker', undefined);
      const fallbackFn = vi.fn(() => {
        throw new Error('Fallback error');
      });

      pool = new WorkerPool({
        workerScript: 'test.js',
        fallbackToMainThread: true,
        fallbackFn,
      });

      await expect(pool.submit('task', null)).rejects.toThrow('Fallback error');
    });
  });

  describe('getStatus', () => {
    it('should return correct status', async () => {
      pool = new WorkerPool({ workerScript: 'test.js', poolSize: 2 });

      // Initially all idle
      expect(pool.getBusyCount()).toBe(0);

      // Submit a task
      pool.submit('echo', 'data');
      expect(pool.getBusyCount()).toBe(1);

      // Submit more tasks to fill pool + queue
      pool.submit('echo', 'data2');
      pool.submit('echo', 'data3');
      expect(pool.getBusyCount()).toBe(2);
      expect(pool.getQueueLength()).toBe(1);

      // Resolve all
      vi.advanceTimersByTime(100);
    });
  });

  describe('destroy', () => {
    it('should terminate all workers and reject pending tasks', async () => {
      pool = new WorkerPool({ workerScript: 'test.js', poolSize: 1 });

      const p1 = pool.submit('echo', 'data1');
      const p2 = pool.submit('echo', 'data2');

      pool.destroy();

      await expect(p1).rejects.toThrow('destroyed');
      await expect(p2).rejects.toThrow('destroyed');
    });

    it('should be safe to call multiple times', () => {
      pool = new WorkerPool({ workerScript: 'test.js', poolSize: 1 });
      pool.destroy();
      pool.destroy(); // Should not throw
    });
  });
});
