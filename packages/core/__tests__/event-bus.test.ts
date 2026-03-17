import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../src/event-bus';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
    vi.restoreAllMocks();
  });

  describe('on / emit', () => {
    it('should subscribe and emit events', async () => {
      const handler = vi.fn();
      bus.on('test', handler);
      await bus.emit('test', { value: 42 });
      expect(handler).toHaveBeenCalledWith({ value: 42 });
    });

    it('should support multiple handlers for the same event', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.on('test', handler1);
      bus.on('test', handler2);
      await bus.emit('test', 'data');
      expect(handler1).toHaveBeenCalledWith('data');
      expect(handler2).toHaveBeenCalledWith('data');
    });

    it('should not call handlers for different events', async () => {
      const handler = vi.fn();
      bus.on('event-a', handler);
      await bus.emit('event-b', 'data');
      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle emit with no data', async () => {
      const handler = vi.fn();
      bus.on('test', handler);
      await bus.emit('test');
      expect(handler).toHaveBeenCalledWith(undefined);
    });

    it('should handle emit for non-existent event', async () => {
      // Should not throw
      await expect(bus.emit('non-existent')).resolves.toBeUndefined();
    });
  });

  describe('priority', () => {
    it('should call handlers in priority order (high priority first)', async () => {
      const order: number[] = [];
      bus.on('test', () => { order.push(1); }, 1);
      bus.on('test', () => { order.push(3); }, 3);
      bus.on('test', () => { order.push(2); }, 2);
      await bus.emit('test');
      expect(order).toEqual([3, 2, 1]);
    });

    it('should use default priority 0', async () => {
      const order: number[] = [];
      bus.on('test', () => { order.push(0); }); // default priority 0
      bus.on('test', () => { order.push(1); }, 1);
      await bus.emit('test');
      expect(order).toEqual([1, 0]);
    });
  });

  describe('once', () => {
    it('should only trigger once', async () => {
      const handler = vi.fn();
      bus.once('test', handler);

      await bus.emit('test', 'first');
      await bus.emit('test', 'second');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith('first');
    });

    it('should respect priority for once handlers', async () => {
      const order: number[] = [];
      bus.once('test', () => { order.push(1); }, 1);
      bus.on('test', () => { order.push(0); }, 0);
      await bus.emit('test');
      expect(order).toEqual([1, 0]);
    });
  });

  describe('off', () => {
    it('should unsubscribe a handler', async () => {
      const handler = vi.fn();
      bus.on('test', handler);
      bus.off('test', handler);
      await bus.emit('test', 'data');
      expect(handler).not.toHaveBeenCalled();
    });

    it('should only remove the specific handler', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.on('test', handler1);
      bus.on('test', handler2);
      bus.off('test', handler1);
      await bus.emit('test', 'data');
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledWith('data');
    });

    it('should handle removing from non-existent event', () => {
      const handler = vi.fn();
      // Should not throw
      bus.off('non-existent', handler);
    });

    it('should handle removing non-existent handler', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.on('test', handler1);
      // Should not throw
      bus.off('test', handler2);
    });
  });

  describe('error isolation', () => {
    it('should isolate handler errors and continue executing other handlers', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const handler1 = vi.fn(() => { throw new Error('handler error'); });
      const handler2 = vi.fn();

      bus.on('test', handler1);
      bus.on('test', handler2);

      await bus.emit('test', 'data');

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled(); // handler2 should still be called
      expect(errorSpy).toHaveBeenCalled();
    });

    it('should handle async handler errors', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const handler1 = vi.fn(async () => { throw new Error('async error'); });
      const handler2 = vi.fn();

      bus.on('test', handler1);
      bus.on('test', handler2);

      await bus.emit('test');

      expect(handler2).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('listenerCount', () => {
    it('should return the number of listeners for an event', () => {
      bus.on('test', () => {});
      bus.on('test', () => {});
      expect(bus.listenerCount('test')).toBe(2);
    });

    it('should return 0 for non-existent event', () => {
      expect(bus.listenerCount('unknown')).toBe(0);
    });
  });

  describe('eventNames', () => {
    it('should return all registered event names', () => {
      bus.on('a', () => {});
      bus.on('b', () => {});
      bus.on('c', () => {});
      expect(bus.eventNames()).toEqual(['a', 'b', 'c']);
    });
  });

  describe('clear', () => {
    it('should remove all listeners', async () => {
      const handler = vi.fn();
      bus.on('a', handler);
      bus.on('b', handler);
      bus.clear();

      await bus.emit('a');
      await bus.emit('b');

      expect(handler).not.toHaveBeenCalled();
      expect(bus.eventNames()).toEqual([]);
    });
  });
});
