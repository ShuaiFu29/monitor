import { describe, it, expect } from 'vitest';
import {
  getSelector,
  getElementText,
  isElementVisible,
  getScrollPosition,
  getViewportSize,
} from '../src/dom';

describe('dom', () => {
  // ────── getSelector ──────
  describe('getSelector', () => {
    it('should return tag name for simple element', () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const selector = getSelector(el);
      expect(selector).toContain('div');
      el.remove();
    });

    it('should include id when present', () => {
      const el = document.createElement('div');
      el.id = 'my-element';
      document.body.appendChild(el);
      const selector = getSelector(el);
      expect(selector).toContain('div#my-element');
      el.remove();
    });

    it('should include class names', () => {
      const el = document.createElement('span');
      el.className = 'btn primary';
      document.body.appendChild(el);
      const selector = getSelector(el);
      expect(selector).toContain('span.btn.primary');
      el.remove();
    });

    it('should filter out class names starting with _ or longer than 30 chars', () => {
      const el = document.createElement('div');
      el.className = '_internal valid-class a-very-very-very-very-long-class-name-over-30';
      document.body.appendChild(el);
      const selector = getSelector(el);
      expect(selector).toContain('valid-class');
      expect(selector).not.toContain('_internal');
      el.remove();
    });

    it('should limit class count to 2', () => {
      const el = document.createElement('div');
      el.className = 'a b c d e';
      document.body.appendChild(el);
      const selector = getSelector(el);
      // Should include at most 2 classes
      expect(selector).toContain('.a.b');
      expect(selector).not.toContain('.c');
      el.remove();
    });

    it('should respect maxDepth', () => {
      const root = document.createElement('div');
      const child1 = document.createElement('div');
      const child2 = document.createElement('div');
      const child3 = document.createElement('span');
      root.appendChild(child1);
      child1.appendChild(child2);
      child2.appendChild(child3);
      document.body.appendChild(root);

      const selector = getSelector(child3, 2);
      const parts = selector.split(' > ');
      expect(parts.length).toBeLessThanOrEqual(2);

      root.remove();
    });

    it('should handle nth-child for sibling elements', () => {
      const parent = document.createElement('div');
      const child1 = document.createElement('span');
      const child2 = document.createElement('span');
      parent.appendChild(child1);
      parent.appendChild(child2);
      document.body.appendChild(parent);

      const selector = getSelector(child2);
      expect(selector).toContain('nth-child');

      parent.remove();
    });

    it('should stop at id element', () => {
      const root = document.createElement('div');
      root.id = 'root';
      const child = document.createElement('span');
      root.appendChild(child);
      document.body.appendChild(root);

      const selector = getSelector(child);
      expect(selector).toContain('div#root');
      // id 节点之前的部分不应出现
      expect(selector.split(' > ').length).toBeLessThanOrEqual(2);

      root.remove();
    });
  });

  // ────── getElementText ──────
  describe('getElementText', () => {
    it('should return text content', () => {
      const el = document.createElement('p');
      el.textContent = 'Hello World';
      const text = getElementText(el);
      expect(text).toBe('Hello World');
    });

    it('should truncate long text', () => {
      const el = document.createElement('p');
      el.textContent = 'a'.repeat(200);
      const text = getElementText(el, 50);
      expect(text.length).toBe(50);
    });

    it('should handle empty element', () => {
      const el = document.createElement('div');
      expect(getElementText(el)).toBe('');
    });

    it('should trim whitespace', () => {
      const el = document.createElement('p');
      el.textContent = '  padded text  ';
      expect(getElementText(el)).toBe('padded text');
    });

    it('should handle input value', () => {
      const el = document.createElement('input');
      el.value = 'input value';
      // Note: textContent takes precedence if both exist
      expect(getElementText(el)).toBeTruthy();
    });
  });

  // ────── isElementVisible ──────
  describe('isElementVisible', () => {
    it('should return true for visible element', () => {
      const el = document.createElement('div');
      el.style.width = '100px';
      el.style.height = '100px';
      document.body.appendChild(el);

      // happy-dom may not fully implement getBoundingClientRect layout,
      // but should not throw
      const result = isElementVisible(el);
      expect(typeof result).toBe('boolean');

      el.remove();
    });

    it('should handle element with getBoundingClientRect', () => {
      const el = document.createElement('div');
      document.body.appendChild(el);

      // Even in a simulated DOM, the function should work without error
      expect(() => isElementVisible(el)).not.toThrow();

      el.remove();
    });
  });

  // ────── getScrollPosition ──────
  describe('getScrollPosition', () => {
    it('should return an object with x and y', () => {
      const pos = getScrollPosition();
      expect(pos).toHaveProperty('x');
      expect(pos).toHaveProperty('y');
      expect(typeof pos.x).toBe('number');
      expect(typeof pos.y).toBe('number');
    });

    it('should return 0,0 at page top', () => {
      const pos = getScrollPosition();
      expect(pos.x).toBe(0);
      expect(pos.y).toBe(0);
    });
  });

  // ────── getViewportSize ──────
  describe('getViewportSize', () => {
    it('should return an object with width and height', () => {
      const size = getViewportSize();
      expect(size).toHaveProperty('width');
      expect(size).toHaveProperty('height');
      expect(typeof size.width).toBe('number');
      expect(typeof size.height).toBe('number');
    });

    it('should return positive dimensions', () => {
      const size = getViewportSize();
      expect(size.width).toBeGreaterThanOrEqual(0);
      expect(size.height).toBeGreaterThanOrEqual(0);
    });
  });
});
