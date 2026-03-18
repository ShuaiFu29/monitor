import { describe, it, expect, beforeEach } from 'vitest';
import { Sanitizer } from '../src/sanitizer';

describe('Sanitizer', () => {
  let sanitizer: Sanitizer;

  beforeEach(() => {
    sanitizer = new Sanitizer();
  });

  describe('constructor', () => {
    it('should use default config', () => {
      const config = sanitizer.getConfig();
      expect(config.maskAllInputs).toBe(true);
      expect(config.maskAllText).toBe(false);
      expect(config.blockSelectors).toEqual([]);
      expect(config.ignoreSelectors).toEqual([]);
    });

    it('should merge custom config', () => {
      const custom = new Sanitizer({
        maskAllInputs: false,
        maskAllText: true,
        blockSelectors: ['.secret'],
      });
      const config = custom.getConfig();
      expect(config.maskAllInputs).toBe(false);
      expect(config.maskAllText).toBe(true);
      expect(config.blockSelectors).toEqual(['.secret']);
    });
  });

  describe('shouldBlock', () => {
    it('should block element with data-monitor-block attribute', () => {
      const el = document.createElement('div');
      el.setAttribute('data-monitor-block', '');
      expect(sanitizer.shouldBlock(el)).toBe(true);
    });

    it('should block element matching blockSelectors', () => {
      const s = new Sanitizer({ blockSelectors: ['.secret', '#hidden'] });
      const el = document.createElement('div');
      el.className = 'secret';
      document.body.appendChild(el);
      expect(s.shouldBlock(el)).toBe(true);
      document.body.removeChild(el);
    });

    it('should not block normal elements', () => {
      const el = document.createElement('div');
      expect(sanitizer.shouldBlock(el)).toBe(false);
    });

    it('should handle invalid selector gracefully', () => {
      const s = new Sanitizer({ blockSelectors: ['[invalid>>'] });
      const el = document.createElement('div');
      expect(s.shouldBlock(el)).toBe(false);
    });
  });

  describe('shouldIgnore', () => {
    it('should ignore element with data-monitor-ignore attribute', () => {
      const el = document.createElement('div');
      el.setAttribute('data-monitor-ignore', '');
      expect(sanitizer.shouldIgnore(el)).toBe(true);
    });

    it('should ignore element matching ignoreSelectors', () => {
      const s = new Sanitizer({ ignoreSelectors: ['.debug-panel'] });
      const el = document.createElement('div');
      el.className = 'debug-panel';
      document.body.appendChild(el);
      expect(s.shouldIgnore(el)).toBe(true);
      document.body.removeChild(el);
    });

    it('should not ignore normal elements', () => {
      const el = document.createElement('div');
      expect(sanitizer.shouldIgnore(el)).toBe(false);
    });
  });

  describe('shouldMaskText', () => {
    it('should mask text for element with data-monitor-mask attribute', () => {
      const el = document.createElement('div');
      el.setAttribute('data-monitor-mask', '');
      expect(sanitizer.shouldMaskText(el)).toBe(true);
    });

    it('should mask all text when maskAllText is true', () => {
      const s = new Sanitizer({ maskAllText: true });
      const el = document.createElement('div');
      expect(s.shouldMaskText(el)).toBe(true);
    });

    it('should not mask text for normal elements with default config', () => {
      const el = document.createElement('div');
      expect(sanitizer.shouldMaskText(el)).toBe(false);
    });
  });

  describe('shouldMaskInput', () => {
    it('should always mask password inputs', () => {
      const input = document.createElement('input');
      input.type = 'password';
      // Even with maskAllInputs=false, password should be masked
      const s = new Sanitizer({ maskAllInputs: false });
      expect(s.shouldMaskInput(input)).toBe(true);
    });

    it('should mask all inputs when maskAllInputs is true', () => {
      const input = document.createElement('input');
      input.type = 'text';
      expect(sanitizer.shouldMaskInput(input)).toBe(true);
    });

    it('should not mask text inputs when maskAllInputs is false', () => {
      const s = new Sanitizer({ maskAllInputs: false });
      const input = document.createElement('input');
      input.type = 'text';
      expect(s.shouldMaskInput(input)).toBe(false);
    });

    it('should mask textarea when maskAllInputs is true', () => {
      const textarea = document.createElement('textarea');
      expect(sanitizer.shouldMaskInput(textarea)).toBe(true);
    });

    it('should mask select when maskAllInputs is true', () => {
      const select = document.createElement('select');
      expect(sanitizer.shouldMaskInput(select)).toBe(true);
    });

    it('should mask input with data-monitor-mask attribute', () => {
      const s = new Sanitizer({ maskAllInputs: false });
      const input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('data-monitor-mask', '');
      expect(s.shouldMaskInput(input)).toBe(true);
    });

    it('should mask hidden input type', () => {
      const s = new Sanitizer({ maskAllInputs: false });
      const input = document.createElement('input');
      input.type = 'hidden';
      expect(s.shouldMaskInput(input)).toBe(true);
    });
  });

  describe('maskText', () => {
    it('should replace non-whitespace characters with *', () => {
      expect(sanitizer.maskText('Hello World')).toBe('***** *****');
    });

    it('should preserve whitespace', () => {
      expect(sanitizer.maskText('  A  B  ')).toBe('  *  *  ');
    });

    it('should handle empty string', () => {
      expect(sanitizer.maskText('')).toBe('');
    });
  });

  describe('maskInputValue', () => {
    it('should replace all characters with *', () => {
      expect(sanitizer.maskInputValue('password123')).toBe('***********');
    });

    it('should handle empty value', () => {
      expect(sanitizer.maskInputValue('')).toBe('');
    });

    it('should return undefined for undefined', () => {
      expect(sanitizer.maskInputValue(undefined as unknown as string)).toBe(undefined);
    });
  });

  describe('sanitizeText', () => {
    it('should mask credit card numbers', () => {
      const text = 'Card: 4111 1111 1111 1111';
      const result = sanitizer.sanitizeText(text);
      expect(result).toContain('****');
      expect(result).not.toContain('4111');
    });

    it('should mask credit card with dashes', () => {
      const text = 'Card: 4111-1111-1111-1111';
      const result = sanitizer.sanitizeText(text);
      expect(result).not.toContain('4111');
    });

    it('should mask email addresses', () => {
      const text = 'Contact: user@example.com';
      const result = sanitizer.sanitizeText(text);
      expect(result).toContain('***@***.***');
      expect(result).not.toContain('user@example.com');
    });

    it('should mask Chinese phone numbers', () => {
      const text = 'Call: 13812345678';
      const result = sanitizer.sanitizeText(text);
      expect(result).not.toContain('13812345678');
    });

    it('should mask Chinese ID numbers', () => {
      const text = 'ID: 110101199001011234';
      const result = sanitizer.sanitizeText(text);
      expect(result).not.toContain('110101199001011234');
    });

    it('should not modify normal text', () => {
      const text = 'Hello World, this is a normal text.';
      expect(sanitizer.sanitizeText(text)).toBe(text);
    });

    it('should handle empty string', () => {
      expect(sanitizer.sanitizeText('')).toBe('');
    });

    it('should apply custom patterns', () => {
      const s = new Sanitizer({
        customPatterns: [
          { pattern: /SECRET-\w+/g, replacement: '[REDACTED]' },
        ],
      });
      const text = 'Token: SECRET-abc123';
      expect(s.sanitizeText(text)).toBe('Token: [REDACTED]');
    });
  });

  describe('sanitizeAttribute', () => {
    it('should mask input value attribute', () => {
      const input = document.createElement('input');
      input.type = 'password';
      const result = sanitizer.sanitizeAttribute(input, 'value', 'secret');
      expect(result).toBe('******');
    });

    it('should apply regex sanitization to other attributes', () => {
      const div = document.createElement('div');
      const result = sanitizer.sanitizeAttribute(div, 'title', 'Contact: user@example.com');
      expect(result).toContain('***@***.***');
    });

    it('should not mask value for non-masked inputs', () => {
      const s = new Sanitizer({ maskAllInputs: false });
      const input = document.createElement('input');
      input.type = 'text';
      const result = s.sanitizeAttribute(input, 'value', 'normal text');
      expect(result).toBe('normal text');
    });
  });

  describe('sanitizeNodeText', () => {
    it('should mask text for masked parent element', () => {
      const el = document.createElement('div');
      el.setAttribute('data-monitor-mask', '');
      const result = sanitizer.sanitizeNodeText('Hello World', el);
      expect(result).toBe('***** *****');
    });

    it('should only apply regex for non-masked parent', () => {
      const el = document.createElement('div');
      const result = sanitizer.sanitizeNodeText('user@example.com is here', el);
      expect(result).toContain('***@***.***');
    });

    it('should handle null parent', () => {
      const result = sanitizer.sanitizeNodeText('Hello', null);
      expect(result).toBe('Hello');
    });

    it('should handle empty text', () => {
      const result = sanitizer.sanitizeNodeText('', null);
      expect(result).toBe('');
    });
  });
});
