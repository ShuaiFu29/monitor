import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BehaviorPlugin } from '../src/index';
import type { MonitorInterface, EventBusInterface } from '@monitor/types';

function createMockMonitor(): MonitorInterface {
  const capturedEvents: Array<Record<string, unknown>> = [];
  const breadcrumbs: Array<Record<string, unknown>> = [];

  const eventBus: EventBusInterface = {
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(async () => {}),
    clear: vi.fn(),
  };

  return {
    eventBus,
    captureEvent: vi.fn((event: Record<string, unknown>) => {
      capturedEvents.push(event);
    }) as unknown as MonitorInterface['captureEvent'],
    setUser: vi.fn() as unknown as MonitorInterface['setUser'],
    addBreadcrumb: vi.fn((breadcrumb: Record<string, unknown>) => {
      breadcrumbs.push(breadcrumb);
    }) as unknown as MonitorInterface['addBreadcrumb'],
    getSessionId: vi.fn(() => 'test-session'),
    getConfig: vi.fn(() => ({})),
    destroy: vi.fn(),
  };
}

describe('BehaviorPlugin Integration', () => {
  let plugin: BehaviorPlugin;
  let monitor: MonitorInterface;

  beforeEach(() => {
    vi.useFakeTimers();
    monitor = createMockMonitor();
  });

  afterEach(() => {
    if (plugin) plugin.uninstall();
    vi.useRealTimers();
  });

  it('should install and start all sub-trackers', () => {
    plugin = new BehaviorPlugin();
    plugin.install(monitor);

    // Verify click tracking works by simulating click
    const div = document.createElement('div');
    div.textContent = 'test';
    document.body.appendChild(div);
    div.click();
    document.body.removeChild(div);

    expect(monitor.captureEvent).toHaveBeenCalled();
  });

  it('should disable specific trackers via config', () => {
    plugin = new BehaviorPlugin({
      click: false,
      heatmap: false,
      journey: false,
    });
    plugin.install(monitor);

    // Only custom events should be active
    const div = document.createElement('div');
    document.body.appendChild(div);
    div.click();
    document.body.removeChild(div);

    // Click tracker is disabled, so captureEvent should not be called from clicks
    // (heatmap and journey also disabled)
    expect(monitor.captureEvent).not.toHaveBeenCalled();
  });

  it('should track custom events via trackEvent', () => {
    plugin = new BehaviorPlugin({ click: false, heatmap: false, journey: false });
    plugin.install(monitor);

    plugin.trackEvent('purchase', 'ecommerce', { amount: 49.99 });

    // Custom events use a buffer, so flush
    vi.advanceTimersByTime(6000); // Default flushInterval = 5000

    expect(monitor.captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'behavior',
        action: 'custom',
      }),
    );
  });

  it('should add breadcrumbs on click', () => {
    plugin = new BehaviorPlugin({
      heatmap: false,
      journey: false,
      customEvents: false,
    });
    plugin.install(monitor);

    const button = document.createElement('button');
    button.textContent = 'Submit';
    document.body.appendChild(button);
    button.click();
    document.body.removeChild(button);

    expect(monitor.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'click',
        data: expect.objectContaining({ type: 'user' }),
      }),
    );
  });

  it('should add breadcrumbs on navigation', () => {
    plugin = new BehaviorPlugin({
      click: false,
      heatmap: false,
      customEvents: false,
    });
    plugin.install(monitor);

    // Trigger navigation
    history.pushState(null, '', '/test-nav-breadcrumb');

    expect(monitor.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'navigation',
        data: expect.objectContaining({ type: 'navigation' }),
      }),
    );
  });

  it('should return journey via getJourney()', () => {
    plugin = new BehaviorPlugin({
      click: false,
      heatmap: false,
      customEvents: false,
    });
    plugin.install(monitor);

    history.pushState(null, '', '/journey-1');
    history.pushState(null, '', '/journey-2');

    const journey = plugin.getJourney();
    expect(journey.length).toBeGreaterThanOrEqual(2);
  });

  it('should clean up on uninstall', () => {
    plugin = new BehaviorPlugin();
    plugin.install(monitor);
    plugin.uninstall();

    // After uninstall, events should not be captured
    (monitor.captureEvent as ReturnType<typeof vi.fn>).mockClear();

    const div = document.createElement('div');
    document.body.appendChild(div);
    div.click();
    document.body.removeChild(div);

    expect(monitor.captureEvent).not.toHaveBeenCalled();
  });
});
