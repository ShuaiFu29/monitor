import type { Plugin, MonitorInterface } from '@monitor/types';
import { logger } from '@monitor/utils';

/**
 * 插件管理器
 *
 * 职责：
 * - 管理插件的安装与卸载生命周期
 * - 防止重复安装
 * - 异常插件隔离（单个插件失败不影响其他插件）
 * - 统一销毁
 */
export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private monitor: MonitorInterface;

  constructor(monitor: MonitorInterface) {
    this.monitor = monitor;
  }

  /**
   * 安装插件
   * - 若插件已安装则忽略
   * - 插件 install 过程中的异常会被捕获，不影响 SDK 稳定性
   */
  install(plugin: Plugin): void {
    if (this.plugins.has(plugin.name)) {
      logger.warn(`Plugin "${plugin.name}" is already installed, skipping.`);
      return;
    }

    try {
      plugin.install(this.monitor);
      this.plugins.set(plugin.name, plugin);
      logger.info(`Plugin "${plugin.name}@${plugin.version}" installed.`);
    } catch (error) {
      logger.error(`Failed to install plugin "${plugin.name}":`, error);
    }
  }

  /**
   * 批量安装插件
   */
  installAll(plugins: Plugin[]): void {
    for (const plugin of plugins) {
      this.install(plugin);
    }
  }

  /**
   * 卸载指定插件
   */
  uninstall(pluginName: string): void {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      logger.warn(`Plugin "${pluginName}" is not installed.`);
      return;
    }

    try {
      if (plugin.uninstall) {
        plugin.uninstall(this.monitor);
      }
      this.plugins.delete(pluginName);
      logger.info(`Plugin "${pluginName}" uninstalled.`);
    } catch (error) {
      logger.error(`Failed to uninstall plugin "${pluginName}":`, error);
      // 即使卸载失败也从列表中移除
      this.plugins.delete(pluginName);
    }
  }

  /**
   * 获取已安装的插件
   */
  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * 获取所有已安装插件
   */
  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 获取已安装插件名称列表
   */
  getPluginNames(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * 检查插件是否已安装
   */
  hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * 销毁所有插件
   * 逆序卸载，确保后安装的先卸载（避免依赖问题）
   */
  destroy(): void {
    const pluginNames = Array.from(this.plugins.keys()).reverse();
    for (const name of pluginNames) {
      this.uninstall(name);
    }
  }
}
