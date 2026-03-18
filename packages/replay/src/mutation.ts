import type { IncrementalMutation, MutationType } from '@monitor/types';
import { now } from '@monitor/utils';
import { NodeIdManager, serializeNode } from './snapshot';
import { Sanitizer } from './sanitizer';

/**
 * Mutation 回调类型
 */
export type MutationCallback = (mutations: IncrementalMutation[]) => void;

/**
 * MutationRecorder — MutationObserver 增量录制器
 *
 * 监听 DOM 变化，将 MutationRecord 转换为 IncrementalMutation 结构，
 * 使用 requestAnimationFrame 进行批量合并，减少回调频率。
 *
 * 监听变化类型：
 * - childList: 子节点的添加/删除
 * - attributes: 属性变化
 * - characterData: 文本节点内容变化
 */
export class MutationRecorder {
  private observer: MutationObserver | null = null;
  private pendingMutations: IncrementalMutation[] = [];
  private rafId: number | null = null;
  private callback: MutationCallback;
  private idManager: NodeIdManager;
  private sanitizer: Sanitizer;
  private active: boolean = false;

  constructor(
    callback: MutationCallback,
    idManager: NodeIdManager,
    sanitizer: Sanitizer,
  ) {
    this.callback = callback;
    this.idManager = idManager;
    this.sanitizer = sanitizer;
  }

  /**
   * 开始监听 DOM 变化
   */
  start(target: Node = document): void {
    if (this.active) return;

    this.observer = new MutationObserver((records) => {
      this.processMutationRecords(records);
    });

    this.observer.observe(target, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
      attributeOldValue: true,
      characterDataOldValue: true,
    });

