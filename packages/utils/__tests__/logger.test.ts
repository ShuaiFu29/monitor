import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '../src/logger';

describe('Logger', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('debug');
    vi.restoreAllMocks();
  });

  it('should default to "warn" level', () => {
    const defaultLogger = new Logger();
    expect(defaultLogger.getLevel()).toBe('warn');
  });

  it('should log debug messages when level is "debug"', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logger.debug('test message');
    expect(spy).toHaveBeenCalledWith('[Monitor] test message');
  });

  it('should log info messages', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger.info('info message');
    expect(spy).toHaveBeenCalledWith('[Monitor] info message');
  });

  it('should log warn messages', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('warn message');
    expect(spy).toHaveBeenCalledWith('[Monitor] warn message');
  });

  it('should log error messages', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('error message');
    expect(spy).toHaveBeenCalledWith('[Monitor] error message');
  });

  it('should suppress messages below current level', () => {
    logger.setLevel('error');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logger.debug('test');
    logger.info('test');
    logger.warn('test');
    logger.error('test');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('should suppress all messages when level is "silent"', () => {
    logger.setLevel('silent');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logger.debug('test');
    logger.info('test');
    logger.warn('test');
    logger.error('test');

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('should allow changing level at runtime', () => {
    logger.setLevel('warn');
    expect(logger.getLevel()).toBe('warn');

    logger.setLevel('debug');
    expect(logger.getLevel()).toBe('debug');
  });

  it('should pass extra arguments to console', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const extraData = { key: 'value' };
    logger.error('test', extraData);
    expect(spy).toHaveBeenCalledWith('[Monitor] test', extraData);
  });
});
