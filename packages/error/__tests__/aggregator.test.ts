import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StackFrame } from '@monitor/types';
import { ErrorAggregator } from '../src/aggregator';

describe('ErrorAggregator', () => {
  let aggregator: ErrorAggregator;

  beforeEach(() => {
    aggregator = new ErrorAggregator({
      fingerprintFrames: 3,
      dedupeInterval: 60_000,
      maxTracked: 5,
    });
  });

  // ────── 指纹生成 ──────
  describe('generateFingerprint', () => {
    const frames: StackFrame[] = [
      { url: 'http://example.com/app.js', line: 10, column: 5, function: 'fetchData' },
      { url: 'http://example.com/app.js', line: 20, column: 3, function: 'handleClick' },
      { url: 'http://example.com/vendor.js', line: 100, column: 1 },
    ];

    it('相同输入应生成相同指纹', () => {
      const fp1 = aggregator.generateFingerprint('TypeError', 'Cannot read property x', frames);
      const fp2 = aggregator.generateFingerprint('TypeError', 'Cannot read property x', frames);
      expect(fp1).toBe(fp2);
    });

    it('不同错误类型应生成不同指纹', () => {
      const fp1 = aggregator.generateFingerprint('TypeError', 'Cannot read x', frames);
      const fp2 = aggregator.generateFingerprint('ReferenceError', 'Cannot read x', frames);
      expect(fp1).not.toBe(fp2);
    });

    it('不同错误消息应生成不同指纹', () => {
      const fp1 = aggregator.generateFingerprint('Error', 'message A', frames);
      const fp2 = aggregator.generateFingerprint('Error', 'message B', frames);
      expect(fp1).not.toBe(fp2);
    });

    it('不同堆栈位置应生成不同指纹', () => {
      const frames2: StackFrame[] = [
        { url: 'http://example.com/other.js', line: 50, column: 5, function: 'otherFunc' },
      ];
      const fp1 = aggregator.generateFingerprint('Error', 'test', frames);
      const fp2 = aggregator.generateFingerprint('Error', 'test', frames2);
      expect(fp1).not.toBe(fp2);
    });

    it('应标准化消息中的动态数字', () => {
      const fp1 = aggregator.generateFingerprint('Error', 'Timeout after 5000ms', frames);
      const fp2 = aggregator.generateFingerprint('Error', 'Timeout after 3000ms', frames);
      // 数字被替换为 <n>，所以指纹应相同
      expect(fp1).toBe(fp2);
    });

    it('应标准化十六进制地址', () => {
      const fp1 = aggregator.generateFingerprint('Error', 'Invalid memory at 0x7fff1234', frames);
      const fp2 = aggregator.generateFingerprint('Error', 'Invalid memory at 0xdeadbeef', frames);
      expect(fp1).toBe(fp2);
    });

    it('空帧数组应仍生成指纹', () => {
      const fp = aggregator.generateFingerprint('Error', 'test', []);
      expect(fp).toBeTruthy();
      expect(typeof fp).toBe('string');
    });

    it('只取前 N 帧（fingerprintFrames 配置）', () => {
      const manyFrames: StackFrame[] = [
        { url: 'http://example.com/a.js', line: 1, column: 1, function: 'a' },
        { url: 'http://example.com/b.js', line: 2, column: 1, function: 'b' },
        { url: 'http://example.com/c.js', line: 3, column: 1, function: 'c' },
        { url: 'http://example.com/d.js', line: 4, column: 1, function: 'd' },
        { url: 'http://example.com/e.js', line: 5, column: 1, function: 'e' },
      ];

      // 改变第4帧不应影响指纹（因为只取前3帧）
      const manyFrames2 = [...manyFrames];
      manyFrames2[3] = { url: 'http://example.com/x.js', line: 99, column: 1, function: 'x' };

      const fp1 = aggregator.generateFingerprint('Error', 'test', manyFrames);
      const fp2 = aggregator.generateFingerprint('Error', 'test', manyFrames2);
      expect(fp1).toBe(fp2);
    });
  });

  // ────── 去重判断 ──────
  describe('shouldReport', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('新指纹应允许上报', () => {
      expect(aggregator.shouldReport('fp-001')).toBe(true);
    });

    it('重复指纹在去重窗口内应拒绝上报', () => {
      expect(aggregator.shouldReport('fp-001')).toBe(true);
      expect(aggregator.shouldReport('fp-001')).toBe(false);
      expect(aggregator.shouldReport('fp-001')).toBe(false);
    });

    it('重复指纹超出去重窗口后应允许上报', () => {
      expect(aggregator.shouldReport('fp-001')).toBe(true);

      // 推进时间超过 dedupeInterval
      vi.advanceTimersByTime(60_001);

      expect(aggregator.shouldReport('fp-001')).toBe(true);
    });

    it('不同指纹应各自独立判断', () => {
      expect(aggregator.shouldReport('fp-001')).toBe(true);
      expect(aggregator.shouldReport('fp-002')).toBe(true);
      expect(aggregator.shouldReport('fp-001')).toBe(false); // 重复
      expect(aggregator.shouldReport('fp-002')).toBe(false); // 重复
    });

    it('应正确计数', () => {
      aggregator.shouldReport('fp-001');
      aggregator.shouldReport('fp-001');
      aggregator.shouldReport('fp-001');

      const stats = aggregator.getStats('fp-001');
      expect(stats).toBeDefined();
      expect(stats!.count).toBe(3);
    });
  });

  // ────── 容量控制 ──────
  describe('容量控制', () => {
    it('超出 maxTracked 应淘汰最旧的', () => {
      vi.useFakeTimers();

      // 添加 5 个指纹（达到 maxTracked）
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(100);
        aggregator.shouldReport(`fp-${i}`);
      }
      expect(aggregator.getTrackedCount()).toBe(5);

      // 再添加一个，应淘汰 fp-0（最旧）
      vi.advanceTimersByTime(100);
      aggregator.shouldReport('fp-new');
      expect(aggregator.getTrackedCount()).toBe(5);
      expect(aggregator.getStats('fp-0')).toBeUndefined();
      expect(aggregator.getStats('fp-new')).toBeDefined();

      vi.useRealTimers();
    });
  });

  // ────── clear ──────
  describe('clear', () => {
    it('应清空所有统计', () => {
      aggregator.shouldReport('fp-001');
      aggregator.shouldReport('fp-002');
      expect(aggregator.getTrackedCount()).toBe(2);

      aggregator.clear();
      expect(aggregator.getTrackedCount()).toBe(0);
    });
  });
});