    this.active = true;
  }

  /**
   * 停止监听
   */
  stop(): void {
    if (!this.active) return;

    // 处理 pending 的 mutation records
    if (this.observer) {
      const records = this.observer.takeRecords();
      if (records.length > 0) {
        this.processMutationRecords(records);
      }
      this.observer.disconnect();
      this.observer = null;
    }

    // 立即 flush 缓冲区
    this.flushPending();

    // 取消未执行的 RAF
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.active = false;
  }

  /**
   * 获取是否正在录制
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * 处理 MutationRecord 列表
   * 使用 RAF 进行批量合并
   */
  private processMutationRecords(records: MutationRecord[]): void {
    const timestamp = now();

    for (const record of records) {
      switch (record.type) {
        case 'childList':
          this.processChildListMutation(record, timestamp);
          break;
        case 'attributes':
          this.processAttributeMutation(record, timestamp);
          break;
        case 'characterData':
          this.processCharacterDataMutation(record, timestamp);
          break;
      }
    }

    // 批量合并：通过 RAF 延迟 flush
    this.scheduleFlush();
  }

  /**
   * 处理 childList 类型的 Mutation
   */
  private processChildListMutation(record: MutationRecord, timestamp: number): void {
    const parentId = this.getNodeId(record.target);
    if (parentId === null) return;

    // 处理删除的节点
    record.removedNodes.forEach((removedNode) => {
      // 被忽略的元素不记录
      if (removedNode.nodeType === Node.ELEMENT_NODE) {
        if (this.sanitizer.shouldIgnore(removedNode as Element)) return;
      }

      const removedNodeId = this.idManager.hasId(removedNode)
        ? this.idManager.getId(removedNode)
        : null;

      if (removedNodeId !== null) {
        this.pendingMutations.push({
          type: 'remove' as MutationType,
          targetId: parentId,
          timestamp,
          removedNodeId,
        });
      }
    });

    // 处理添加的节点
    record.addedNodes.forEach((addedNode) => {
      // 跳过 script/noscript
      if (addedNode.nodeType === Node.ELEMENT_NODE) {
        const tagName = (addedNode as Element).tagName.toLowerCase();
        if (tagName === 'script' || tagName === 'noscript') return;
        if (this.sanitizer.shouldIgnore(addedNode as Element)) return;
      }

      const serialized = serializeNode(addedNode, this.idManager, this.sanitizer);
      if (!serialized) return;

      // 确定在哪个兄弟节点之后插入
      let afterId: number | null = null;
      const previousSibling = addedNode.previousSibling;
      if (previousSibling && this.idManager.hasId(previousSibling)) {
        afterId = this.idManager.getId(previousSibling);
      }

      this.pendingMutations.push({
        type: 'add' as MutationType,
        targetId: parentId,
        timestamp,
        addedNode: serialized,
        parentId,
        afterId,
      });
    });
  }

  /**
   * 处理 attributes 类型的 Mutation
   */
  private processAttributeMutation(record: MutationRecord, timestamp: number): void {
    const target = record.target as Element;
    const targetId = this.getNodeId(target);
    if (targetId === null) return;

    // 被忽略的元素不记录
    if (this.sanitizer.shouldIgnore(target)) return;

    const attrName = record.attributeName;
    if (!attrName) return;

    // 跳过事件处理器属性
    if (attrName.startsWith('on')) return;

    const newValue = target.getAttribute(attrName);

    // style 属性变化使用 'style' 类型
    if (attrName === 'style') {
      this.pendingMutations.push({
        type: 'style' as MutationType,
        targetId,
        timestamp,
        attribute: {
          name: attrName,
          value: newValue,
        },
      });
      return;
    }

    const sanitizedValue = newValue !== null
      ? this.sanitizer.sanitizeAttribute(target, attrName, newValue)
      : null;

    this.pendingMutations.push({
      type: 'attribute' as MutationType,
      targetId,
      timestamp,
      attribute: {
        name: attrName,
        value: sanitizedValue,
      },
    });
  }

  /**
   * 处理 characterData 类型的 Mutation
   */
  private processCharacterDataMutation(record: MutationRecord, timestamp: number): void {
    const target = record.target;
    const targetId = this.getNodeId(target);
    if (targetId === null) return;

    const parentElement = target.parentElement;
    const newText = target.textContent || '';
    const sanitizedText = this.sanitizer.sanitizeNodeText(newText, parentElement);

    this.pendingMutations.push({
      type: 'text' as MutationType,
      targetId,
      timestamp,
      text: sanitizedText,
    });
  }

  /**
   * 调度 RAF flush
   */
  private scheduleFlush(): void {
    if (this.rafId !== null) return; // 已经有 RAF 在等待

    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.flushPending();
      });
    } else {
      // 降级：使用 setTimeout
      this.rafId = setTimeout(() => {
        this.rafId = null;
        this.flushPending();
      }, 16) as unknown as number;
    }
  }

  /**
   * 立即发送缓冲区中的 mutations
   */
  private flushPending(): void {
    if (this.pendingMutations.length === 0) return;

    const mutations = this.mergeMutations(this.pendingMutations);
    this.pendingMutations = [];
    this.callback(mutations);
  }

  /**
   * 合并 mutations — 去除冗余
   * 例如：同一属性多次变更只保留最后一次
   */
  private mergeMutations(mutations: IncrementalMutation[]): IncrementalMutation[] {
    // 对 attribute/style/text 类型，同一 targetId + attrName 只保留最后一次
    const attrMap = new Map<string, number>();
    const textMap = new Map<number, number>();
    const keep: boolean[] = new Array(mutations.length).fill(true);

    for (let i = mutations.length - 1; i >= 0; i--) {
      const m = mutations[i];

      if ((m.type === 'attribute' || m.type === 'style') && m.attribute) {
        const key = `${m.targetId}:${m.attribute.name}`;
        if (attrMap.has(key)) {
          keep[i] = false; // 该条被后面的覆盖
        } else {
          attrMap.set(key, i);
        }
      } else if (m.type === 'text') {
        if (textMap.has(m.targetId)) {
          keep[i] = false;
        } else {
          textMap.set(m.targetId, i);
        }
      }
    }

    return mutations.filter((_, i) => keep[i]);
  }

  /**
   * 安全获取节点 ID
   */
  private getNodeId(node: Node): number | null {
    try {
      return this.idManager.getId(node);
    } catch {
      return null;
    }
  }
}
