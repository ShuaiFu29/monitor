import type { MetricName, MetricRating, PerformanceMetric } from '@monitor/types';
import { generateId } from '@monitor/utils';

/**
 * Web Vitals 采集器
 *
 * 基于 PerformanceObserver API 采集以下核心指标：
 * - LCP (Largest Contentful Paint)
 * - FID (First Input Delay) — 逐步被 INP 取代
 * - INP (Interaction to Next Paint)
 * - CLS (Cumulative Layout Shift)
 * - TTFB (Time to First Byte)
 * - FCP (First Contentful Paint)
 *
 * 每个指标采集后会自动计算 rating（good / needs-improvement / poor），
 * 阈值参照 Google 官方标准：https://web.dev/vitals/
 */

// ── 阈值定义 ──
// [good, needs-improvement] 边界，超过后为 poor
const THRESHOLDS: Record<string, [number, number]> = {
  LCP:  [2500, 4000],     // ms
  FID:  [100, 300],       // ms
  INP:  [200, 500],       // ms
  CLS:  [0.1, 0.25],      // unitless (score)
  TTFB: [800, 1800],      // ms
  FCP:  [1800, 3000],     // ms
};

/**
 * 根据值和阈值计算评级
 */
export function getRating(name: string, value: number): MetricRating {
  const threshold = THRESHOLDS[name];
  if (!threshold) return 'good';

  if (value <= threshold[0]) return 'good';
  if (value <= threshold[1]) return 'needs-improvement';
  return 'poor';
}

// ── 回调类型 ──
export type MetricCallback = (metric: PerformanceMetric) => void;

/**
 * 安全创建 PerformanceObserver
 * 如果浏览器不支持指定 entryType，不抛出错误
 */
function tryObserve(
  entryType: string,
  callback: (entries: PerformanceEntryList) => void,
  options?: { buffered?: boolean },
): PerformanceObserver | null {
  if (typeof PerformanceObserver === 'undefined') return null;

  try {
    // 检查是否支持此 entryType
    const supportedTypes = PerformanceObserver.supportedEntryTypes;
    if (supportedTypes && !supportedTypes.includes(entryType)) {
      return null;
    }

    const observer = new PerformanceObserver((list) => {
      callback(list.getEntries());
    });

    observer.observe({
      type: entryType,
      buffered: options?.buffered ?? true,
    } as PerformanceObserverInit);

    return observer;
  } catch {
    return null;
  }
}

// ── 各指标采集函数 ──

/**
 * 采集 LCP (Largest Contentful Paint)
 *
 * LCP 会多次触发（随着更大元素渲染），最后一次值为最终 LCP。
 * 在 visibilitychange → hidden 或 input 时报告最终值。
 */
export function observeLCP(callback: MetricCallback): (() => void) | null {
  let lastValue = -1;
  let reported = false;

  const report = () => {
    if (reported || lastValue < 0) return;
    reported = true;
    callback({
      name: 'LCP' as MetricName,
      value: lastValue,
      rating: getRating('LCP', lastValue),
      id: generateId(),
      navigationType: getNavigationType(),
    });
  };

  const observer = tryObserve('largest-contentful-paint', (entries) => {
    const lastEntry = entries[entries.length - 1];
    if (lastEntry) {
      lastValue = lastEntry.startTime;
    }
  });

  if (!observer) return null;

  // LCP 在用户交互或页面隐藏时确定最终值
  const stopListeners = onHiddenOrInput(report);

  return () => {
    report();
    observer.disconnect();
    stopListeners();
  };
}

/**
 * 采集 FID (First Input Delay)
 *
 * 只捕获第一次用户交互的延迟。
 */
export function observeFID(callback: MetricCallback): (() => void) | null {
  let reported = false;

  const observer = tryObserve('first-input', (entries) => {
    if (reported) return;
    const entry = entries[0] as PerformanceEventTiming | undefined;
    if (!entry) return;

    reported = true;
    const value = entry.processingStart - entry.startTime;
    callback({
      name: 'FID' as MetricName,
      value,
      rating: getRating('FID', value),
      id: generateId(),
      navigationType: getNavigationType(),
    });
  });

  if (!observer) return null;

  return () => {
    observer.disconnect();
  };
}

/**
 * 采集 INP (Interaction to Next Paint)
 *
 * 取所有交互中延迟的 P98 值（交互次数 < 50 时取最大值）。
 */
export function observeINP(callback: MetricCallback): (() => void) | null {
  const interactions: number[] = [];
  let reported = false;

  const report = () => {
    if (reported || interactions.length === 0) return;
    reported = true;

    // P98: 排序后取第 98 百分位
    const sorted = [...interactions].sort((a, b) => a - b);
    const p98Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.98) - 1);
    const value = sorted[p98Index];

    callback({
      name: 'INP' as MetricName,
      value,
      rating: getRating('INP', value),
      id: generateId(),
      navigationType: getNavigationType(),
    });
  };

  const observer = tryObserve('event', (entries) => {
    for (const entry of entries) {
      const eventEntry = entry as PerformanceEventTiming;
      // 只记录有 interactionId 的交互（过滤掉 mousemove 等连续事件）
      if (eventEntry.interactionId && eventEntry.interactionId > 0) {
        interactions.push(eventEntry.duration);
      }
    }
  }, { buffered: true });

  if (!observer) return null;

  const stopListeners = onHidden(report);

  return () => {
    report();
    observer.disconnect();
    stopListeners();
  };
}

