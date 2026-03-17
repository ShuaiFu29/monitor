import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UnloadHandler } from '../src/unload-handler';
import type { TransportEngine } from '../src/transport';
import type { BaseEvent } from '@monitor/types';

describe('UnloadHandler', () => {
  let mockEngine: TransportEngine;
  let handler: UnloadHandler;
  let bufferedEvents: BaseEvent[];

  beforeEach(() => {
    bufferedEvents = [
      { id: 'e1', type: 'error', timestamp: 1000, sessionId: 's1' } as BaseEvent,
    ];

    mockEngine = {
      sendUrgent: vi.fn().mockReturnValue(true),
    } as unknown as TransportEngine;

    handler = new UnloadHandler(mockEngine, () => bufferedEvents);
  });

  afterEach(() => {
    handler.uninstall();
  });

  it('install 应注册事件监听器', () => {
    const addDocSpy = vi.spyOn(document, 'addEventListener');
    const addWinSpy = vi.spyOn(window, 'addEventListener');

    handler.install();

    expect(addDocSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(addWinSpy).toHaveBeenCalledWith('pagehide', expect.any(Function));
    expect(addWinSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    addDocSpy.mockRestore();
    addWinSpy.mockRestore();
  });

  it('visibilitychange hidden 应触发 flush', () => {
    handler.install();

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });

    document.dispatchEvent(new Event('visibilitychange'));

    expect(mockEngine.sendUrgent).toHaveBeenCalledWith(bufferedEvents);

    // 恢复
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
  });

  it('visibilitychange visible 不应触发 flush', () => {
    handler.install();

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });

    document.dispatchEvent(new Event('visibilitychange'));

    expect(mockEngine.sendUrgent).not.toHaveBeenCalled();
  });

  it('flush 空缓冲区时不应调用 sendUrgent', () => {
    bufferedEvents = [];
    handler = new UnloadHandler(mockEngine, () => bufferedEvents);
    handler.install();

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(mockEngine.sendUrgent).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
  });

  it('多次触发应只 flush 一次（防重复）', () => {
    handler.install();

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });

    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));

    // flushed 标志阻止重复发送
    expect(mockEngine.sendUrgent).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
  });

  it('pagehide 事件应触发 flush', () => {
    handler.install();
    window.dispatchEvent(new Event('pagehide'));
    expect(mockEngine.sendUrgent).toHaveBeenCalledWith(bufferedEvents);
  });

  it('beforeunload 事件应触发 flush', () => {
    handler.install();
    window.dispatchEvent(new Event('beforeunload'));
    expect(mockEngine.sendUrgent).toHaveBeenCalledWith(bufferedEvents);
  });

  it('uninstall 应移除所有监听器', () => {
    const removeDocSpy = vi.spyOn(document, 'removeEventListener');
    const removeWinSpy = vi.spyOn(window, 'removeEventListener');

    handler.install();
    handler.uninstall();

    expect(removeDocSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(removeWinSpy).toHaveBeenCalledWith('pagehide', expect.any(Function));
    expect(removeWinSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    removeDocSpy.mockRestore();
    removeWinSpy.mockRestore();
  });
});
