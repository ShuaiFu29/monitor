import type { BaseEvent } from './event';

/**
 * 性能指标评级
 */
export type MetricRating = 'good' | 'needs-improvement' | 'poor';

/**
 * 性能指标名称
 */
export type MetricName = 'LCP' | 'FID' | 'CLS' | 'TTFB' | 'FCP' | 'INP';

/**
 * 性能指标
 */
export interface PerformanceMetric {
  /** 指标名称 */
  name: MetricName | string;
  /** 指标值 */
  value: number;
  /** 评级 */
  rating?: MetricRating;
  /** 指标 ID */
  id?: string;
  /** 导航条目 */
  navigationType?: string;
}

/**
 * 资源加载时序
 */
export interface ResourceTiming {
  /** 资源 URL */
  url: string;
  /** 资源类型 */
  initiatorType: string;
  /** 开始时间 */
  startTime: number;
  /** 持续时间 */
  duration: number;
  /** 传输大小 */
  transferSize: number;
  /** 解码大小 */
  decodedBodySize: number;
}

/**
 * 长任务
 */
export interface LongTaskEntry {
  /** 开始时间 */
  startTime: number;
  /** 持续时间 */
  duration: number;
  /** 任务来源 */
  attribution?: string;
}

/**
 * 性能事件
 */
export interface PerformanceMonitorEvent extends BaseEvent {
  type: 'performance';
  /** 指标数据 */
  metric: PerformanceMetric;
  /** 指标值 */
  value: number;
  /** 单位 */
  unit: string;
}
