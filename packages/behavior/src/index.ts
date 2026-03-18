import type {
  Plugin,
  MonitorInterface,
  BaseEvent,
} from '@monitor/types';
import { logger } from '@monitor/utils';
import { ClickTracker } from './click-tracker';
import type { ClickTrackerConfig, ClickEvent } from './click-tracker';
import { HeatmapCollector } from './heatmap';
import type { HeatmapConfig, HeatmapPoint } from './heatmap';
import { UserJourneyTracker } from './user-journey';
import type { UserJourneyConfig, JourneyStep } from './user-journey';
import { CustomEventsManager } from './custom-events';
import type { CustomEventsConfig, CustomBehaviorEvent } from './custom-events';

/**
 * BehaviorPlugin 配置
 */
export interface BehaviorPluginConfig {
  /** 点击追踪配置 */
  click?: Partial<ClickTrackerConfig> | false;
  /** 热力图配置 */
  heatmap?: Partial<HeatmapConfig> | false;
  /** 用户路径配置 */
  journey?: Partial<UserJourneyConfig> | false;
  /** 自定义事件配置 */
  customEvents?: Partial<CustomEventsConfig> | false;
}

/**
 * BehaviorPlugin — 用户行为追踪插件
 *
 * 功能：
 * 1. 点击行为追踪（目标元素选择器、坐标、文本）
 * 2. 热力图数据采集（页面点击坐标分布）
 * 3. 用户路径追踪（页面导航路径、停留时长）
 * 4. 自定义行为事件（业务代码手动上报）
 *
 * 每个子模块可单独启用/禁用。通过 Monitor.captureEvent 上报数据。
 */
export class BehaviorPlugin implements Plugin {
  readonly name = 'behavior';
  readonly version = '0.1.0';

  private monitor: MonitorInterface | null = null;
  private clickTracker: ClickTracker | null = null;
  private heatmapCollector: HeatmapCollector | null = null;
  private journeyTracker: UserJourneyTracker | null = null;
  private customEventsManager: CustomEventsManager | null = null;
  private config: BehaviorPluginConfig;

  constructor(config: BehaviorPluginConfig = {}) {
    this.config = config;
  }

  /**
   * 安装插件
   */
  install(monitor: MonitorInterface): void {
    this.monitor = monitor;

    // 初始化点击追踪器
    if (this.config.click !== false) {
      this.clickTracker = new ClickTracker(
        (event) => this.onClickEvent(event),
        typeof this.config.click === 'object' ? this.config.click : {},
      );
      this.clickTracker.start();
    }

    // 初始化热力图采集器
    if (this.config.heatmap !== false) {
      this.heatmapCollector = new HeatmapCollector(
        (points) => this.onHeatmapFlush(points),
        typeof this.config.heatmap === 'object' ? this.config.heatmap : {},
      );
      this.heatmapCollector.start();
    }

    // 初始化用户路径追踪器
    if (this.config.journey !== false) {
      this.journeyTracker = new UserJourneyTracker(
        (step) => this.onJourneyStep(step),
        typeof this.config.journey === 'object' ? this.config.journey : {},
      );
      this.journeyTracker.start();
    }

    // 初始化自定义事件管理器
    if (this.config.customEvents !== false) {
      this.customEventsManager = new CustomEventsManager(
        (events) => this.onCustomEventsFlush(events),
        typeof this.config.customEvents === 'object' ? this.config.customEvents : {},
      );
      this.customEventsManager.start();
    }

    logger.info('[BehaviorPlugin] Installed');
  }

  /**
   * 卸载插件
   */
  uninstall(): void {
    if (this.clickTracker) {
      this.clickTracker.stop();
      this.clickTracker = null;
    }
    if (this.heatmapCollector) {
      this.heatmapCollector.stop();
      this.heatmapCollector = null;
    }
    if (this.journeyTracker) {
      this.journeyTracker.stop();
      this.journeyTracker = null;
    }
    if (this.customEventsManager) {
      this.customEventsManager.stop();
      this.customEventsManager = null;
    }

    this.monitor = null;
    logger.info('[BehaviorPlugin] Uninstalled');
  }

  /**
   * 手动记录自定义行为事件（供业务代码调用）
   */
  trackEvent(name: string, category: string, data?: Record<string, unknown>): void {
    if (this.customEventsManager) {
      this.customEventsManager.track(name, category, data);
    }
  }

  /**
   * 获取用户路径
   */
  getJourney(): JourneyStep[] {
    return this.journeyTracker?.getJourney() ?? [];
  }

  /**
   * 手动记录路由导航（供 SPA 框架集成）
   */
  recordNavigation(): void {
    this.journeyTracker?.recordNavigation();
  }

  // ─── 内部回调 ───

  private onClickEvent(event: ClickEvent): void {
    this.emitBehaviorEvent('click', {
      selector: event.selector,
      x: event.x,
      y: event.y,
      text: event.text,
      tagName: event.tagName,
    });

    // 同时记录到面包屑
    this.monitor?.addBreadcrumb({
      level: 'info',
      category: 'click',
      message: `Click on ${event.selector}`,
      data: { type: 'user', x: event.x, y: event.y, text: event.text },
    });
  }

  private onHeatmapFlush(points: HeatmapPoint[]): void {
    this.emitBehaviorEvent('click', {
      subType: 'heatmap',
      points,
    });
  }

  private onJourneyStep(step: JourneyStep): void {
    this.emitBehaviorEvent('navigation', {
      path: step.path,
      title: step.title,
      duration: step.duration,
      actionCount: step.actionCount,
      referrer: step.referrer,
    });

    // 记录到面包屑
    this.monitor?.addBreadcrumb({
      level: 'info',
      category: 'navigation',
      message: `Navigated to ${step.path}`,
      data: { type: 'navigation', title: step.title, duration: step.duration },
    });
  }

  private onCustomEventsFlush(events: CustomBehaviorEvent[]): void {
    this.emitBehaviorEvent('custom', {
      events,
    });
  }

  /**
   * 通过 Monitor 上报行为事件
   */
  private emitBehaviorEvent(action: string, data: Record<string, unknown>): void {
    if (!this.monitor) return;

    this.monitor.captureEvent({
      type: 'behavior',
      action,
      data,
    } as unknown as Partial<BaseEvent>);
  }
}

// 导出子模块
export { ClickTracker } from './click-tracker';
export type { ClickTrackerConfig, ClickEvent, ClickCallback } from './click-tracker';
export { HeatmapCollector } from './heatmap';
export type { HeatmapConfig, HeatmapPoint, HeatmapFlushCallback } from './heatmap';
export { UserJourneyTracker } from './user-journey';
export type { UserJourneyConfig, JourneyStep, JourneyCallback } from './user-journey';
export { CustomEventsManager } from './custom-events';
export type { CustomEventsConfig, CustomBehaviorEvent, CustomEventsFlushCallback } from './custom-events';
