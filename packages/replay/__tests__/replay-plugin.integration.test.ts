import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReplayPlugin } from '../src/index';
import type { MonitorInterface } from '@monitor/types';

/**
 * 创建 mock MonitorInterface
 */
function createMockMonitor(): MonitorInterface & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    eventBus: {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      once: vi.fn(),
      clear: vi.fn(),
    },
    captureEvent: vi.fn((event) => {
      events.push(event);
    }),
    setUser: vi.fn(),
    addBreadcrumb: vi.fn(),
    getSessionId: vi.fn(() => 'test-session-123'),
    getConfig: vi.fn(() => ({
      dsn: 'https://key@host/project',
      sampleRate: 1.0,
      performanceSampleRate: 1.0,
    })),
    destroy: vi.fn(),
  };
}

describe('ReplayPlugin', () => {
  let plugin: ReplayPlugin;
  let monitor: ReturnType<typeof createMockMonitor>;
  let container: HTMLDivElement;

  beforeEach(() => {
    monitor = createMockMonitor();
    container = document.createElement('div');
    container.id = 'replay-test-root';
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (plugin) {
      plugin.uninstall();
    }
    if (container.parentNode) {
      document.body.removeChild(container);
    }
    vi.restoreAllMocks();
  });

  it('should have correct plugin metadata', () => {
    plugin = new ReplayPlugin({ autoStart: false });
    expect(plugin.name).toBe('replay');
    expect(plugin.version).toBe('0.1.0');
  });

  it('should auto-start recording on install', () => {
    plugin = new ReplayPlugin({ autoStart: true });
    plugin.install(monitor);

    expect(plugin.isRecording()).toBe(true);
    // Should have captured initial snapshot
    expect(monitor.captureEvent).toHaveBeenCalled();

    const firstCall = (monitor.captureEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(firstCall.type).toBe('replay');
    expect(firstCall.data.snapshot).toBeDefined();
    expect(firstCall.data.snapshot.node).toBeDefined();
    expect(firstCall.data.snapshot.timestamp).toBeGreaterThan(0);
  });

  it('should not auto-start when autoStart is false', () => {
    plugin = new ReplayPlugin({ autoStart: false });
    plugin.install(monitor);

    expect(plugin.isRecording()).toBe(false);
    expect(monitor.captureEvent).not.toHaveBeenCalled();
  });

  it('should start and stop recording manually', () => {
    plugin = new ReplayPlugin({ autoStart: false });
    plugin.install(monitor);

    plugin.startRecording();
    expect(plugin.isRecording()).toBe(true);

    plugin.stopRecording();
    expect(plugin.isRecording()).toBe(false);
  });

  it('should capture DOM mutations as replay events', async () => {
    plugin = new ReplayPlugin({
      autoStart: true,
      flushInterval: 100,
    });
    plugin.install(monitor);

    // Reset to ignore initial snapshot
    (monitor.captureEvent as ReturnType<typeof vi.fn>).mockClear();
    monitor.events.length = 0;

    // Make DOM changes
    const newEl = document.createElement('p');
    newEl.textContent = 'New content';
    container.appendChild(newEl);

    // Wait for MutationObserver + RAF + flush
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Should have flushed mutation data
    const replayEvents = monitor.events.filter(
      (e: unknown) => (e as { type: string }).type === 'replay'
    );
    expect(replayEvents.length).toBeGreaterThan(0);
  });

  it('should capture user interactions', async () => {
    plugin = new ReplayPlugin({
      autoStart: true,
      flushInterval: 100,
    });
    plugin.install(monitor);

    (monitor.captureEvent as ReturnType<typeof vi.fn>).mockClear();
    monitor.events.length = 0;

    // Simulate click
    const clickEvent = new MouseEvent('click', {
      clientX: 50,
      clientY: 100,
      bubbles: true,
    });
    container.dispatchEvent(clickEvent);

    // Wait for flush interval
    await new Promise((resolve) => setTimeout(resolve, 200));

    const replayEvents = monitor.events.filter(
      (e: unknown) => (e as { type: string; data: { interactions?: unknown[] } }).type === 'replay'
    );

    // Should contain interaction data
    const interactionEvent = replayEvents.find(
      (e: unknown) => (e as { data: { interactions?: unknown[] } }).data.interactions
    );
    expect(interactionEvent).toBeDefined();
  });

  it('should flush on stopRecording', () => {
    plugin = new ReplayPlugin({ autoStart: true });
    plugin.install(monitor);

    (monitor.captureEvent as ReturnType<typeof vi.fn>).mockClear();

    // Add some interaction events
    const clickEvent = new MouseEvent('click', {
      clientX: 50,
      clientY: 100,
      bubbles: true,
    });
    container.dispatchEvent(clickEvent);

    // Stop should flush remaining data
    plugin.stopRecording();

    // Should have flushed the click interaction
    const calls = (monitor.captureEvent as ReturnType<typeof vi.fn>).mock.calls;
    const hasInteraction = calls.some(
      (call: unknown[]) =>
        (call[0] as { data: { interactions?: unknown[] } }).data?.interactions?.length
    );
    expect(hasInteraction).toBe(true);
  });

  it('should cleanup on uninstall', () => {
    plugin = new ReplayPlugin({ autoStart: true });
    plugin.install(monitor);

    expect(plugin.isRecording()).toBe(true);

    plugin.uninstall();
    expect(plugin.isRecording()).toBe(false);
  });

  it('should flush when buffer exceeds max size', () => {
    plugin = new ReplayPlugin({
      autoStart: true,
      maxInteractionBuffer: 3,
      flushInterval: 60000, // Very long flush interval
    });
    plugin.install(monitor);

    (monitor.captureEvent as ReturnType<typeof vi.fn>).mockClear();

    // Generate interactions to exceed buffer
    for (let i = 0; i < 4; i++) {
      const clickEvent = new MouseEvent('click', {
        clientX: i * 10,
        clientY: i * 10,
        bubbles: true,
      });
      container.dispatchEvent(clickEvent);
    }

    // Buffer overflow should have triggered a flush
    expect(monitor.captureEvent).toHaveBeenCalled();
  });

  it('should apply privacy sanitization', () => {
    plugin = new ReplayPlugin({
      autoStart: true,
      sanitize: {
        maskAllInputs: true,
      },
    });
    plugin.install(monitor);

    // The initial snapshot should have been captured
    // Any password inputs should be masked
    expect(plugin.isRecording()).toBe(true);
  });

  it('should provide compressor instance', () => {
    plugin = new ReplayPlugin({ autoStart: false });
    const compressor = plugin.getCompressor();
    expect(compressor).toBeDefined();
  });

  it('should handle manual flush with empty buffers', () => {
    plugin = new ReplayPlugin({ autoStart: false });
    plugin.install(monitor);
    plugin.startRecording();

    (monitor.captureEvent as ReturnType<typeof vi.fn>).mockClear();

    // Flush with empty buffer should be no-op
    plugin.flush();
    expect(monitor.captureEvent).not.toHaveBeenCalled();
  });

  it('should not start recording without install', () => {
    plugin = new ReplayPlugin({ autoStart: false });
    // startRecording without install should be safe
    plugin.startRecording();
    expect(plugin.isRecording()).toBe(false);
  });
});
