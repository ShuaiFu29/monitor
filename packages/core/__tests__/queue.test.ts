import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventQueue } from '../src/queue';
import type { BaseEvent } from '@monitor/types';

function createEvent(overrides?: Partial<BaseEvent>): BaseEvent {
  return {
    id: `evt-${Math.random()}`,
    type: 'custom',
    timestamp: Date.now(),
    sessionId: 'test-session',
    ...overrides,
  };
}

describe('EventQueue', () => {
  let queue: EventQueue;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    queue?.destroy();
    vi.useRealTimers();
  });

  describe('enqueue / flush', () => {
    it('should buffer events and flush them', () => {
      const flushHandler = vi.fn();
      queue = new EventQueue({ batchSize: 5 });
      queue.setFlushHandler(flushHandler);

      const event1 = createEvent();
      const event2 = createEvent();

      queue.enqueue(event1);
      queue.enqueue(event2);
      expect(queue.size()).toBe(2);

      queue.flush();
      expect(flushHandler).toHaveBeenCalledWith([event1, event2]);
      expect(queue.size()).toBe(0);
    });

    it('should auto-flush when reaching batchSize', () => {
      const flushHandler = vi.fn();
      queue = new EventQueue({ batchSize: 3 });
      queue.setFlushHandler(flushHandler);

      queue.enqueue(createEvent());
      queue.enqueue(createEvent());
      expect(flushHandler).not.toHaveBeenCalled();

      queue.enqueue(createEvent());
      expect(flushHandler).toHaveBeenCalledTimes(1);
      expect(flushHandler.mock.calls[0][0]).toHaveLength(3);
    });

    it('should not call flushHandler when queue is empty', () => {
      const flushHandler = vi.fn();
      queue = new EventQueue();
      queue.setFlushHandler(flushHandler);

      queue.flush();
      expect(flushHandler).not.toHaveBeenCalled();
    });
  });

  describe('timer-based flush', () => {
    it('should auto-flush on interval', () => {
      const flushHandler = vi.fn();
      queue = new EventQueue({ flushInterval: 2000 });
      queue.setFlushHandler(flushHandler);
      queue.start();

      queue.enqueue(createEvent());

      vi.advanceTimersByTime(1999);
      expect(flushHandler).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(flushHandler).toHaveBeenCalledTimes(1);
    });

    it('should not start multiple timers', () => {
      queue = new EventQueue({ flushInterval: 1000 });
      const flushHandler = vi.fn();
      queue.setFlushHandler(flushHandler);

      queue.start();
      queue.start(); // duplicate call

      queue.enqueue(createEvent());
      vi.advanceTimersByTime(1000);

      // Should only fire once
      expect(flushHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop', () => {
    it('should stop the interval timer', () => {
      const flushHandler = vi.fn();
      queue = new EventQueue({ flushInterval: 1000 });
      queue.setFlushHandler(flushHandler);
      queue.start();

      queue.enqueue(createEvent());
      queue.stop();

      vi.advanceTimersByTime(5000);
      expect(flushHandler).not.toHaveBeenCalled();
    });
  });

  describe('maxQueueSize', () => {
    it('should auto-flush when exceeding maxQueueSize', () => {
      const flushHandler = vi.fn();
      queue = new EventQueue({ batchSize: 1000, maxQueueSize: 5 });
      queue.setFlushHandler(flushHandler);

      for (let i = 0; i < 5; i++) {
        queue.enqueue(createEvent());
      }

      expect(flushHandler).toHaveBeenCalledTimes(1);
      expect(flushHandler.mock.calls[0][0]).toHaveLength(5);
    });
  });

  describe('clear', () => {
    it('should clear queue without flushing', () => {
      const flushHandler = vi.fn();
      queue = new EventQueue();
      queue.setFlushHandler(flushHandler);

      queue.enqueue(createEvent());
      queue.enqueue(createEvent());
      queue.clear();

      expect(queue.size()).toBe(0);
      expect(flushHandler).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should flush remaining events and stop timer', () => {
      const flushHandler = vi.fn();
      queue = new EventQueue({ flushInterval: 1000 });
      queue.setFlushHandler(flushHandler);
      queue.start();

      queue.enqueue(createEvent());
      queue.destroy();

      // Should have flushed remaining events
      expect(flushHandler).toHaveBeenCalledTimes(1);

      // Timer should be stopped - no more flushes
      queue.setFlushHandler(vi.fn()); // won't be set because onFlush is null after destroy
      vi.advanceTimersByTime(5000);
    });
  });
});
