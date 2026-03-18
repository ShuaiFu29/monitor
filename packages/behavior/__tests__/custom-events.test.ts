import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CustomEventsManager } from '../src/custom-events';
import type { CustomBehaviorEvent } from '../src/custom-events';

describe('CustomEventsManager', () => {
  let manager: CustomEventsManager;
  let flushedEvents: CustomBehaviorEvent[][];

  beforeEach(() => {
    vi.useFakeTimers();
    flushedEvents = [];
    manager = new CustomEventsManager(
      (events) => flushedEvents.push(events),
      { maxBuffer: 3, flushInterval: 1000 },
    );
  });

  afterEach(() => {
    manager.stop();
    vi.useRealTimers();
  });

  describe('start/stop', () => {
    it('should start the manager', () => {
      manager.start();
      expect(manager.isActive()).toBe(true);
    });

    it('should stop the manager', () => {
      manager.start();
      manager.stop();
      expect(manager.isActive()).toBe(false);
    });

    it('should flush on stop', () => {
      manager.start();
      manager.track('event1', 'test');
      manager.stop();

      expect(flushedEvents).toHaveLength(1);
      expect(flushedEvents[0]).toHaveLength(1);
    });
  });

  describe('track', () => {
    it('should track a custom event', () => {
      manager.track('add_to_cart', 'ecommerce', { productId: '123' });
      expect(manager.getBufferSize()).toBe(1);
    });

    it('should track events with category', () => {
      manager.track('page_view', 'analytics');
      manager.flush();

      expect(flushedEvents[0][0].name).toBe('page_view');
      expect(flushedEvents[0][0].category).toBe('analytics');
    });

    it('should include timestamp', () => {
      manager.track('click', 'ui');
      manager.flush();

      expect(flushedEvents[0][0].timestamp).toBeGreaterThan(0);
    });

    it('should include data payload', () => {
      manager.track('purchase', 'ecommerce', { amount: 99.99, currency: 'USD' });
      manager.flush();

      expect(flushedEvents[0][0].data).toEqual({ amount: 99.99, currency: 'USD' });
    });

    it('should auto-flush when buffer is full', () => {
      manager.start();

      manager.track('event1', 'test');
      manager.track('event2', 'test');
      manager.track('event3', 'test'); // maxBuffer=3, triggers flush

      expect(flushedEvents).toHaveLength(1);
      expect(flushedEvents[0]).toHaveLength(3);
      expect(manager.getBufferSize()).toBe(0);
    });
  });

  describe('flush', () => {
    it('should not flush empty buffer', () => {
      manager.flush();
      expect(flushedEvents).toHaveLength(0);
    });

    it('should flush on timer', () => {
      manager.start();
      manager.track('timed', 'test');

      vi.advanceTimersByTime(1100);

      expect(flushedEvents).toHaveLength(1);
    });

    it('should clear buffer after flush', () => {
      manager.track('event1', 'test');
      manager.track('event2', 'test');
      manager.flush();

      expect(manager.getBufferSize()).toBe(0);
    });
  });

  describe('multiple events', () => {
    it('should handle many events', () => {
      for (let i = 0; i < 10; i++) {
        manager.track(`event_${i}`, 'bulk');
      }

      // With maxBuffer=3, should have auto-flushed 3 times (3+3+3), 1 left in buffer
      expect(flushedEvents.length).toBe(3);
      expect(manager.getBufferSize()).toBe(1);
    });
  });
});
