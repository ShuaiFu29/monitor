import { describe, it, expect } from 'vitest';
import { sanitizeUrl, getUrlPath, matchesIgnorePattern, now, highResNow } from '../src/string';

describe('sanitizeUrl', () => {
  it('should redact sensitive query parameters', () => {
    const url = 'https://example.com/api?token=abc123&name=test';
    const result = sanitizeUrl(url);
    expect(result).toContain('token=%5BREDACTED%5D');
    expect(result).toContain('name=test');
  });

  it('should handle URLs without query parameters', () => {
    const url = 'https://example.com/api';
    expect(sanitizeUrl(url)).toBe('https://example.com/api');
  });

  it('should handle custom sensitive keys', () => {
    const url = 'https://example.com?apiKey=secret&name=test';
    const result = sanitizeUrl(url, ['apiKey']);
    expect(result).toContain('apiKey=%5BREDACTED%5D');
    expect(result).toContain('name=test');
  });

  it('should return original string for invalid URLs', () => {
    expect(sanitizeUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('getUrlPath', () => {
  it('should extract path from URL', () => {
    expect(getUrlPath('https://example.com/api/users?id=1')).toBe('/api/users');
  });

  it('should handle root path', () => {
    expect(getUrlPath('https://example.com/')).toBe('/');
  });

  it('should return original for invalid URLs', () => {
    expect(getUrlPath('invalid')).toBe('invalid');
  });
});

describe('matchesIgnorePattern', () => {
  it('should match string patterns', () => {
    expect(matchesIgnorePattern('/health', ['/health', '/ping'])).toBe(true);
    expect(matchesIgnorePattern('/api/users', ['/health'])).toBe(false);
  });

  it('should match regex patterns', () => {
    expect(matchesIgnorePattern('/api/v1/health', [/\/health$/])).toBe(true);
    expect(matchesIgnorePattern('/api/users', [/\/health$/])).toBe(false);
  });

  it('should match mixed patterns', () => {
    const patterns: Array<string | RegExp> = ['/ping', /^\/internal/];
    expect(matchesIgnorePattern('/ping', patterns)).toBe(true);
    expect(matchesIgnorePattern('/internal/metrics', patterns)).toBe(true);
    expect(matchesIgnorePattern('/api/data', patterns)).toBe(false);
  });

  it('should return false for empty patterns', () => {
    expect(matchesIgnorePattern('/anything', [])).toBe(false);
  });
});

describe('now', () => {
  it('should return a positive number', () => {
    const timestamp = now();
    expect(timestamp).toBeGreaterThan(0);
    expect(typeof timestamp).toBe('number');
  });
});

describe('highResNow', () => {
  it('should return a number', () => {
    const result = highResNow();
    expect(typeof result).toBe('number');
  });
});