/**
 * 采集 CLS (Cumulative Layout Shift)
 *
 * 使用 session window 方式计算：
 * - 一组连续的布局偏移构成一个 session window
 * - session window 之间间隔 > 1s 或 window 持续 > 5s 时结束
 * - 最终 CLS 取所有 session window 中值最大的那个
 */
export function observeCLS(callback: MetricCallback): (() => void) | null {
  let maxSessionValue = 0;
  let currentSessionValue = 0;
  let currentSessionStart = -1;
  let lastEntryTime = 0;
  let reported = false;

  const report = () => {
    if (reported) return;
    reported = true;
    const value = maxSessionValue;
    callback({
      name: 'CLS' as MetricName,
      value,
      rating: getRating('CLS', value),
      id: generateId(),
      navigationType: getNavigationType(),
    });
  };

  const observer = tryObserve('layout-shift', (entries) => {
    for (const entry of entries) {
      const lsEntry = entry as LayoutShiftEntry;
      // 只考虑非用户输入触发的偏移
      if (lsEntry.hadRecentInput) continue;

      // 判断是否属于当前 session window
      if (
        currentSessionStart < 0 ||
        entry.startTime - lastEntryTime > 1000 ||
        entry.startTime - currentSessionStart > 5000
      ) {
        // 新 session window
        currentSessionStart = entry.startTime;
        currentSessionValue = 0;
      }

      currentSessionValue += lsEntry.value;
      lastEntryTime = entry.startTime;

      if (currentSessionValue > maxSessionValue) {
        maxSessionValue = currentSessionValue;
      }
    }
  });

  if (!observer) return null;

  const stopListeners = onHidden(report);

  return () => {
    report();
    observer.disconnect();
    stopListeners();
  };
}

/**
 * 采集 TTFB (Time to First Byte)
 *
 * 基于 Navigation Timing API。
 */
export function observeTTFB(callback: MetricCallback): (() => void) | null {
  const observer = tryObserve('navigation', (entries) => {
    const navEntry = entries[0] as PerformanceNavigationTiming | undefined;
    if (!navEntry) return;

    const value = navEntry.responseStart - navEntry.requestStart;
    // 过滤无效值
    if (value < 0) return;

    callback({
      name: 'TTFB' as MetricName,
      value,
      rating: getRating('TTFB', value),
      id: generateId(),
      navigationType: getNavigationType(),
    });
  });

  if (!observer) return null;

  return () => {
    observer.disconnect();
  };
}

/**
 * 采集 FCP (First Contentful Paint)
 *
 * 基于 paint timing API。
 */
export function observeFCP(callback: MetricCallback): (() => void) | null {
  const observer = tryObserve('paint', (entries) => {
    for (const entry of entries) {
      if (entry.name === 'first-contentful-paint') {
        const value = entry.startTime;
        callback({
          name: 'FCP' as MetricName,
          value,
          rating: getRating('FCP', value),
          id: generateId(),
          navigationType: getNavigationType(),
        });
        break;
      }
    }
  });

  if (!observer) return null;

  return () => {
    observer.disconnect();
  };
}

// ── 辅助函数 ──

/**
 * 获取导航类型
 */
function getNavigationType(): string {
  if (typeof performance === 'undefined') return 'unknown';
  const nav = performance.getEntriesByType?.('navigation')?.[0] as PerformanceNavigationTiming | undefined;
  return nav?.type || 'navigate';
}

/**
 * 页面隐藏时触发回调
 */
function onHidden(callback: () => void): () => void {
  const handler = () => {
    if (document.visibilityState === 'hidden') {
      callback();
    }
  };
  document.addEventListener('visibilitychange', handler, { once: true });

  return () => {
    document.removeEventListener('visibilitychange', handler);
  };
}

/**
 * 页面隐藏或用户首次交互时触发回调（用于 LCP 确定）
 */
function onHiddenOrInput(callback: () => void): () => void {
  let called = false;
  const callOnce = () => {
    if (called) return;
    called = true;
    callback();
  };

  const hiddenStop = onHidden(callOnce);

  // 任何用户交互都会结束 LCP 观察
  const inputEvents = ['keydown', 'click', 'pointerdown'] as const;
  const handlers: Array<() => void> = [];

  for (const eventType of inputEvents) {
    const handler = () => callOnce();
    document.addEventListener(eventType, handler, { once: true, capture: true });
    handlers.push(() => document.removeEventListener(eventType, handler, { capture: true }));
  }

  return () => {
    hiddenStop();
    handlers.forEach((h) => h());
  };
}

// ── PerformanceEventTiming 类型补充 ──
// happy-dom / TypeScript 默认类型中可能缺失
interface PerformanceEventTiming extends PerformanceEntry {
  processingStart: number;
  processingEnd: number;
  duration: number;
  interactionId?: number;
}

interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}
