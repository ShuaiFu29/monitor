// ── 基础类型 ──
export type {
  EventType,
  EventLevel,
  BaseEvent,
  CustomEvent,
  MonitorEvent,
} from './event';

// ── 配置 ──
export type { MonitorConfig, ResolvedConfig } from './config';

// ── 错误相关 ──
export type {
  StackFrame,
  Breadcrumb,
  ErrorSubType,
  ErrorEvent,
} from './error';

// ── 性能相关 ──
export type {
  MetricRating,
  MetricName,
  PerformanceMetric,
  ResourceTiming,
  LongTaskEntry,
  PerformanceMonitorEvent,
} from './performance';

// ── 网络相关 ──
export type { NetworkEvent } from './network';

// ── 回放相关 ──
export type {
  SerializedNodeType,
  SerializedNode,
  DOMSnapshot,
  MutationType,
  IncrementalMutation,
  UserInteractionType,
  UserInteractionEvent,
  ReplayData,
  ReplayEvent,
  SanitizeConfig,
} from './replay';

// ── 用户行为 ──
export type { BehaviorAction, BehaviorEvent } from './behavior';

// ── 上报相关 ──
export type {
  TransportStrategy,
  TransportResult,
  TransportConfig,
  StoredEvent,
} from './transport';

// ── 插件 ──
export type { Plugin } from './plugin';

// ── 监控器接口 ──
export type { MonitorInterface, EventBusInterface } from './monitor';

// ── 用户 ──
export type { UserInfo } from './user';
