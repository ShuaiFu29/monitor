import { describe, it, expect } from 'vitest';
import { TraceContext, generateTraceId, generateSpanId } from '../src/trace-context';

describe('trace-context', () => {
  // ────── generateTraceId / generateSpanId ──────
  describe('ID 生成', () => {
    it('traceId 应为 32 字符 hex 字符串', () => {
      const id = generateTraceId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
    });

    it('spanId 应为 16 字符 hex 字符串', () => {
      const id = generateSpanId();
      expect(id).toMatch(/^[0-9a-f]{16}$/);
    });

    it('每次生成的 ID 应不同', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
      expect(ids.size).toBe(100);
    });
  });

  // ────── TraceContext ──────
  describe('TraceContext', () => {
    it('getTraceId 应返回固定的 traceId', () => {
      const ctx = new TraceContext();
      const id1 = ctx.getTraceId();
      const id2 = ctx.getTraceId();
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^[0-9a-f]{32}$/);
    });

    it('generateSpanId 每次应返回不同值', () => {
      const ctx = new TraceContext();
      const span1 = ctx.generateSpanId();
      const span2 = ctx.generateSpanId();
      expect(span1).not.toBe(span2);
    });

    it('shouldTrace 默认应对所有 URL 返回 true', () => {
      const ctx = new TraceContext();
      expect(ctx.shouldTrace('http://example.com/api/data')).toBe(true);
    });

    it('shouldTrace 禁用时应返回 false', () => {
      const ctx = new TraceContext({ enabled: false });
      expect(ctx.shouldTrace('http://example.com/api/data')).toBe(false);
    });

    it('shouldTrace 应按 traceUrls 过滤（字符串）', () => {
      const ctx = new TraceContext({
        traceUrls: ['api.example.com'],
      });
      expect(ctx.shouldTrace('http://api.example.com/data')).toBe(true);
      expect(ctx.shouldTrace('http://other.com/data')).toBe(false);
    });

    it('shouldTrace 应按 traceUrls 过滤（正则）', () => {
      const ctx = new TraceContext({
        traceUrls: [/^https?:\/\/api\./],
      });
      expect(ctx.shouldTrace('http://api.example.com/data')).toBe(true);
      expect(ctx.shouldTrace('http://cdn.example.com/data')).toBe(false);
    });
  });

  // ────── createHeaders ──────
  describe('createHeaders', () => {
    it('应生成包含 X-Trace-Id 和 X-Span-Id 的 headers', () => {
      const ctx = new TraceContext();
      const headers = ctx.createHeaders('http://api.example.com/data');

      expect(headers['X-Trace-Id']).toBe(ctx.getTraceId());
      expect(headers['X-Span-Id']).toMatch(/^[0-9a-f]{16}$/);
    });

    it('应生成 W3C traceparent header', () => {
      const ctx = new TraceContext();
      const headers = ctx.createHeaders('http://api.example.com/data');

      const traceparent = headers['traceparent'];
      expect(traceparent).toBeDefined();

      // 格式: 00-traceId-spanId-01
      const parts = traceparent.split('-');
      expect(parts.length).toBe(4);
      expect(parts[0]).toBe('00');
      expect(parts[1]).toBe(ctx.getTraceId());
      expect(parts[2]).toMatch(/^[0-9a-f]{16}$/);
      expect(parts[3]).toBe('01');
    });

    it('禁用 W3C 格式时不应生成 traceparent', () => {
      const ctx = new TraceContext({ useW3CFormat: false });
      const headers = ctx.createHeaders('http://api.example.com/data');

      expect(headers['traceparent']).toBeUndefined();
      expect(headers['X-Trace-Id']).toBeDefined();
    });

    it('URL 不在 traceUrls 中时应返回空 headers', () => {
      const ctx = new TraceContext({ traceUrls: ['api.example.com'] });
      const headers = ctx.createHeaders('http://other.com/data');

      expect(Object.keys(headers).length).toBe(0);
    });

    it('应支持自定义 header 名称', () => {
      const ctx = new TraceContext({
        headerNames: {
          traceId: 'X-My-Trace',
          spanId: 'X-My-Span',
        },
      });
      const headers = ctx.createHeaders('http://api.example.com/data');

      expect(headers['X-My-Trace']).toBeDefined();
      expect(headers['X-My-Span']).toBeDefined();
      expect(headers['X-Trace-Id']).toBeUndefined();
    });
  });
});
