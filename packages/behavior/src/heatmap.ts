import { logger } from '@monitor/utils';

/**
 * 热力图数据点
 */
export interface HeatmapPoint {
  /** 点击坐标（相对文档） */
  x: number;
  y: number;
  /** 目标元素选择器 */
  selector: string;
  /** 页面 URL 路径 */
  path: string;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 热力图采集器配置
 */
export interface HeatmapConfig {
  /** 最大数据点缓冲数量，默认 500 */
  maxPoints?: number;
  /** flush 间隔 (ms)，默认 10000 */
  flushInterval?: number;
  /** 点击去重间隔 (ms)，同一位置在此时间内只记录一次，默认 100 */
  dedupeInterval?: number;
}

export type HeatmapFlushCallback = (points: HeatmapPoint[]) => void;

/**
 * HeatmapCollector — 热力图数据采集
 *
 * 功能：
 * 1. 记录用户点击位置（文档坐标 + 元素选择器）
 * 2. 缓冲数据点，定时批量 flush
 * 3. 重复点击位置去重
 * 4. 每个数据点关联当前页面路径
 */
export class HeatmapCollector {
  private callback: HeatmapFlushCallback;
  private config: Required<HeatmapConfig>;
  private buffer: HeatmapPoint[] = [];
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private flushTimerId: ReturnType<typeof setInterval> | null = null;
  private lastPoint: { x: number; y: number; time: number } | null = null;
  private started = false;

  constructor(callback: HeatmapFlushCallback, config: HeatmapConfig = {}) {
    this.callback = callback;
    this.config = {
      maxPoints: config.maxPoints ?? 500,
      flushInterval: config.flushInterval ?? 10000,
      dedupeInterval: config.dedupeInterval ?? 100,
    };
  }

  /**
   * 开始采集
   */
  start(): void {
    if (this.started) return;

    this.clickHandler = (e: MouseEvent) => this.handleClick(e);
    document.addEventListener('click', this.clickHandler, true);

    this.flushTimerId = setInterval(() => this.flush(), this.config.flushInterval);

    this.started = true;
    logger.info('[HeatmapCollector] Started');
  }

  /**
   * 停止采集
   */
  stop(): void {
    if (!this.started) return;

    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler, true);
      this.clickHandler = null;
    }

    if (this.flushTimerId !== null) {
      clearInterval(this.flushTimerId);
      this.flushTimerId = null;
    }

    this.flush();
    this.started = false;
    logger.info('[HeatmapCollector] Stopped');
  }

  /**
   * 手动 flush
   */
  flush(): void {
    if (this.buffer.length === 0) return;
    const points = this.buffer;
    this.buffer = [];
    this.callback(points);
  }

  /**
   * 获取当前缓冲区大小
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * 是否正在采集
   */
  isCollecting(): boolean {
    return this.started;
  }

  /**
   * 处理点击
   */
  private handleClick(e: MouseEvent): void {
    try {
      const now = Date.now();

      // 去重：同一位置短时间内不重复记录
      if (this.lastPoint) {
        const dx = Math.abs(e.pageX - this.lastPoint.x);
        const dy = Math.abs(e.pageY - this.lastPoint.y);
        const dt = now - this.lastPoint.time;
        if (dx < 5 && dy < 5 && dt < this.config.dedupeInterval) {
          return;
        }
      }

      this.lastPoint = { x: e.pageX, y: e.pageY, time: now };

      const target = e.target as Element;
      const point: HeatmapPoint = {
        x: e.pageX,
        y: e.pageY,
        selector: this.getSimpleSelector(target),
        path: this.getCurrentPath(),
        timestamp: now,
      };

      this.buffer.push(point);

      // 超过缓冲上限时立即 flush
      if (this.buffer.length >= this.config.maxPoints) {
        this.flush();
      }
    } catch (error) {
      logger.error('[HeatmapCollector] Error handling click:', error as Error);
    }
  }

  /**
   * 获取简单选择器
   */
  private getSimpleSelector(element: Element): string {
    if (!element) return '';

    const tagName = element.tagName?.toLowerCase() || '';
    if (element.id) return `${tagName}#${element.id}`;

    const className = element.className;
    if (typeof className === 'string' && className.trim()) {
      return `${tagName}.${className.trim().split(/\s+/)[0]}`;
    }

    return tagName;
  }

  /**
   * 获取当前页面路径
   */
  private getCurrentPath(): string {
    return typeof window !== 'undefined' ? window.location.pathname : '/';
  }
}
