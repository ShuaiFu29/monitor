import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HeatmapCollector } from '../src/heatmap';
import type { HeatmapPoint } from '../src/heatmap';

describe('HeatmapCollector', () => {
  let collector: HeatmapCollector;
  let flushedPoints: HeatmapPoint[][];

  beforeEach(() => {
    vi.useFakeTimers();
    flushedPoints = [];
    collector = new HeatmapCollector(
      (points) => flushedPoints.push(points),
      { flushInterval: 1000, maxPoints: 5, dedupeInterval: 100 },
    );
  });

  afterEach(() => {
    collector.stop();
    vi.useRealTimers();
  });

  describe('start/stop', () => {
    it('should start collecting', () => {
      collector.start();
      expect(collector.isCollecting()).toBe(true);
    });

    it('should stop collecting', () => {
      collector.start();
      collector.stop();
      expect(collector.isCollecting()).toBe(false);
    });

    it('should flush on stop', () => {
      collector.start();

      // Simulate a click
      const clickEvent = new MouseEvent('click', {
        clientX: 100,
        clientY: 200,
        bubbles: true,
      });
      Object.defineProperty(clickEvent, 'pageX', { value: 100 });
      Object.defineProperty(clickEvent, 'pageY', { value: 200 });
      document.dispatchEvent(clickEvent);

      expect(collector.getBufferSize()).toBe(1);
      collector.stop();
      expect(flushedPoints).toHaveLength(1);
      expect(flushedPoints[0]).toHaveLength(1);
    });
  });

  describe('data collection', () => {
    it('should record click positions', () => {
      collector.start();

      const event = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'pageX', { value: 150 });
      Object.defineProperty(event, 'pageY', { value: 250 });
      document.dispatchEvent(event);

      expect(collector.getBufferSize()).toBe(1);
    });

    it('should auto-flush when buffer is full', () => {
      collector.start();

      // Generate maxPoints + 1 clicks with enough spacing
      for (let i = 0; i < 6; i++) {
        vi.advanceTimersByTime(200); // Exceed dedupeInterval
        const event = new MouseEvent('click', { bubbles: true });
        Object.defineProperty(event, 'pageX', { value: i * 100 });
        Object.defineProperty(event, 'pageY', { value: i * 100 });
        document.dispatchEvent(event);
      }

      // Should have flushed at least once (after 5th click)
      expect(flushedPoints.length).toBeGreaterThanOrEqual(1);
    });

    it('should flush on timer interval', () => {
      collector.start();

      const event = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'pageX', { value: 50 });
      Object.defineProperty(event, 'pageY', { value: 50 });
      document.dispatchEvent(event);

      vi.advanceTimersByTime(1100);

      expect(flushedPoints).toHaveLength(1);
    });

    it('should deduplicate close clicks', () => {
      collector.start();

      // Two clicks at nearly same position within dedupeInterval
      const event1 = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event1, 'pageX', { value: 100 });
      Object.defineProperty(event1, 'pageY', { value: 100 });
      document.dispatchEvent(event1);

      // Second click within dedupe interval at same position
      const event2 = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event2, 'pageX', { value: 101 });
      Object.defineProperty(event2, 'pageY', { value: 101 });
      document.dispatchEvent(event2);

      expect(collector.getBufferSize()).toBe(1); // Second was deduped
    });

    it('should not deduplicate distant clicks', () => {
      collector.start();

      const event1 = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event1, 'pageX', { value: 100 });
      Object.defineProperty(event1, 'pageY', { value: 100 });
      document.dispatchEvent(event1);

      const event2 = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event2, 'pageX', { value: 200 });
      Object.defineProperty(event2, 'pageY', { value: 200 });
      document.dispatchEvent(event2);

      expect(collector.getBufferSize()).toBe(2);
    });

    it('should include page path in data', () => {
      collector.start();

      const event = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'pageX', { value: 50 });
      Object.defineProperty(event, 'pageY', { value: 50 });
      document.dispatchEvent(event);

      collector.flush();

      expect(flushedPoints[0][0].path).toBeDefined();
    });
  });

  describe('manual flush', () => {
    it('should not flush empty buffer', () => {
      collector.flush();
      expect(flushedPoints).toHaveLength(0);
    });
  });
});
