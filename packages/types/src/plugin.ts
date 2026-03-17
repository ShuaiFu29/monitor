import type { MonitorInterface } from './monitor';

/**
 * 插件接口
 */
export interface Plugin {
  /** 插件名称（唯一标识） */
  name: string;
  /** 插件版本号 */
  version: string;
  /** 安装插件 */
  install(monitor: MonitorInterface): void;
  /** 卸载插件 */
  uninstall?(monitor: MonitorInterface): void;
}
