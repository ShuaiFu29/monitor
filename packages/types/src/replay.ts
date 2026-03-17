import type { BaseEvent } from './event';

/**
 * DOM 序列化节点类型
 */
export type SerializedNodeType =
  | 'document'
  | 'doctype'
  | 'element'
  | 'text'
  | 'comment'
  | 'cdata';

/**
 * 序列化后的 DOM 节点
 */
export interface SerializedNode {
  /** 节点唯一 ID */
  id: number;
  /** 节点类型 */
  type: SerializedNodeType;
  /** 标签名（element 类型） */
  tagName?: string;
  /** 属性（element 类型） */
  attributes?: Record<string, string>;
  /** 文本内容（text/comment 类型） */
  textContent?: string;
  /** 子节点 */
  children?: SerializedNode[];
  /** 是否为 SVG */
  isSVG?: boolean;
}

/**
 * DOM 快照
 */
export interface DOMSnapshot {
  /** 根节点 */
  node: SerializedNode;
  /** 时间戳 */
  timestamp: number;
  /** 初始滚动位置 */
  initialScroll?: { x: number; y: number };
}

/**
 * Mutation 记录类型
 */
export type MutationType = 'add' | 'remove' | 'attribute' | 'text' | 'style';

/**
 * 增量 Mutation 记录
 */
export interface IncrementalMutation {
  /** Mutation 类型 */
  type: MutationType;
  /** 目标节点 ID */
  targetId: number;
  /** 时间戳 */
  timestamp: number;
  /** 添加的节点 */
  addedNode?: SerializedNode;
  /** 删除的节点 ID */
  removedNodeId?: number;
  /** 变更的属性 */
  attribute?: { name: string; value: string | null };
  /** 变更的文本 */
  text?: string;
  /** 父节点 ID */
  parentId?: number;
  /** 在哪个兄弟节点之后插入 */
  afterId?: number | null;
}

/**
 * 用户交互事件类型
 */
export type UserInteractionType =
  | 'click'
  | 'dblclick'
  | 'mousemove'
  | 'scroll'
  | 'input'
  | 'focus'
  | 'blur'
  | 'resize'
  | 'touchstart'
  | 'touchmove'
  | 'touchend';

/**
 * 用户交互事件
 */
export interface UserInteractionEvent {
  /** 交互类型 */
  type: UserInteractionType;
  /** 时间戳 */
  timestamp: number;
  /** 目标节点 ID */
  targetId?: number;
  /** 坐标 */
  x?: number;
  y?: number;
  /** 输入值（已脱敏） */
  value?: string;
  /** 滚动位置 */
  scrollTop?: number;
  scrollLeft?: number;
}

/**
 * 录制数据
 */
export interface ReplayData {
  /** DOM 快照 */
  snapshot?: DOMSnapshot;
  /** 增量 Mutation 列表 */
  mutations?: IncrementalMutation[];
  /** 用户交互事件 */
  interactions?: UserInteractionEvent[];
}

/**
 * 回放事件
 */
export interface ReplayEvent extends BaseEvent {
  type: 'replay';
  /** 录制数据 */
  data: ReplayData;
}

/**
 * 隐私脱敏配置
 */
export interface SanitizeConfig {
  /** 是否对所有输入框进行脱敏 */
  maskAllInputs: boolean;
  /** 是否对所有文本进行脱敏 */
  maskAllText: boolean;
  /** 需要屏蔽的选择器列表 */
  blockSelectors: string[];
  /** 需要忽略的选择器列表 */
  ignoreSelectors: string[];
  /** 自定义正则脱敏规则 */
  customPatterns?: Array<{ pattern: RegExp; replacement: string }>;
}
