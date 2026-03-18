import { logger } from '@monitor/utils';

/**
 * 点击事件数据
 */
export interface ClickEvent {
  /** 目标元素选择器 */
  selector: string;
  /** 点击坐标（相对视口） */
  x: number;
  y: number;
  /** 目标元素文本（截断） */
  text: string;
  /** 目标元素标签名 */
  tagName: string;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 点击追踪器配置
 */
export interface ClickTrackerConfig {
  /** 是否记录双击，默认 true */
  trackDoubleClick?: boolean;
  /** 文本截断长度，默认 100 */
  textMaxLength?: number;
  /** 选择器最大深度，默认 5 */
  selectorMaxDepth?: number;
}

export type ClickCallback = (event: ClickEvent) => void;

/**
 * ClickTracker — 用户点击行为追踪
 *
 * 功能：
 * 1. 监听 click 和 dblclick 事件
 * 2. 生成目标元素的 CSS 选择器
 * 3. 提取元素文本（截断处理）
 * 4. 通过回调上报点击事件
 */
export class ClickTracker {
  private callback: ClickCallback;
  private config: Required<ClickTrackerConfig>;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private dblClickHandler: ((e: MouseEvent) => void) | null = null;
  private started = false;

  constructor(callback: ClickCallback, config: ClickTrackerConfig = {}) {
    this.callback = callback;
    this.config = {
      trackDoubleClick: config.trackDoubleClick ?? true,
      textMaxLength: config.textMaxLength ?? 100,
      selectorMaxDepth: config.selectorMaxDepth ?? 5,
    };
  }

  /**
   * 开始监听
   */
  start(): void {
    if (this.started) return;

    this.clickHandler = (e: MouseEvent) => this.handleClick(e);
    document.addEventListener('click', this.clickHandler, true);

    if (this.config.trackDoubleClick) {
      this.dblClickHandler = (e: MouseEvent) => this.handleClick(e);
      document.addEventListener('dblclick', this.dblClickHandler, true);
    }

    this.started = true;
    logger.info('[ClickTracker] Started');
  }

  /**
   * 停止监听
   */
  stop(): void {
    if (!this.started) return;

    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler, true);
      this.clickHandler = null;
    }
    if (this.dblClickHandler) {
      document.removeEventListener('dblclick', this.dblClickHandler, true);
      this.dblClickHandler = null;
    }

    this.started = false;
    logger.info('[ClickTracker] Stopped');
  }

  /**
   * 是否正在监听
   */
  isTracking(): boolean {
    return this.started;
  }

  /**
   * 处理点击事件
   */
  private handleClick(e: MouseEvent): void {
    try {
      const target = e.target as Element;
      if (!target) return;

      const event: ClickEvent = {
        selector: this.getSelector(target),
        x: e.clientX,
        y: e.clientY,
        text: this.getElementText(target),
        tagName: target.tagName?.toLowerCase() || '',
        timestamp: Date.now(),
      };

      this.callback(event);
    } catch (error) {
      logger.error('[ClickTracker] Error handling click:', error as Error);
    }
  }

  /**
   * 为元素生成 CSS 选择器路径
   */
  getSelector(element: Element): string {
    const parts: string[] = [];
    let current: Element | null = element;
    let depth = 0;

    while (current && current !== document.documentElement && depth < this.config.selectorMaxDepth) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector += `#${current.id}`;
        parts.unshift(selector);
        break;
      }

      const className = current.className;
      if (typeof className === 'string' && className.trim()) {
        const classes = className.trim().split(/\s+/).slice(0, 3);
        selector += `.${classes.join('.')}`;
      }

      // 添加 nth-child 用于区分同名兄弟
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (s) => s.tagName === current!.tagName,
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-child(${index})`;
        }
      }

      parts.unshift(selector);
      current = current.parentElement;
      depth++;
    }

    return parts.join(' > ');
  }

  /**
   * 提取元素的文本内容（截断）
   */
  private getElementText(element: Element): string {
    // 优先使用 innerText（用户可见文本）
    const text = (element as HTMLElement).innerText
      || element.textContent
      || (element as HTMLInputElement).value
      || '';
    const trimmed = text.trim().replace(/\s+/g, ' ');

    if (trimmed.length > this.config.textMaxLength) {
      return trimmed.substring(0, this.config.textMaxLength) + '...';
    }
    return trimmed;
  }
}
