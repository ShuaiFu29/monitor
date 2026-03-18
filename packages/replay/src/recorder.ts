import type { UserInteractionEvent, UserInteractionType } from '@monitor/types';
import { now } from '@monitor/utils';
import { NodeIdManager } from './snapshot';
import { Sanitizer } from './sanitizer';

/**
 * 事件录制回调类型
 */
export type InteractionCallback = (event: UserInteractionEvent) => void;

/**
 * EventRecorder 配置
 */
export interface EventRecorderConfig {
  /** 鼠标移动节流间隔（ms），默认 50ms */
  mouseMoveThrottle: number;
  /** 滚动事件节流间隔（ms），默认 100ms */
  scrollThrottle: number;
  /** 触摸移动节流间隔（ms），默认 50ms */
  touchMoveThrottle: number;
  /** 是否录制鼠标移动，默认 true */
  recordMouseMove: boolean;
  /** 是否录制触摸事件，默认 true */
  recordTouch: boolean;
}

const DEFAULT_CONFIG: EventRecorderConfig = {
  mouseMoveThrottle: 50,
  scrollThrottle: 100,
  touchMoveThrottle: 50,
  recordMouseMove: true,
  recordTouch: true,
};

/**
 * 节流函数
 */
function createThrottle<T extends (...args: unknown[]) => void>(
  fn: T,
  interval: number,
): T & { cancel: () => void } {
  let lastTime = 0;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const throttled = ((...args: unknown[]) => {
    const currentTime = Date.now();
    const remaining = interval - (currentTime - lastTime);

    if (remaining <= 0) {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      lastTime = currentTime;
      fn(...args);
    } else if (timerId === null) {
      timerId = setTimeout(() => {
        lastTime = Date.now();
        timerId = null;
        fn(...args);
      }, remaining);
    }
  }) as T & { cancel: () => void };

  throttled.cancel = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  return throttled;
}

/**
 * EventRecorder — 用户交互事件录制器
 *
 * 录制用户在页面上的交互行为：
 * - 鼠标：click, dblclick, mousemove
 * - 滚动：scroll
 * - 输入：input, focus, blur
 * - 视口：resize
 * - 触摸：touchstart, touchmove, touchend
 *
 * 高频事件（mousemove, scroll, touchmove）使用节流处理。
 */
export class EventRecorder {
  private callback: InteractionCallback;
  private idManager: NodeIdManager;
  private sanitizer: Sanitizer;
  private config: EventRecorderConfig;
  private listeners: Array<{ target: EventTarget; type: string; handler: EventListener }> = [];
  private active: boolean = false;

  // 节流后的处理函数
  private throttledMouseMove: ((...args: unknown[]) => void) & { cancel: () => void };
  private throttledScroll: ((...args: unknown[]) => void) & { cancel: () => void };
  private throttledTouchMove: ((...args: unknown[]) => void) & { cancel: () => void };

  constructor(
    callback: InteractionCallback,
    idManager: NodeIdManager,
    sanitizer: Sanitizer,
    config: Partial<EventRecorderConfig> = {},
  ) {
    this.callback = callback;
    this.idManager = idManager;
    this.sanitizer = sanitizer;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 创建节流处理函数
    this.throttledMouseMove = createThrottle(
      (...args: unknown[]) => this.handleMouseMove(args[0] as MouseEvent),
      this.config.mouseMoveThrottle,
    );
    this.throttledScroll = createThrottle(
      (...args: unknown[]) => this.handleScroll(args[0] as Event),
      this.config.scrollThrottle,
    );
    this.throttledTouchMove = createThrottle(
      (...args: unknown[]) => this.handleTouchMove(args[0] as TouchEvent),
      this.config.touchMoveThrottle,
    );
  }

  /**
   * 开始录制用户交互事件
   */
  start(target: Document = document): void {
    if (this.active) return;

    // Click
    this.addListener(target, 'click', (e) => this.handleClick(e as MouseEvent));

    // Double Click
    this.addListener(target, 'dblclick', (e) => this.handleDblClick(e as MouseEvent));

    // Mouse Move（节流）
    if (this.config.recordMouseMove) {
      this.addListener(target, 'mousemove', (e) => this.throttledMouseMove(e));
    }

    // Scroll（节流）
    this.addListener(target, 'scroll', (e) => this.throttledScroll(e), true);

    // Input
    this.addListener(target, 'input', (e) => this.handleInput(e as Event));

    // Focus / Blur
    this.addListener(target, 'focus', (e) => this.handleFocus(e as FocusEvent), true);
    this.addListener(target, 'blur', (e) => this.handleBlur(e as FocusEvent), true);

    // Resize（监听 window）
    const win = target.defaultView || window;
    this.addListener(win, 'resize', () => this.handleResize());

    // Touch events
    if (this.config.recordTouch) {
      this.addListener(target, 'touchstart', (e) => this.handleTouchStart(e as TouchEvent));
      this.addListener(target, 'touchmove', (e) => this.throttledTouchMove(e));
      this.addListener(target, 'touchend', (e) => this.handleTouchEnd(e as TouchEvent));
    }

    this.active = true;
  }

