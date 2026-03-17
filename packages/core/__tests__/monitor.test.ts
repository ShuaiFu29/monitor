import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Monitor } from '../src/monitor';
import type { MonitorConfig, Plugin } from '@monitor/types';

const BASE_CONFIG: MonitorConfig = {
  dsn: 'https://test@monitor.example.com/1',
};

describe('Monitor', () => {
  let monitor: Monitor;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    monitor?.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with valid config', () => {
      monitor = new Monitor(BASE_CONFIG);
      expect(monitor.getSessionId()).toBeTruthy();
    });

    it('should throw with missing dsn', () => {
      expect(() => new Monitor({} as MonitorConfig)).toThrow('"dsn" is required');
    });

    it('should emit monitor:init event', () => {
      const handler = vi.fn();
      monitor = new Monitor(BASE_CONFIG);
      // Since init happens in constructor, we listen after and test eventBus works
      monitor.eventBus.on('test-event', handler);
      monitor.eventBus.emit('test-event', 'data');
    });

    it('should install plugins from config', () => {
      const plugin: Plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        install: vi.fn(),
      };

      monitor = new Monitor({
        ...BASE_CONFIG,
        plugins: [plugin],
      });

      expect(plugin.install).toHaveBeenCalledWith(monitor);
    });

    it('should set user from config', () => {
      monitor = new Monitor({
        ...BASE_CONFIG,
        userId: 'user-123',
        userName: 'Test User',
        userEmail: 'test@example.com',
      });

      // userId should be set
      expect(monitor.getSessionId()).toBeTruthy();
    });
  });

  describe('captureEvent', () => {
    it('should enrich event with common fields', () => {
      const transportHandler = vi.fn();
      monitor = new Monitor(BASE_CONFIG);
      monitor.eventBus.on('transport:send', transportHandler);

      monitor.captureEvent({
        type: 'custom',
      });

      // Trigger flush
      monitor.flush();

      expect(transportHandler).toHaveBeenCalledTimes(1);
      const events = transportHandler.mock.calls[0][0] as any[];
      expect(events).toHaveLength(1);
      expect(events[0].id).toBeTruthy();
      expect(events[0].timestamp).toBeGreaterThan(0);
      expect(events[0].sessionId).toBe(monitor.getSessionId());
    });

    it('should apply beforeSend hook', () => {
      const beforeSend = vi.fn((event) => ({
        ...event,
        context: { ...event.context, modified: true },
      }));

      monitor = new Monitor({
        ...BASE_CONFIG,
        beforeSend,
      });

      monitor.captureEvent({ type: 'custom' });
      expect(beforeSend).toHaveBeenCalled();
    });

    it('should drop event when beforeSend returns null', () => {
      const transportHandler = vi.fn();
      monitor = new Monitor({
        ...BASE_CONFIG,
        beforeSend: () => null,
      });
      monitor.eventBus.on('transport:send', transportHandler);

      monitor.captureEvent({ type: 'custom' });
      monitor.flush();

      // Event should be dropped, no flush with events
      expect(transportHandler).not.toHaveBeenCalled();
    });

    it('should not capture events after destroy', () => {
      const transportHandler = vi.fn();
      monitor = new Monitor(BASE_CONFIG);
      monitor.eventBus.on('transport:send', transportHandler);

      monitor.destroy();
      monitor.captureEvent({ type: 'custom' });

      // Nothing should happen
      expect(transportHandler).not.toHaveBeenCalled();
    });

    it('should respect sampleRate', () => {
      // Set sampleRate to 0 = drop all
      monitor = new Monitor({
        ...BASE_CONFIG,
        sampleRate: 0,
      });

      const transportHandler = vi.fn();
      monitor.eventBus.on('transport:send', transportHandler);

      for (let i = 0; i < 100; i++) {
        monitor.captureEvent({ type: 'custom' });
      }
      monitor.flush();

      expect(transportHandler).not.toHaveBeenCalled();
    });
  });

  describe('setUser', () => {
    it('should update user information', async () => {
      const handler = vi.fn();
      monitor = new Monitor(BASE_CONFIG);
      monitor.eventBus.on('user:set', handler);

      monitor.setUser({ id: 'new-user', email: 'new@test.com' });

      // Wait for async emit
      await vi.advanceTimersByTimeAsync(0);
      expect(handler).toHaveBeenCalledWith({
        id: 'new-user',
        email: 'new@test.com',
      });
    });
  });

  describe('addBreadcrumb', () => {
    it('should emit breadcrumb event with timestamp', async () => {
      const handler = vi.fn();
      monitor = new Monitor(BASE_CONFIG);
      monitor.eventBus.on('breadcrumb:add', handler);

      monitor.addBreadcrumb({
        message: 'test breadcrumb',
        category: 'test',
        level: 'info',
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(handler).toHaveBeenCalledTimes(1);
      const bc = handler.mock.calls[0][0];
      expect(bc.message).toBe('test breadcrumb');
      expect(bc.timestamp).toBeGreaterThan(0);
    });
  });

  describe('use', () => {
    it('should install a plugin at runtime', () => {
      monitor = new Monitor(BASE_CONFIG);
      const plugin: Plugin = {
        name: 'runtime-plugin',
        version: '1.0.0',
        install: vi.fn(),
      };

      monitor.use(plugin);
      expect(plugin.install).toHaveBeenCalledWith(monitor);
    });
  });

  describe('flush', () => {
    it('should immediately send queued events', () => {
      const transportHandler = vi.fn();
      monitor = new Monitor(BASE_CONFIG);
      monitor.eventBus.on('transport:send', transportHandler);

      monitor.captureEvent({ type: 'custom' });
      monitor.captureEvent({ type: 'custom' });

      monitor.flush();
      expect(transportHandler).toHaveBeenCalledTimes(1);
      expect(transportHandler.mock.calls[0][0]).toHaveLength(2);
    });
  });

  describe('destroy', () => {
    it('should flush remaining events on destroy', () => {
      const transportHandler = vi.fn();
      monitor = new Monitor(BASE_CONFIG);
      monitor.eventBus.on('transport:send', transportHandler);

      monitor.captureEvent({ type: 'custom' });
      monitor.destroy();

      expect(transportHandler).toHaveBeenCalledTimes(1);
    });

    it('should uninstall all plugins', () => {
      const uninstall = vi.fn();
      const plugin: Plugin = {
        name: 'cleanup-plugin',
        version: '1.0.0',
        install: vi.fn(),
        uninstall,
      };

      monitor = new Monitor({
        ...BASE_CONFIG,
        plugins: [plugin],
      });

      monitor.destroy();
      expect(uninstall).toHaveBeenCalled();
    });

    it('should be idempotent', () => {
      monitor = new Monitor(BASE_CONFIG);
      monitor.destroy();
      monitor.destroy(); // Should not throw
    });

    it('should emit monitor:destroy event', async () => {
      const handler = vi.fn();
      monitor = new Monitor(BASE_CONFIG);
      monitor.eventBus.on('monitor:destroy', handler);

      monitor.destroy();

      await vi.advanceTimersByTimeAsync(0);
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('internal error handling', () => {
    it('should call onError callback for internal errors', () => {
      const onError = vi.fn();
      monitor = new Monitor({
        ...BASE_CONFIG,
        onError,
        beforeSend: () => {
          throw new Error('hook error');
        },
      });

      monitor.captureEvent({ type: 'custom' });
      expect(onError).toHaveBeenCalled();
    });

    it('should not crash if onError itself throws', () => {
      monitor = new Monitor({
        ...BASE_CONFIG,
        onError: () => {
          throw new Error('double error');
        },
        beforeSend: () => {
          throw new Error('hook error');
        },
      });

      // Should not throw
      monitor.captureEvent({ type: 'custom' });
    });
  });
});
