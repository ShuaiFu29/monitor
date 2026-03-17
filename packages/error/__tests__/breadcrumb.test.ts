import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BreadcrumbManager } from '../src/breadcrumb';

describe('BreadcrumbManager', () => {
  let manager: BreadcrumbManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    manager = new BreadcrumbManager({ maxSize: 5 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ────── 基础操作 ──────
  describe('add / getAll', () => {
    it('应添加面包屑并按时间顺序返回', () => {
      manager.add({ message: 'first', category: 'test', level: 'info' });
      vi.advanceTimersByTime(100);
      manager.add({ message: 'second', category: 'test', level: 'info' });

      const all = manager.getAll();
      expect(all.length).toBe(2);
      expect(all[0].message).toBe('first');
      expect(all[1].message).toBe('second');
      expect(all[0].timestamp).toBeLessThan(all[1].timestamp);
    });

    it('应自动设置 timestamp', () => {
      vi.setSystemTime(5000);
      manager.add({ message: 'test', category: 'test', level: 'info' });

      const all = manager.getAll();
      expect(all[0].timestamp).toBe(5000);
    });

    it('应允许手动设置 timestamp', () => {
      manager.add({ message: 'test', category: 'test', level: 'info', timestamp: 9999 });

      const all = manager.getAll();
      expect(all[0].timestamp).toBe(9999);
    });

    it('应保留附加数据', () => {
      manager.add({
        message: 'click',
        category: 'ui',
        level: 'info',
        data: { selector: '#btn', x: 100, y: 200 },
      });

      const all = manager.getAll();
      expect(all[0].data).toEqual({ selector: '#btn', x: 100, y: 200 });
    });
  });

  // ────── 环形缓冲 ──────
  describe('环形缓冲', () => {
    it('超出容量时应淘汰最旧的', () => {
      for (let i = 0; i < 7; i++) {
        vi.advanceTimersByTime(100);
        manager.add({ message: `msg-${i}`, category: 'test', level: 'info' });
      }

      const all = manager.getAll();
      // maxSize=5，所以只保留最新的 5 条
      expect(all.length).toBe(5);
      expect(all[0].message).toBe('msg-2'); // 最旧被淘汰
      expect(all[4].message).toBe('msg-6'); // 最新
    });

    it('环形缓冲应保持时间顺序', () => {
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(100);
        manager.add({ message: `msg-${i}`, category: 'test', level: 'info' });
      }

      const all = manager.getAll();
      for (let i = 1; i < all.length; i++) {
        expect(all[i].timestamp).toBeGreaterThan(all[i - 1].timestamp);
      }
    });

    it('大量添加不应导致内存增长', () => {
      for (let i = 0; i < 1000; i++) {
        vi.advanceTimersByTime(1);
        manager.add({ message: `msg-${i}`, category: 'test', level: 'info' });
      }

      const all = manager.getAll();
      expect(all.length).toBe(5); // 始终保持 maxSize
    });
  });

  // ────── getLast ──────
  describe('getLast', () => {
    it('应返回最后 N 条', () => {
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(100);
        manager.add({ message: `msg-${i}`, category: 'test', level: 'info' });
      }

      const last2 = manager.getLast(2);
      expect(last2.length).toBe(2);
      expect(last2[0].message).toBe('msg-3');
      expect(last2[1].message).toBe('msg-4');
    });

    it('N 大于总数应返回全部', () => {
      manager.add({ message: 'only', category: 'test', level: 'info' });

      const result = manager.getLast(10);
      expect(result.length).toBe(1);
    });
  });

  // ────── size ──────
  describe('size', () => {
    it('空时应返回 0', () => {
      expect(manager.size()).toBe(0);
    });

    it('添加后应正确计数', () => {
      manager.add({ message: 'a', category: 'test', level: 'info' });
      manager.add({ message: 'b', category: 'test', level: 'info' });
      expect(manager.size()).toBe(2);
    });

    it('超出容量后 size 不超过 maxSize', () => {
      for (let i = 0; i < 10; i++) {
        manager.add({ message: `${i}`, category: 'test', level: 'info' });
      }
      expect(manager.size()).toBe(5);
    });
  });

  // ────── clear ──────
  describe('clear', () => {
    it('应清空所有面包屑', () => {
      manager.add({ message: 'a', category: 'test', level: 'info' });
      manager.add({ message: 'b', category: 'test', level: 'info' });
      manager.clear();

      expect(manager.size()).toBe(0);
      expect(manager.getAll()).toEqual([]);
    });

    it('clear 后可以继续添加', () => {
      manager.add({ message: 'before', category: 'test', level: 'info' });
      manager.clear();
      manager.add({ message: 'after', category: 'test', level: 'info' });

      expect(manager.size()).toBe(1);
      expect(manager.getAll()[0].message).toBe('after');
    });
  });

  // ────── 便捷方法 ──────
  describe('便捷方法', () => {
    it('info() 应设置 info 级别', () => {
      manager.info('loaded', 'page');
      expect(manager.getAll()[0].level).toBe('info');
      expect(manager.getAll()[0].category).toBe('page');
    });

    it('warn() 应设置 warning 级别', () => {
      manager.warn('slow response', 'network');
      expect(manager.getAll()[0].level).toBe('warning');
    });

    it('error() 应设置 error 级别', () => {
      manager.error('fetch failed', 'network');
      expect(manager.getAll()[0].level).toBe('error');
    });

    it('便捷方法应支持附加数据', () => {
      manager.info('click', 'ui', { target: '#btn' });
      expect(manager.getAll()[0].data).toEqual({ target: '#btn' });
    });
  });

  // ────── 边界情况 ──────
  describe('边界情况', () => {
    it('maxSize=1 应只保留最新一条', () => {
      const tiny = new BreadcrumbManager({ maxSize: 1 });
      tiny.add({ message: 'first', category: 'test', level: 'info', timestamp: 1 });
      tiny.add({ message: 'second', category: 'test', level: 'info', timestamp: 2 });

      expect(tiny.size()).toBe(1);
      expect(tiny.getAll()[0].message).toBe('second');
    });

    it('空 getAll 应返回空数组', () => {
      expect(manager.getAll()).toEqual([]);
    });
  });
});
