import type { Breadcrumb, EventLevel } from '@monitor/types';
import { now } from '@monitor/utils';

/**
 * 面包屑管理器
 *
 * 使用环形缓冲（Ring Buffer）实现固定容量的面包屑队列。
 * 当新增面包屑超出容量时，自动淘汰最旧的条目。
 *
 * 特性：
 * - O(1) 添加
 * - O(n) 获取全部（按时间顺序）
 * - 固定内存占用（不随时间增长）
 * - 线程安全（单线程 JS 环境下天然安全）
 */

/**
 * 面包屑管理器配置
 */
export interface BreadcrumbConfig {
  /** 最大容量，默认 50 */
  maxSize?: number;
}

const DEFAULT_MAX_SIZE = 50;

export class BreadcrumbManager {
  private buffer: (Breadcrumb | null)[];
  private head: number = 0; // 写入位置
  private count: number = 0; // 当前存储数量
  private readonly maxSize: number;

  constructor(config: BreadcrumbConfig = {}) {
    this.maxSize = Math.max(1, config.maxSize ?? DEFAULT_MAX_SIZE);
    this.buffer = new Array(this.maxSize).fill(null);
  }

  /**
   * 添加面包屑
   *
   * @param crumb - 面包屑数据（timestamp 会自动设置）
   */
  add(crumb: Omit<Breadcrumb, 'timestamp'> & { timestamp?: number }): void {
    const breadcrumb: Breadcrumb = {
      message: crumb.message,
      category: crumb.category,
      level: crumb.level,
      data: crumb.data,
      timestamp: crumb.timestamp ?? now(),
    };

    this.buffer[this.head] = breadcrumb;
    this.head = (this.head + 1) % this.maxSize;
    if (this.count < this.maxSize) {
      this.count++;
    }
  }

  /**
   * 获取所有面包屑，按时间从旧到新排列
   */
  getAll(): Breadcrumb[] {
    if (this.count === 0) return [];

    const result: Breadcrumb[] = [];

    // 如果缓冲区未满，从 0 开始读取
    // 如果缓冲区已满，从 head 开始读取（head 指向最旧的将被覆盖位置）
    const start = this.count < this.maxSize ? 0 : this.head;

    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.maxSize;
      const crumb = this.buffer[idx];
      if (crumb) {
        result.push(crumb);
      }
    }

    return result;
  }

  /**
   * 获取最后 N 条面包屑
   */
  getLast(n: number): Breadcrumb[] {
    const all = this.getAll();
    return all.slice(-n);
  }

  /**
   * 获取当前面包屑数量
   */
  size(): number {
    return this.count;
  }

  /**
   * 清空所有面包屑
   */
  clear(): void {
    this.buffer = new Array(this.maxSize).fill(null);
    this.head = 0;
    this.count = 0;
  }

  /**
   * 便捷方法：添加 info 级别面包屑
   */
  info(message: string, category: string, data?: Record<string, unknown>): void {
    this.add({ message, category, level: 'info' as EventLevel, data });
  }

  /**
   * 便捷方法：添加 warning 级别面包屑
   */
  warn(message: string, category: string, data?: Record<string, unknown>): void {
    this.add({ message, category, level: 'warning' as EventLevel, data });
  }

  /**
   * 便捷方法：添加 error 级别面包屑
   */
  error(message: string, category: string, data?: Record<string, unknown>): void {
    this.add({ message, category, level: 'error' as EventLevel, data });
  }
}
