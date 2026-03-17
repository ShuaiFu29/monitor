import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMonitor } from '../src/create-monitor';
import type { MonitorConfig, Plugin } from '@monitor/types';

const BASE_CONFIG: MonitorConfig = {
  dsn: 'https://test@monitor.example.com/1',
};

describe('createMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should create a Monitor instance', () => {
    const monitor = createMonitor(BASE_CONFIG);
    expect(monitor).toBeDefined();
    expect(monitor.getSessionId()).toBeTruthy();
    monitor.destroy();
  });

  it('should register unload and visibility handlers', () => {
    const addEventSpy = vi.spyOn(window, 'addEventListener');
    const docAddEventSpy = vi.spyOn(document, 'addEventListener');

    const monitor = createMonitor(BASE_CONFIG);

    expect(addEventSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    expect(addEventSpy).toHaveBeenCalledWith('pagehide', expect.any(Function));
    expect(docAddEventSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    monitor.destroy();
  });

  it('should cleanup handlers on destroy', async () => {
    const removeEventSpy = vi.spyOn(window, 'removeEventListener');
    const docRemoveEventSpy = vi.spyOn(document, 'removeEventListener');

    const monitor = createMonitor(BASE_CONFIG);
    monitor.destroy();

    // EventBus.emit is async, wait for it to settle
    await vi.advanceTimersByTimeAsync(0);

    expect(removeEventSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    expect(removeEventSpy).toHaveBeenCalledWith('pagehide', expect.any(Function));
    expect(docRemoveEventSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('should install plugins from config', () => {
    const plugin: Plugin = {
      name: 'test-plugin',
      version: '1.0.0',
      install: vi.fn(),
    };

    const monitor = createMonitor({
      ...BASE_CONFIG,
      plugins: [plugin],
    });

    expect(plugin.install).toHaveBeenCalledWith(monitor);
    monitor.destroy();
  });

  it('should support full lifecycle: init → captureEvent → flush → destroy', () => {
    const transportHandler = vi.fn();
    const monitor = createMonitor(BASE_CONFIG);
    monitor.eventBus.on('transport:send', transportHandler);

    // Capture events
    monitor.captureEvent({ type: 'custom' });
    monitor.captureEvent({ type: 'custom' });

    // Flush
    monitor.flush();
    expect(transportHandler).toHaveBeenCalledTimes(1);
    expect(transportHandler.mock.calls[0][0]).toHaveLength(2);

    // Destroy
    monitor.destroy();
  });

  it('should support runtime plugin installation', () => {
    const monitor = createMonitor(BASE_CONFIG);
    const plugin: Plugin = {
      name: 'late-plugin',
      version: '1.0.0',
      install: vi.fn(),
    };

    monitor.use(plugin);
    expect(plugin.install).toHaveBeenCalledWith(monitor);

    monitor.destroy();
  });
});
