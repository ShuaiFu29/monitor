import { describe, it, expect } from 'vitest';
import { hashString, fnv1aHash, generateId } from '../src/hash';

describe('hashString (DJB2)', () => {
  it('should return consistent hash for the same input', () => {
    const a = hashString('hello world');
    const b = hashString('hello world');
    expect(a).toBe(b);
  });

  it('should return different hashes for different inputs', () => {
    const a = hashString('hello');
    const b = hashString('world');
    expect(a).not.toBe(b);
  });

  it('should handle empty string', () => {
    const result = hashString('');
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('should handle special characters', () => {
    const result = hashString('!@#$%^&*()_+{}:"<>?');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle unicode characters', () => {
    const result = hashString('你好世界🌍');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle very long strings', () => {
    const longStr = 'a'.repeat(10000);
    const result = hashString(longStr);
    expect(typeof result).toBe('string');
  });
});

describe('fnv1aHash', () => {
  it('should return consistent hash for the same input', () => {
    const a = fnv1aHash('test string');
    const b = fnv1aHash('test string');
    expect(a).toBe(b);
  });

  it('should return different hashes for different inputs', () => {
    const a = fnv1aHash('abc');
    const b = fnv1aHash('def');
    expect(a).not.toBe(b);
  });

  it('should produce different output than DJB2 for same input', () => {
    const input = 'hello';
    expect(fnv1aHash(input)).not.toBe(hashString(input));
  });
});

describe('generateId', () => {
  it('should return a non-empty string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('should generate unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(1000);
  });

  it('should contain a hyphen separator', () => {
    const id = generateId();
    expect(id).toContain('-');
  });
});
