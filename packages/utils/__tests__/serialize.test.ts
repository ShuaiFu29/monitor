import { describe, it, expect } from 'vitest';
import { safeStringify, safeParse, truncate, deepClone } from '../src/serialize';

describe('safeStringify', () => {
  it('should stringify simple objects', () => {
    const result = safeStringify({ a: 1, b: 'hello' });
    expect(JSON.parse(result)).toEqual({ a: 1, b: 'hello' });
  });

  it('should handle circular references', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const result = safeStringify(obj);
    expect(result).toContain('[Circular]');
  });

  it('should handle Error objects', () => {
    const error = new Error('test error');
    const result = safeStringify(error);
    const parsed = JSON.parse(result);
    expect(parsed.__type).toBe('Error');
    expect(parsed.message).toBe('test error');
    expect(parsed.name).toBe('Error');
  });

  it('should handle RegExp', () => {
    const result = safeStringify({ pattern: /test/gi });
    expect(result).toContain('/test/gi');
  });

  it('should handle Date objects', () => {
    const date = new Date('2024-01-01T00:00:00.000Z');
    const result = safeStringify({ date });
    expect(result).toContain('2024-01-01');
  });

  it('should handle null and undefined', () => {
    expect(safeStringify(null)).toBe('null');
    // undefined is not valid JSON root, but stringify handles it
    expect(typeof safeStringify(undefined)).toBe('string');
  });

  it('should handle arrays', () => {
    const result = safeStringify([1, 2, 3]);
    expect(JSON.parse(result)).toEqual([1, 2, 3]);
  });

  it('should respect maxDepth', () => {
    const deep = { a: { b: { c: { d: { e: 'deep' } } } } };
    const result = safeStringify(deep, 3);
    expect(result).toContain('[Max Depth]');
  });
});

describe('safeParse', () => {
  it('should parse valid JSON', () => {
    const result = safeParse<{ a: number }>('{"a": 1}');
    expect(result).toEqual({ a: 1 });
  });

  it('should return fallback for invalid JSON', () => {
    const result = safeParse('invalid', { fallback: true });
    expect(result).toEqual({ fallback: true });
  });

  it('should return undefined for invalid JSON without fallback', () => {
    const result = safeParse('invalid');
    expect(result).toBeUndefined();
  });
});

describe('truncate', () => {
  it('should not truncate short strings', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('should truncate long strings with ellipsis', () => {
    const result = truncate('hello world, this is a long string', 15);
    expect(result.length).toBe(15);
    expect(result.endsWith('...')).toBe(true);
  });

  it('should handle exact length', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('should handle empty string', () => {
    expect(truncate('', 10)).toBe('');
  });
});

describe('deepClone', () => {
  it('should clone simple objects', () => {
    const obj = { a: 1, b: 'hello', c: [1, 2, 3] };
    const cloned = deepClone(obj);
    expect(cloned).toEqual(obj);
    expect(cloned).not.toBe(obj);
    expect(cloned.c).not.toBe(obj.c);
  });

  it('should clone nested objects', () => {
    const obj = { a: { b: { c: 1 } } };
    const cloned = deepClone(obj);
    expect(cloned).toEqual(obj);
    expect(cloned.a).not.toBe(obj.a);
    expect(cloned.a.b).not.toBe(obj.a.b);
  });

  it('should handle primitives', () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone('hello')).toBe('hello');
    expect(deepClone(true)).toBe(true);
    expect(deepClone(null)).toBe(null);
  });
});
