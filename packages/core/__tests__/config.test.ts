import { describe, it, expect, vi } from 'vitest';
import { ConfigManager } from '../src/config';
import type { MonitorConfig } from '@monitor/types';

const BASE_CONFIG: MonitorConfig = {
  dsn: 'https://test@monitor.example.com/1',
};

describe('ConfigManager', () => {
  describe('constructor / validation', () => {
    it('should accept valid config with dsn', () => {
      const manager = new ConfigManager(BASE_CONFIG);
      const config = manager.getConfig();
      expect(config.dsn).toBe('https://test@monitor.example.com/1');
    });

    it('should throw if dsn is missing', () => {
      expect(() => new ConfigManager({} as MonitorConfig)).toThrow('"dsn" is required');
    });

    it('should throw if sampleRate is out of range', () => {
      expect(
        () => new ConfigManager({ ...BASE_CONFIG, sampleRate: 1.5 }),
      ).toThrow('"sampleRate" must be between 0 and 1');

      expect(
        () => new ConfigManager({ ...BASE_CONFIG, sampleRate: -0.1 }),
      ).toThrow('"sampleRate" must be between 0 and 1');
    });

    it('should throw if errorSampleRate is out of range', () => {
      expect(
        () => new ConfigManager({ ...BASE_CONFIG, errorSampleRate: 2 }),
      ).toThrow('"errorSampleRate" must be between 0 and 1');
    });

    it('should throw if performanceSampleRate is out of range', () => {
      expect(
        () => new ConfigManager({ ...BASE_CONFIG, performanceSampleRate: -1 }),
      ).toThrow('"performanceSampleRate" must be between 0 and 1');
    });
  });

  describe('default values', () => {
    it('should apply default values for missing fields', () => {
      const manager = new ConfigManager(BASE_CONFIG);
      const config = manager.getConfig();

      expect(config.release).toBe('0.0.0');
      expect(config.environment).toBe('production');
      expect(config.sampleRate).toBe(1.0);
      expect(config.errorSampleRate).toBe(1.0);
      expect(config.performanceSampleRate).toBe(0.1);
      expect(config.batchSize).toBe(10);
      expect(config.flushInterval).toBe(5000);
      expect(config.maxRetries).toBe(3);
      expect(config.plugins).toEqual([]);
      expect(config.context).toEqual({});
    });

    it('should merge user config with defaults', () => {
      const manager = new ConfigManager({
        ...BASE_CONFIG,
        release: '1.0.0',
        environment: 'staging',
        sampleRate: 0.5,
      });
      const config = manager.getConfig();
      expect(config.release).toBe('1.0.0');
      expect(config.environment).toBe('staging');
      expect(config.sampleRate).toBe(0.5);
      // Other defaults should still apply
      expect(config.batchSize).toBe(10);
    });

    it('should merge context objects', () => {
      const manager = new ConfigManager({
        ...BASE_CONFIG,
        context: { app: 'test', version: '1.0' },
      });
      expect(manager.getConfig().context).toEqual({ app: 'test', version: '1.0' });
    });
  });

  describe('get', () => {
    it('should return specific config values', () => {
      const manager = new ConfigManager({ ...BASE_CONFIG, release: '2.0.0' });
      expect(manager.get('release')).toBe('2.0.0');
      expect(manager.get('dsn')).toBe(BASE_CONFIG.dsn);
    });
  });

  describe('update', () => {
    it('should update sample rate', () => {
      const manager = new ConfigManager(BASE_CONFIG);
      manager.update({ sampleRate: 0.5 });
      expect(manager.get('sampleRate')).toBe(0.5);
    });

    it('should not allow dsn change', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new ConfigManager(BASE_CONFIG);
      manager.update({ dsn: 'https://new@monitor.example.com/2' });
      expect(manager.get('dsn')).toBe(BASE_CONFIG.dsn);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('should reject invalid sampleRate update', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new ConfigManager(BASE_CONFIG);
      manager.update({ sampleRate: 5 });
      expect(manager.get('sampleRate')).toBe(1.0); // unchanged
      expect(warnSpy).toHaveBeenCalled();
    });

    it('should merge context on update', () => {
      const manager = new ConfigManager({
        ...BASE_CONFIG,
        context: { existing: 'value' },
      });
      manager.update({ context: { newKey: 'newValue' } });
      expect(manager.getConfig().context).toEqual({
        existing: 'value',
        newKey: 'newValue',
      });
    });

    it('should update release and environment', () => {
      const manager = new ConfigManager(BASE_CONFIG);
      manager.update({ release: '3.0.0', environment: 'staging' });
      expect(manager.get('release')).toBe('3.0.0');
      expect(manager.get('environment')).toBe('staging');
    });

    it('should update beforeSend hook', () => {
      const manager = new ConfigManager(BASE_CONFIG);
      const hook = (event: any) => event;
      manager.update({ beforeSend: hook });
      expect(manager.get('beforeSend')).toBe(hook);
    });
  });

  describe('getConfig returns copy', () => {
    it('should return a new object each time', () => {
      const manager = new ConfigManager(BASE_CONFIG);
      const config1 = manager.getConfig();
      const config2 = manager.getConfig();
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
    });
  });
});
