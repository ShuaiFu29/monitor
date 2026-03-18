import { logger } from '@monitor/utils';

/**
 * Worker 任务
 */
interface WorkerTask<T = unknown> {
  /** 任务唯一 ID */
  id: number;
  /** 任务类型 */
  type: string;
  /** 任务负载数据 */
  payload: unknown;
  /** 任务超时时间 (ms) */
  timeout: number;
  /** 成功回调 */
  resolve: (value: T) => void;
  /** 失败回调 */
  reject: (reason: Error) => void;
  /** 超时定时器 */
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Worker 包装器 — 管理单个 Worker 实例
 */
interface WorkerWrapper {
  /** Worker 实例 */
  worker: Worker;
  /** 当前是否繁忙 */
  busy: boolean;
  /** 当前正在处理的任务 */
  currentTask: WorkerTask | null;
}

/**
 * WorkerPool 配置
 */
export interface WorkerPoolConfig {
  /** Worker 脚本 URL 或 Blob URL */
  workerScript: string | URL;
  /** 池大小（最大 Worker 数），默认 2 */
  poolSize?: number;
  /** 单个任务超时时间 (ms)，默认 10000 */
  taskTimeout?: number;
  /** 是否在不支持 Worker 时自动降级到主线程，默认 true */
  fallbackToMainThread?: boolean;
  /** 主线程降级执行函数 */
  fallbackFn?: (type: string, payload: unknown) => unknown | Promise<unknown>;
}

/**
 * WorkerPool — Web Worker 线程池
 *
 * 功能：
 * 1. 管理多个 Worker 实例组成的线程池
 * 2. 任务排队与分发：空闲 Worker 立即执行，忙时任务排队
 * 3. 超时控制：任务超时自动 reject
 * 4. 主线程降级：不支持 Worker 时自动降级
 * 5. 资源清理：destroy 时终止所有 Worker 和待处理任务
 *
 * 通信协议：
 * - 主线程 → Worker: { id, type, payload }
 * - Worker → 主线程: { id, result } | { id, error }
 */
export class WorkerPool {
  private workers: WorkerWrapper[] = [];
  private taskQueue: WorkerTask[] = [];
  private taskIdCounter: number = 0;
  private destroyed: boolean = false;
  private useWorker: boolean = false;

  private readonly poolSize: number;
  private readonly taskTimeout: number;
  private readonly fallbackToMainThread: boolean;
  private readonly fallbackFn?: (type: string, payload: unknown) => unknown | Promise<unknown>;
  private readonly workerScript: string | URL;

  constructor(config: WorkerPoolConfig) {
    this.workerScript = config.workerScript;
    this.poolSize = config.poolSize ?? 2;
    this.taskTimeout = config.taskTimeout ?? 10000;
    this.fallbackToMainThread = config.fallbackToMainThread ?? true;
    this.fallbackFn = config.fallbackFn;

    this.useWorker = this.isWorkerSupported();

    if (this.useWorker) {
      this.initWorkers();
    } else if (!this.fallbackToMainThread) {
      logger.warn('[WorkerPool] Web Worker not supported and fallback disabled');
    }
  }

  /**
   * 提交任务到线程池
   *
   * @param type 任务类型
   * @param payload 任务负载
   * @param timeout 可选的任务超时覆盖
   * @returns 任务结果 Promise
   */
  submit<T = unknown>(type: string, payload: unknown, timeout?: number): Promise<T> {
    if (this.destroyed) {
      return Promise.reject(new Error('WorkerPool has been destroyed'));
    }

    // 降级到主线程
    if (!this.useWorker) {
      return this.executeFallback<T>(type, payload);
    }

    return new Promise<T>((resolve, reject) => {
      const task: WorkerTask<T> = {
        id: ++this.taskIdCounter,
        type,
        payload,
        timeout: timeout ?? this.taskTimeout,
        resolve: resolve as (value: unknown) => void,
        reject,
      };

      // 查找空闲 Worker
      const idleWorker = this.findIdleWorker();
      if (idleWorker) {
        this.executeTask(idleWorker, task as WorkerTask);
      } else {
        // 排队等待
        this.taskQueue.push(task as WorkerTask);
      }
    });
  }

  /**
   * 获取池状态
   */
  getStatus(): {
    poolSize: number;
    busyCount: number;
    queueLength: number;
    useWorker: boolean;
  } {
    return {
      poolSize: this.workers.length,
      busyCount: this.workers.filter((w) => w.busy).length,
      queueLength: this.taskQueue.length,
      useWorker: this.useWorker,
    };
  }

  /**
   * 获取排队任务数量
   */
  getQueueLength(): number {
    return this.taskQueue.length;
  }

  /**
   * 获取当前繁忙 Worker 数量
   */
  getBusyCount(): number {
    return this.workers.filter((w) => w.busy).length;
  }

