import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClickTracker } from '../src/click-tracker';
import type { ClickEvent } from '../src/click-tracker';

describe('ClickTracker', () => {
  let tracker: ClickTracker;
  let events: ClickEvent[];

  beforeEach(() => {
    events = [];
    tracker = new ClickTracker((event) => {
      events.push(event);
    });
  });

  afterEach(() => {
    tracker.stop();
  });

  describe('start/stop', () => {
    it('should start tracking clicks', () => {
      tracker.start();
      expect(tracker.isTracking()).toBe(true);
    });

    it('should stop tracking clicks', () => {
      tracker.start();
      tracker.stop();
      expect(tracker.isTracking()).toBe(false);
    });

    it('should not start twice', () => {
      tracker.start();
      tracker.start(); // No-op
      expect(tracker.isTracking()).toBe(true);
    });

    it('should not record events when stopped', () => {
      tracker.start();
      tracker.stop();

      const div = document.createElement('div');
      document.body.appendChild(div);
      div.click();
      document.body.removeChild(div);

      expect(events).toHaveLength(0);
    });
  });

  describe('click recording', () => {
    it('should record click events', () => {
      tracker.start();

      const button = document.createElement('button');
      button.textContent = 'Click me';
      document.body.appendChild(button);

      button.click();
      document.body.removeChild(button);

      expect(events).toHaveLength(1);
      expect(events[0].tagName).toBe('button');
      expect(events[0].text).toBe('Click me');
      expect(events[0].timestamp).toBeGreaterThan(0);
    });

    it('should record element with id', () => {
      tracker.start();

      const div = document.createElement('div');
      div.id = 'test-div';
      document.body.appendChild(div);

      div.click();
      document.body.removeChild(div);

      expect(events).toHaveLength(1);
      expect(events[0].selector).toContain('#test-div');
    });

    it('should record element with class', () => {
      tracker.start();

      const div = document.createElement('div');
      div.className = 'btn primary';
      document.body.appendChild(div);

      div.click();
      document.body.removeChild(div);

      expect(events).toHaveLength(1);
      expect(events[0].selector).toContain('.btn');
    });

    it('should truncate long text', () => {
      const customTracker = new ClickTracker(
        (event) => events.push(event),
        { textMaxLength: 20 },
      );
      customTracker.start();

      const div = document.createElement('div');
      div.textContent = 'This is a very long text that should be truncated for brevity';
      document.body.appendChild(div);

      div.click();
      document.body.removeChild(div);
      customTracker.stop();

      expect(events).toHaveLength(1);
      expect(events[0].text.length).toBeLessThanOrEqual(23); // 20 + '...'
      expect(events[0].text).toContain('...');
    });
  });

  describe('getSelector', () => {
    it('should generate selector with tag name', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      const selector = tracker.getSelector(div);
      expect(selector).toContain('div');
      document.body.removeChild(div);
    });

    it('should stop at element with id', () => {
      const parent = document.createElement('div');
      parent.id = 'parent';
      const child = document.createElement('span');
      parent.appendChild(child);
      document.body.appendChild(parent);

      const selector = tracker.getSelector(child);
      expect(selector).toContain('#parent');
      expect(selector).toContain('span');
      document.body.removeChild(parent);
    });

    it('should limit depth', () => {
      const customTracker = new ClickTracker(
        () => {},
        { selectorMaxDepth: 2 },
      );

      const root = document.createElement('div');
      const level1 = document.createElement('div');
      const level2 = document.createElement('div');
      const level3 = document.createElement('span');

      root.appendChild(level1);
      level1.appendChild(level2);
      level2.appendChild(level3);
      document.body.appendChild(root);

      const selector = customTracker.getSelector(level3);
      const parts = selector.split(' > ');
      expect(parts.length).toBeLessThanOrEqual(2);

      document.body.removeChild(root);
    });
  });
});
