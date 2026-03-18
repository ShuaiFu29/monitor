import { logger } from '@monitor/utils';

/**
 * 用户路径步骤
 */
export interface JourneyStep {
  /** 页面路径 */
  path: string;
  /** 页面标题 */
  title: string;
  /** 进入时间戳 */
  enterTime: number;
  /** 停留时长 (ms)，离开时填写 */
  duration: number;
  /** 页面上的操作数量 */
  actionCount: number;
  /** 引用来源 */
  referrer: string;
}

/**
 * 路径追踪器配置
 */
export interface UserJourneyConfig {
  /** 最大步骤数量，默认 50 */
  maxSteps?: number;
  /** hash 变化是否视为导航，默认 true */
  trackHashChange?: boolean;
  /** 是否监听 History API，默认 true */
  trackHistory?: boolean;
}

export type JourneyCallback = (step: JourneyStep) => void;

/**
 * UserJourneyTracker — 用户路径追踪
 *
 * 功能：
 * 1. 通过拦截 History API (pushState/replaceState) 和 popstate 事件追踪路由变化
 * 2. 支持 hash 路由模式 (hashchange)
 * 3. 记录每个页面的停留时长和操作数量
 * 4. 维护一个有限长度的用户路径链
 */
export class UserJourneyTracker {
  private callback: JourneyCallback;
  private config: Required<UserJourneyConfig>;
  private steps: JourneyStep[] = [];
  private currentStep: JourneyStep | null = null;
  private actionCount = 0;
  private started = false;

  /** 当前已知路径（因为某些环境 pushState 不更新 location） */
  private currentPath: string = '';

  // 事件监听器引用
  private popstateHandler: (() => void) | null = null;
  private hashChangeHandler: (() => void) | null = null;
  private clickHandler: (() => void) | null = null;

  // 原始 History API
  private originalPushState: typeof history.pushState | null = null;
  private originalReplaceState: typeof history.replaceState | null = null;

  constructor(callback: JourneyCallback, config: UserJourneyConfig = {}) {
    this.callback = callback;
    this.config = {
      maxSteps: config.maxSteps ?? 50,
      trackHashChange: config.trackHashChange ?? true,
      trackHistory: config.trackHistory ?? true,
    };
  }

  /**
   * 开始追踪
   */
  start(): void {
    if (this.started) return;

    // 记录初始路径
    this.currentPath = this.readLocationPath();

    // 记录初始页面
    this.startNewStep();

    // 监听 popstate（浏览器前进/后退）
    this.popstateHandler = () => this.handleNavigation(this.readLocationPath());
    window.addEventListener('popstate', this.popstateHandler);

    // 监听 hashchange
    if (this.config.trackHashChange) {
      this.hashChangeHandler = () => this.handleNavigation(this.readLocationPath());
      window.addEventListener('hashchange', this.hashChangeHandler);
    }

    // 拦截 History API
    if (this.config.trackHistory) {
      this.patchHistoryAPI();
    }

    // 监听点击操作计数
    this.clickHandler = () => { this.actionCount++; };
    document.addEventListener('click', this.clickHandler, true);

    this.started = true;
    logger.info('[UserJourneyTracker] Started');
  }

  /**
   * 停止追踪
   */
  stop(): void {
    if (!this.started) return;

    // 完成当前步骤
    this.finalizeCurrentStep();

    // 移除事件监听
    if (this.popstateHandler) {
      window.removeEventListener('popstate', this.popstateHandler);
      this.popstateHandler = null;
    }
    if (this.hashChangeHandler) {
      window.removeEventListener('hashchange', this.hashChangeHandler);
      this.hashChangeHandler = null;
    }
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler, true);
      this.clickHandler = null;
    }

    // 恢复 History API
    this.restoreHistoryAPI();

    this.started = false;
    logger.info('[UserJourneyTracker] Stopped');
  }

  /**
   * 获取完整用户路径
   */
  getJourney(): JourneyStep[] {
    return [...this.steps];
  }

  /**
   * 获取路径长度
   */
  getStepCount(): number {
    return this.steps.length;
  }

  /**
   * 获取当前步骤
   */
  getCurrentStep(): JourneyStep | null {
    return this.currentStep ? { ...this.currentStep } : null;
  }

  /**
   * 是否正在追踪
   */
  isTracking(): boolean {
    return this.started;
  }

  /**
   * 手动记录导航（用于框架内路由）
   */
  recordNavigation(path?: string): void {
    this.handleNavigation(path ?? this.readLocationPath());
  }

  /**
   * 处理页面导航
   */
  private handleNavigation(newPath: string): void {
    // 检查路径是否真的变化了
    if (this.currentStep && this.currentPath === newPath) {
      return;
    }

    this.currentPath = newPath;
    this.finalizeCurrentStep();
    this.startNewStep();
  }

  /**
   * 开始新步骤
   */
  private startNewStep(): void {
    const now = Date.now();
    this.actionCount = 0;
    this.currentStep = {
      path: this.currentPath,
      title: typeof document !== 'undefined' ? document.title : '',
      enterTime: now,
      duration: 0,
      actionCount: 0,
      referrer: this.currentStep?.path || (typeof document !== 'undefined' ? document.referrer : ''),
    };
  }

  /**
   * 完成当前步骤
   */
  private finalizeCurrentStep(): void {
    if (!this.currentStep) return;

    const now = Date.now();
    this.currentStep.duration = now - this.currentStep.enterTime;
    this.currentStep.actionCount = this.actionCount;

    this.steps.push(this.currentStep);
    this.callback(this.currentStep);

    // 限制步骤数量
    if (this.steps.length > this.config.maxSteps) {
      this.steps.shift();
    }

    this.currentStep = null;
  }

  /**
   * 拦截 History API
   */
  private patchHistoryAPI(): void {
    if (typeof history === 'undefined') return;

    this.originalPushState = history.pushState.bind(history);
    this.originalReplaceState = history.replaceState.bind(history);

    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      this.originalPushState!(...args);
      // 从 pushState 的第三个参数 (url) 提取路径
      const url = args[2];
      const path = url ? this.extractPath(String(url)) : this.readLocationPath();
      this.handleNavigation(path);
    };

    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      this.originalReplaceState!(...args);
      const url = args[2];
      const path = url ? this.extractPath(String(url)) : this.readLocationPath();
      this.handleNavigation(path);
    };
  }

  /**
   * 恢复 History API
   */
  private restoreHistoryAPI(): void {
    if (this.originalPushState) {
      history.pushState = this.originalPushState;
      this.originalPushState = null;
    }
    if (this.originalReplaceState) {
      history.replaceState = this.originalReplaceState;
      this.originalReplaceState = null;
    }
  }

  /**
   * 从 URL 字符串提取路径部分
   */
  private extractPath(url: string): string {
    // 如果是相对路径（如 '/page2'），直接使用
    if (url.startsWith('/')) {
      return url;
    }
    // 如果是完整 URL，提取 pathname + hash
    try {
      const parsed = new URL(url, window.location.origin);
      return parsed.pathname + parsed.hash;
    } catch {
      return url;
    }
  }

  /**
   * 从 window.location 读取当前路径
   */
  private readLocationPath(): string {
    if (typeof window === 'undefined') return '/';
    return window.location.pathname + window.location.hash;
  }
}
