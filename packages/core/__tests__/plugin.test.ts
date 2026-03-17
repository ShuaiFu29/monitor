import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginManager } from '../src/plugin';
import type { Plugin, MonitorInterface } from '@monitor/types';

// 创建 Mock Monitor
function createMockMonitor(): MonitorInterface {
  return {
    eventBus: {
      on: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      emit: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn(),
    },
    captureEvent: vi.fn(),
    setUser: vi.fn(),
    addBreadcrumb: vi.fn(),
    getSessionId: vi.fn().mockReturnValue('test-session'),
    getConfig: vi.fn().mockReturnValue({}),
    destroy: vi.fn(),
  };
}

// 创建 Mock Plugin
function createMockPlugin(name: string, overrides?: Partial<Plugin>): Plugin {
  return {
    name,
    version: '1.0.0',
    install: vi.fn(),
    uninstall: vi.fn(),
    ...overrides,
  };
}

describe('PluginManager', () => {
  let monitor: MonitorInterface;
  let manager: PluginManager;

  beforeEach(() => {
    monitor = createMockMonitor();
    manager = new PluginManager(monitor);
    vi.restoreAllMocks();
  });

  describe('install', () => {
    it('should install a plugin and call its install method', () => {
      const plugin = createMockPlugin('test-plugin');
      manager.install(plugin);
      expect(plugin.install).toHaveBeenCalledWith(monitor);
      expect(manager.hasPlugin('test-plugin')).toBe(true);
    });

    it('should prevent duplicate installation', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const plugin = createMockPlugin('test-plugin');
      manager.install(plugin);
      manager.install(plugin);
      expect(plugin.install).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('should catch and log errors during installation', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const plugin = createMockPlugin('bad-plugin', {
        install: vi.fn(() => { throw new Error('install failed'); }),
      });
      manager.install(plugin);
      expect(manager.hasPlugin('bad-plugin')).toBe(false);
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('installAll', () => {
    it('should install multiple plugins', () => {
      const plugins = [
        createMockPlugin('plugin-a'),
        createMockPlugin('plugin-b'),
        createMockPlugin('plugin-c'),
      ];
      manager.installAll(plugins);
      expect(manager.getPluginNames()).toEqual(['plugin-a', 'plugin-b', 'plugin-c']);
    });
  });

  describe('uninstall', () => {
    it('should uninstall a plugin and call its uninstall method', () => {
      const plugin = createMockPlugin('test-plugin');
      manager.install(plugin);
      manager.uninstall('test-plugin');
      expect(plugin.uninstall).toHaveBeenCalledWith(monitor);
      expect(manager.hasPlugin('test-plugin')).toBe(false);
    });

    it('should handle uninstalling non-existent plugin', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      manager.uninstall('non-existent');
      expect(warnSpy).toHaveBeenCalled();
    });

    it('should handle plugin without uninstall method', () => {
      const plugin: Plugin = {
        name: 'simple-plugin',
        version: '1.0.0',
        install: vi.fn(),
        // no uninstall method
      };
      manager.install(plugin);
      // Should not throw
      manager.uninstall('simple-plugin');
      expect(manager.hasPlugin('simple-plugin')).toBe(false);
    });

    it('should still remove plugin even if uninstall throws', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const plugin = createMockPlugin('bad-plugin', {
        uninstall: vi.fn(() => { throw new Error('uninstall failed'); }),
      });
      manager.install(plugin);
      manager.uninstall('bad-plugin');
      expect(manager.hasPlugin('bad-plugin')).toBe(false);
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('getPlugin / getPlugins', () => {
    it('should return the plugin by name', () => {
      const plugin = createMockPlugin('test');
      manager.install(plugin);
      expect(manager.getPlugin('test')).toBe(plugin);
    });

    it('should return undefined for non-existent plugin', () => {
      expect(manager.getPlugin('none')).toBeUndefined();
    });

    it('should return all installed plugins', () => {
      manager.install(createMockPlugin('a'));
      manager.install(createMockPlugin('b'));
      expect(manager.getPlugins()).toHaveLength(2);
    });
  });

  describe('destroy', () => {
    it('should uninstall all plugins in reverse order', () => {
      const uninstallOrder: string[] = [];
      const pluginA = createMockPlugin('a', {
        uninstall: vi.fn(() => { uninstallOrder.push('a'); }),
      });
      const pluginB = createMockPlugin('b', {
        uninstall: vi.fn(() => { uninstallOrder.push('b'); }),
      });
      const pluginC = createMockPlugin('c', {
        uninstall: vi.fn(() => { uninstallOrder.push('c'); }),
      });

      manager.install(pluginA);
      manager.install(pluginB);
      manager.install(pluginC);
      manager.destroy();

      // Should uninstall in reverse order
      expect(uninstallOrder).toEqual(['c', 'b', 'a']);
      expect(manager.getPlugins()).toHaveLength(0);
    });
  });
});
