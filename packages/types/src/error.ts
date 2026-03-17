import type { BaseEvent, EventLevel } from './event';

/**
 * 堆栈帧
 */
export interface StackFrame {
  /** 文件 URL */
  url: string;
  /** 行号 */
  line: number;
  /** 列号 */
  column: number;
  /** 函数名 */
  function?: string;
  /** 是否已通过 SourceMap 反解 */
  resolved?: boolean;
  /** 原始源文件路径 */
  originalSource?: string;
  /** 原始行号 */
  originalLine?: number;
  /** 原始列号 */
  originalColumn?: number;
  /** 原始函数名 */
  originalFunction?: string;
  /** 源码上下文 */
  context?: {
    pre: string[];
    line: string;
    post: string[];
  };
}

/**
 * 面包屑
 */
export interface Breadcrumb {
  /** 时间戳 */
  timestamp: number;
  /** 描述消息 */
  message: string;
  /** 分类 */
  category: string;
  /** 级别 */
  level: EventLevel;
  /** 附加数据 */
  data?: Record<string, unknown>;
}

/**
 * 错误子类型
 */
export type ErrorSubType = 'js_error' | 'unhandled_rejection' | 'resource_error' | 'console_error';

/**
 * 错误事件
 */
export interface ErrorEvent extends BaseEvent {
  type: 'error';
  /** 错误消息 */
  message: string;
  /** 原始堆栈字符串 */
  stack?: string;
  /** 解析后的堆栈帧 */
  frames: StackFrame[];
  /** 错误指纹 (用于聚合) */
  fingerprint: string;
  /** 错误级别 */
  level: EventLevel;
  /** 错误子类型 */
  subType: ErrorSubType;
  /** 面包屑 */
  breadcrumbs: Breadcrumb[];
  /** 错误名称（如 TypeError） */
  name?: string;
}
