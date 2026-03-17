import type { BaseEvent } from './event';

/**
 * 用户行为动作类型
 */
export type BehaviorAction = 'click' | 'scroll' | 'input' | 'navigation' | 'custom';

/**
 * 用户行为事件
 */
export interface BehaviorEvent extends BaseEvent {
  type: 'behavior';
  /** 行为动作 */
  action: BehaviorAction;
  /** 目标元素选择器 */
  target?: string;
  /** 附加数据 */
  data?: Record<string, unknown>;
}
