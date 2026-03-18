import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ErrorHandler } from '../src/error-handler';
import type { RawSourceMap } from '../src/source-map';
import type { MonitorInterface } from '@monitor/types';

const TEST_SOURCEMAP: RawSourceMap = {
  version: 3,
  file: 'app.js',
  sourceRoot: '',
  sources: ['src/app.ts'],
  sourcesContent: [
    'import { foo } from \'./foo\';\n\nfunction main() {\n  const result = foo(42);\n}\n',
  ],
  names: ['main', 'result', 'foo'],
  mappings: ';AAAA;AAEA,SAAgBA,IAAI,KAAGC,MAAM,GAAGC,GAAG',
};

function createMockMonitor(): MonitorInterface & { captured: unknown[] } {
  const captured: unknown[] = [];
  return {
    captured,
    eventBus: {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      once: vi.fn(),
      clear: vi.fn(),
    },
    captureEvent: vi.fn((event) => {
      captured.push(event);
    }),
    setUser: vi.fn(),
    addBreadcrumb: vi.fn(),
    getSessionId: vi.fn(() => 'test-session'),
    getConfig: vi.fn(() => ({ sampleRate: 1.0 })),
    destroy: vi.fn(),
  };
}

describe('ErrorHandler + SourceMap Integration', () => {
  let handler: ErrorHandler;
  let monitor: ReturnType<typeof createMockMonitor>;

  beforeEach(() => {
    monitor = createMockMonitor();
  });

  afterEach(() => {
    handler.uninstall();
    vi.restoreAllMocks();
  });

  it('should create SourceMapResolver when sourceMap config is provided', () => {
    handler = new ErrorHandler({
      sourceMap: {
        fetcher: async () => JSON.stringify(TEST_SOURCEMAP),
      },
    });
    handler.install(monitor);

    expect(handler.getSourceMapResolver()).not.toBeNull();
  });

  it('should not create SourceMapResolver when sourceMap config is missing', () => {
    handler = new ErrorHandler({});
    handler.install(monitor);

    expect(handler.getSourceMapResolver()).toBeNull();
  });

  it('should resolve frames with sourcemap before reporting', async () => {
    handler = new ErrorHandler({
      sourceMap: {
        fetcher: async () => JSON.stringify(TEST_SOURCEMAP),
      },
    });
    handler.install(monitor);

    // Inject sourcemap for the test URL
    const resolver = handler.getSourceMapResolver()!;
    resolver.injectSourceMap('http://example.com/app.js', TEST_SOURCEMAP);

    // Create an error with a stack that maps to our sourcemap
    const error = new Error('test error');
    error.stack = 'Error: test error\n    at main (http://example.com/app.js:3:1)';

    handler.captureError(error);

    // Wait for async SourceMap resolution
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify event was captured with resolved frames
    expect(monitor.captureEvent).toHaveBeenCalled();
    const capturedEvent = (monitor.captureEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(capturedEvent.type).toBe('error');

    // Frames should be resolved (if sourcemap matched)
    const frames = capturedEvent.frames;
    if (frames.length > 0 && frames[0].resolved) {
      expect(frames[0].originalSource).toContain('src/app.ts');
    }
  });

  it('should still report error if sourcemap fetch fails', async () => {
    handler = new ErrorHandler({
      sourceMap: {
        fetcher: async () => { throw new Error('Network error'); },
      },
    });
    handler.install(monitor);

    const error = new Error('test error');
    error.stack = 'Error: test error\n    at main (http://example.com/app.js:3:1)';

    handler.captureError(error);

    // Wait for async resolution attempt
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should still report error with original frames
    expect(monitor.captureEvent).toHaveBeenCalled();
  });

  it('should report directly without sourcemap when not configured', () => {
    handler = new ErrorHandler({});
    handler.install(monitor);

    const error = new Error('test error');
    error.stack = 'Error: test error\n    at main (http://example.com/app.js:3:1)';

    handler.captureError(error);

    // Should report synchronously
    expect(monitor.captureEvent).toHaveBeenCalled();
    const capturedEvent = (monitor.captureEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(capturedEvent.frames[0].resolved).toBeUndefined();
  });
});