  /**
   * 销毁线程池
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    // 终止所有 Worker
    for (const wrapper of this.workers) {
      if (wrapper.currentTask?.timer) {
        clearTimeout(wrapper.currentTask.timer);
      }
      if (wrapper.currentTask) {
        wrapper.currentTask.reject(new Error('WorkerPool destroyed'));
      }
      wrapper.worker.terminate();
    }

    // reject 所有排队任务
    for (const task of this.taskQueue) {
      if (task.timer) {
        clearTimeout(task.timer);
      }
      task.reject(new Error('WorkerPool destroyed'));
    }

    this.workers = [];
    this.taskQueue = [];

    logger.info('[WorkerPool] Destroyed');
  }

  /**
   * 检查环境是否支持 Web Worker
   */
  private isWorkerSupported(): boolean {
    return typeof Worker !== 'undefined';
  }

  /**
   * 初始化 Worker 实例
   */
  private initWorkers(): void {
    for (let i = 0; i < this.poolSize; i++) {
      try {
        const worker = new Worker(this.workerScript);
        const wrapper: WorkerWrapper = {
          worker,
          busy: false,
          currentTask: null,
        };

        worker.onmessage = (event: MessageEvent) => {
          this.handleWorkerMessage(wrapper, event);
        };

        worker.onerror = (event: ErrorEvent) => {
          this.handleWorkerError(wrapper, event);
        };

        this.workers.push(wrapper);
      } catch (error) {
        logger.error(`[WorkerPool] Failed to create worker ${i}:`, error as Error);
      }
    }

    // 如果所有 Worker 创建失败，降级到主线程
    if (this.workers.length === 0) {
      logger.warn('[WorkerPool] All workers failed to initialize, falling back to main thread');
      this.useWorker = false;
    }
  }

  /**
   * 查找空闲 Worker
   */
  private findIdleWorker(): WorkerWrapper | null {
    return this.workers.find((w) => !w.busy) ?? null;
  }

  /**
   * 在 Worker 上执行任务
   */
  private executeTask(wrapper: WorkerWrapper, task: WorkerTask): void {
    wrapper.busy = true;
    wrapper.currentTask = task;

    // 设置超时
    task.timer = setTimeout(() => {
      this.handleTaskTimeout(wrapper, task);
    }, task.timeout);

    // 发送消息到 Worker
    wrapper.worker.postMessage({
      id: task.id,
      type: task.type,
      payload: task.payload,
    });
  }

  /**
   * 处理 Worker 返回的消息
   */
  private handleWorkerMessage(wrapper: WorkerWrapper, event: MessageEvent): void {
    const { id, result, error } = event.data ?? {};
    const task = wrapper.currentTask;

    if (!task || task.id !== id) return;

    // 清除超时定时器
    if (task.timer) {
      clearTimeout(task.timer);
    }

    if (error) {
      task.reject(new Error(error));
    } else {
      task.resolve(result);
    }

    // 释放 Worker，处理下一个排队任务
    wrapper.busy = false;
    wrapper.currentTask = null;
    this.processQueue();
  }

  /**
   * 处理 Worker 错误
   */
  private handleWorkerError(wrapper: WorkerWrapper, event: ErrorEvent): void {
    const task = wrapper.currentTask;
    if (task) {
      if (task.timer) {
        clearTimeout(task.timer);
      }
      task.reject(new Error(event.message || 'Worker error'));
    }

    wrapper.busy = false;
    wrapper.currentTask = null;
    this.processQueue();
  }

  /**
   * 处理任务超时
   */
  private handleTaskTimeout(wrapper: WorkerWrapper, task: WorkerTask): void {
    task.reject(new Error(`Task ${task.id} timed out after ${task.timeout}ms`));

    // 终止超时的 Worker 并创建新的替代
    wrapper.worker.terminate();
    wrapper.busy = false;
    wrapper.currentTask = null;

    try {
      wrapper.worker = new Worker(this.workerScript);
      wrapper.worker.onmessage = (event: MessageEvent) => {
        this.handleWorkerMessage(wrapper, event);
      };
      wrapper.worker.onerror = (event: ErrorEvent) => {
        this.handleWorkerError(wrapper, event);
      };
    } catch {
      // 无法重建 Worker，从池中移除
      const index = this.workers.indexOf(wrapper);
      if (index >= 0) {
        this.workers.splice(index, 1);
      }
      if (this.workers.length === 0) {
        this.useWorker = false;
      }
    }

    this.processQueue();
  }

  /**
   * 处理排队任务
   */
  private processQueue(): void {
    if (this.taskQueue.length === 0) return;

    const idleWorker = this.findIdleWorker();
    if (!idleWorker) return;

    const nextTask = this.taskQueue.shift()!;
    this.executeTask(idleWorker, nextTask);
  }

  /**
   * 主线程降级执行
   */
  private executeFallback<T>(type: string, payload: unknown): Promise<T> {
    if (!this.fallbackFn) {
      return Promise.reject(
        new Error('Worker not available and no fallback function provided'),
      );
    }

    try {
      const result = this.fallbackFn(type, payload);
      if (result instanceof Promise) {
        return result as Promise<T>;
      }
      return Promise.resolve(result as T);
    } catch (error) {
      return Promise.reject(error);
    }
  }
}