  /**
   * 停止录制
   */
  stop(): void {
    if (!this.active) return;

    // 取消节流定时器
    this.throttledMouseMove.cancel();
    this.throttledScroll.cancel();
    this.throttledTouchMove.cancel();

    // 移除所有事件监听
    for (const { target, type, handler } of this.listeners) {
      target.removeEventListener(type, handler, true);
    }
    this.listeners = [];

    this.active = false;
  }

  /**
   * 获取是否正在录制
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * 添加事件监听并跟踪
   */
  private addListener(
    target: EventTarget,
    type: string,
    handler: EventListener,
    capture: boolean = false,
  ): void {
    target.addEventListener(type, handler, capture);
    this.listeners.push({ target, type, handler });
  }

  /**
   * 获取目标元素的节点 ID
   */
  private getTargetId(event: Event): number | undefined {
    const target = event.target;
    if (target && target instanceof Node) {
      // 如果是元素节点或文本节点
      if (target instanceof Element || target.nodeType === Node.TEXT_NODE) {
        return this.idManager.getId(target);
      }
    }
    return undefined;
  }

  /**
   * 处理 click 事件
   */
  private handleClick(e: MouseEvent): void {
    this.callback({
      type: 'click' as UserInteractionType,
      timestamp: now(),
      targetId: this.getTargetId(e),
      x: e.clientX,
      y: e.clientY,
    });
  }

  /**
   * 处理 dblclick 事件
   */
  private handleDblClick(e: MouseEvent): void {
    this.callback({
      type: 'dblclick' as UserInteractionType,
      timestamp: now(),
      targetId: this.getTargetId(e),
      x: e.clientX,
      y: e.clientY,
    });
  }

  /**
   * 处理 mousemove 事件（已节流）
   */
  private handleMouseMove(e: MouseEvent): void {
    this.callback({
      type: 'mousemove' as UserInteractionType,
      timestamp: now(),
      x: e.clientX,
      y: e.clientY,
    });
  }

  /**
   * 处理 scroll 事件（已节流）
   */
  private handleScroll(e: Event): void {
    const target = e.target;
    let scrollTop = 0;
    let scrollLeft = 0;
    let targetId: number | undefined;

    if (target === document || target === document.documentElement) {
      scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
      scrollLeft = document.documentElement.scrollLeft || document.body.scrollLeft;
    } else if (target instanceof Element) {
      scrollTop = target.scrollTop;
      scrollLeft = target.scrollLeft;
      targetId = this.idManager.getId(target);
    }

    this.callback({
      type: 'scroll' as UserInteractionType,
      timestamp: now(),
      targetId,
      scrollTop,
      scrollLeft,
    });
  }

  /**
   * 处理 input 事件
   */
  private handleInput(e: Event): void {
    const target = e.target;
    if (!(target instanceof Element)) return;

    let value = '';
    const tagName = target.tagName.toLowerCase();

    if (tagName === 'input' || tagName === 'textarea') {
      const inputEl = target as HTMLInputElement | HTMLTextAreaElement;
      value = inputEl.value;
    } else if (tagName === 'select') {
      const selectEl = target as HTMLSelectElement;
      value = selectEl.value;
    } else if (target.getAttribute('contenteditable') === 'true') {
      value = target.textContent || '';
    }

    // 脱敏处理
    if (this.sanitizer.shouldMaskInput(target)) {
      value = this.sanitizer.maskInputValue(value);
    } else {
      value = this.sanitizer.sanitizeText(value);
    }

    this.callback({
      type: 'input' as UserInteractionType,
      timestamp: now(),
      targetId: this.getTargetId(e),
      value,
    });
  }

  /**
   * 处理 focus 事件
   */
  private handleFocus(e: FocusEvent): void {
    this.callback({
      type: 'focus' as UserInteractionType,
      timestamp: now(),
      targetId: this.getTargetId(e),
    });
  }

  /**
   * 处理 blur 事件
   */
  private handleBlur(e: FocusEvent): void {
    this.callback({
      type: 'blur' as UserInteractionType,
      timestamp: now(),
      targetId: this.getTargetId(e),
    });
  }

  /**
   * 处理 resize 事件
   */
  private handleResize(): void {
    this.callback({
      type: 'resize' as UserInteractionType,
      timestamp: now(),
      x: window.innerWidth,
      y: window.innerHeight,
    });
  }

  /**
   * 处理 touchstart 事件
   */
  private handleTouchStart(e: TouchEvent): void {
    if (e.touches.length === 0) return;
    const touch = e.touches[0];
    this.callback({
      type: 'touchstart' as UserInteractionType,
      timestamp: now(),
      targetId: this.getTargetId(e),
      x: touch.clientX,
      y: touch.clientY,
    });
  }

  /**
   * 处理 touchmove 事件（已节流）
   */
  private handleTouchMove(e: TouchEvent): void {
    if (e.touches.length === 0) return;
    const touch = e.touches[0];
    this.callback({
      type: 'touchmove' as UserInteractionType,
      timestamp: now(),
      x: touch.clientX,
      y: touch.clientY,
    });
  }

  /**
   * 处理 touchend 事件
   */
  private handleTouchEnd(e: TouchEvent): void {
    const touch = e.changedTouches?.[0];
    this.callback({
      type: 'touchend' as UserInteractionType,
      timestamp: now(),
      targetId: this.getTargetId(e),
      x: touch?.clientX,
      y: touch?.clientY,
    });
  }
}
