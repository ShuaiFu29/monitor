import type {
  SerializedNode,
  DOMSnapshot,
  IncrementalMutation,
  UserInteractionEvent,
  ReplayData,
} from '@monitor/types';

/**
 * 时间轴事件 — 统一排序的回放条目
 */
interface TimelineEntry {
  timestamp: number;
  type: 'mutation' | 'interaction';
  mutation?: IncrementalMutation;
  interaction?: UserInteractionEvent;
}

/**
 * 播放器状态
 */
export type PlayerState = 'idle' | 'playing' | 'paused';

/**
 * 播放器事件回调
 */
export interface PlayerCallbacks {
  /** 播放状态变化 */
  onStateChange?: (state: PlayerState) => void;
  /** 时间进度更新 */
  onTimeUpdate?: (currentTime: number, totalTime: number) => void;
  /** 播放结束 */
  onEnd?: () => void;
  /** 用户交互事件回放（用于渲染光标等视觉效果） */
  onInteraction?: (event: UserInteractionEvent) => void;
}

/**
 * 播放器配置
 */
export interface PlayerConfig {
  /** 播放速度倍率，默认 1.0 */
  speed: number;
  /** 是否在 iframe 中渲染，默认 true */
  useIframe: boolean;
  /** 回调函数 */
  callbacks: PlayerCallbacks;
}

const DEFAULT_CONFIG: PlayerConfig = {
  speed: 1.0,
  useIframe: true,
  callbacks: {},
};

/**
 * ReplayPlayer — Session Replay 回放引擎
 *
 * 功能：
 * 1. 从 DOM 快照重建页面
 * 2. 按时间顺序应用增量 Mutation
 * 3. 回放用户交互事件（光标移动、点击等）
 * 4. 时间轴控制：播放/暂停/快进/定位
 *
 * 渲染方式：
 * - 使用 iframe 作为沙箱环境渲染回放页面
 * - 防止回放中的 script 执行影响宿主页面
 */
export class ReplayPlayer {
  private config: PlayerConfig;
  private container: HTMLElement | null = null;
  private iframe: HTMLIFrameElement | null = null;

  // 回放数据
  private snapshot: DOMSnapshot | null = null;
  private timeline: TimelineEntry[] = [];
  private startTime: number = 0;
  private endTime: number = 0;

  // 播放状态
  private state: PlayerState = 'idle';
  private currentTime: number = 0;
  private currentIndex: number = 0;
  private speed: number = 1.0;

  // 定时器
  private playTimer: ReturnType<typeof setTimeout> | null = null;
  private progressTimer: ReturnType<typeof setInterval> | null = null;

  // ID → DOM Node 映射（回放文档中的）
  private nodeMap: Map<number, Node> = new Map();

  constructor(config: Partial<PlayerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.speed = this.config.speed;
  }

  /**
   * 加载回放数据
   *
   * @param events - 录制的 ReplayData 列表
   */
  load(events: ReplayData[]): void {
    this.reset();

    // 提取快照和时间线
    for (const event of events) {
      if (event.snapshot && !this.snapshot) {
        this.snapshot = event.snapshot;
        this.startTime = event.snapshot.timestamp;
      }

      if (event.mutations) {
        for (const mutation of event.mutations) {
          this.timeline.push({
            timestamp: mutation.timestamp,
            type: 'mutation',
            mutation,
          });
        }
      }

      if (event.interactions) {
        for (const interaction of event.interactions) {
          this.timeline.push({
            timestamp: interaction.timestamp,
            type: 'interaction',
            interaction,
          });
        }
      }
    }

    // 按时间戳排序
    this.timeline.sort((a, b) => a.timestamp - b.timestamp);

    // 计算结束时间
    if (this.timeline.length > 0) {
      this.endTime = this.timeline[this.timeline.length - 1].timestamp;
    } else if (this.snapshot) {
      this.endTime = this.snapshot.timestamp;
    }
  }

  /**
   * 挂载到 DOM 容器
   */
  mount(container: HTMLElement): void {
    this.container = container;

    if (this.config.useIframe) {
      this.iframe = document.createElement('iframe');
      this.iframe.style.width = '100%';
      this.iframe.style.height = '100%';
      this.iframe.style.border = 'none';
      this.iframe.sandbox.add('allow-same-origin');
      // 不加 allow-scripts，禁止脚本执行
      container.appendChild(this.iframe);
    }
  }

  /**
   * 播放
   */
  play(): void {
    if (this.state === 'playing') return;
    if (!this.snapshot) return;

    if (this.state === 'idle') {
      // 首次播放：渲染快照
      this.renderSnapshot();
      this.currentTime = this.startTime;
      this.currentIndex = 0;
    }

    this.setState('playing');
    this.scheduleNext();
    this.startProgressUpdates();
  }

  /**
   * 暂停
   */
  pause(): void {
    if (this.state !== 'playing') return;
    this.setState('paused');
    this.cancelScheduled();
    this.stopProgressUpdates();
  }

  /**
   * 跳转到指定时间
   *
   * @param timestamp - 目标时间戳
   */
  seekTo(timestamp: number): void {
    if (!this.snapshot) return;

    const clampedTime = Math.max(this.startTime, Math.min(timestamp, this.endTime));

    if (clampedTime < this.currentTime) {
      // 往回跳：需要从快照重新构建
      this.renderSnapshot();
      this.currentIndex = 0;
      this.currentTime = this.startTime;
    }

    // 快进应用到目标时间之前的所有事件
    while (this.currentIndex < this.timeline.length) {
      const entry = this.timeline[this.currentIndex];
      if (entry.timestamp > clampedTime) break;
      this.applyEntry(entry);
      this.currentIndex++;
    }

    this.currentTime = clampedTime;
    this.config.callbacks.onTimeUpdate?.(
      this.currentTime - this.startTime,
      this.getTotalTime(),
    );

    // 如果正在播放，继续
    if (this.state === 'playing') {
      this.cancelScheduled();
      this.scheduleNext();
    }
  }

  /**
   * 设置播放速度
   *
   * @param speed - 播放速度倍率 (0.5, 1.0, 2.0, 4.0, 8.0)
   */
  setSpeed(speed: number): void {
    this.speed = Math.max(0.1, Math.min(speed, 16.0));

    if (this.state === 'playing') {
      // 重新调度
      this.cancelScheduled();
      this.scheduleNext();
    }
  }

  /**
   * 获取当前播放速度
   */
  getSpeed(): number {
    return this.speed;
  }

  /**
   * 获取当前播放状态
   */
  getState(): PlayerState {
    return this.state;
  }

  /**
   * 获取已播放时间（相对时间，ms）
   */
  getCurrentTime(): number {
    return this.currentTime - this.startTime;
  }

  /**
   * 获取总时长（ms）
   */
  getTotalTime(): number {
    return this.endTime - this.startTime;
  }

  /**
   * 获取时间轴条目数量
   */
  getTimelineLength(): number {
    return this.timeline.length;
  }

  /**
   * 销毁播放器
   */
  destroy(): void {
    this.cancelScheduled();
    this.stopProgressUpdates();

    if (this.iframe && this.container) {
      this.container.removeChild(this.iframe);
    }

    this.iframe = null;
    this.container = null;
    this.nodeMap.clear();
    this.timeline = [];
    this.snapshot = null;
    this.setState('idle');
  }

  /**
   * 重置播放器状态（不清除数据）
   */
  private reset(): void {
    this.cancelScheduled();
    this.stopProgressUpdates();
    this.nodeMap.clear();
    this.timeline = [];
    this.snapshot = null;
    this.startTime = 0;
    this.endTime = 0;
    this.currentTime = 0;
    this.currentIndex = 0;
    this.state = 'idle';
  }

  // ─── 渲染引擎 ───

  /**
   * 渲染初始 DOM 快照到 iframe
   */
  private renderSnapshot(): void {
    if (!this.snapshot) return;

    const doc = this.getTargetDocument();
    if (!doc) return;

    // 清空文档
    doc.open();
    doc.close();

    // 从序列化数据重建 DOM
    this.nodeMap.clear();
    this.rebuildNode(this.snapshot.node, doc, doc);

    // 恢复初始滚动位置
    if (this.snapshot.initialScroll) {
      const win = doc.defaultView;
      if (win) {
        win.scrollTo(this.snapshot.initialScroll.x, this.snapshot.initialScroll.y);
      }
    }
  }

  /**
   * 从序列化节点重建真实 DOM 节点
   */
  private rebuildNode(
    serialized: SerializedNode,
    parent: Node,
    doc: Document,
  ): Node | null {
    let node: Node | null = null;

    switch (serialized.type) {
      case 'document': {
        // Document 节点本身就是 parent
        node = doc;
        this.nodeMap.set(serialized.id, node);
        // 重建子节点
        if (serialized.children) {
          for (const child of serialized.children) {
            this.rebuildNode(child, doc, doc);
          }
        }
        return node;
      }

      case 'doctype': {
        const doctype = doc.implementation.createDocumentType(
          serialized.textContent || 'html',
          '',
          '',
        );
        if (doc.doctype) {
          doc.replaceChild(doctype, doc.doctype);
        } else {
          doc.insertBefore(doctype, doc.firstChild);
        }
        node = doctype;
        this.nodeMap.set(serialized.id, node);
        return node;
      }

      case 'element': {
        const tagName = serialized.tagName || 'div';

        // 跳过 blocked content
        if (serialized.attributes?.['class'] === 'monitor-blocked') {
          const blocked = doc.createElement('div');
          blocked.className = 'monitor-blocked';
          blocked.style.cssText = 'background:#ccc;display:flex;align-items:center;justify-content:center;color:#666;';
          blocked.textContent = '[blocked content]';
          parent.appendChild(blocked);
          this.nodeMap.set(serialized.id, blocked);
          return blocked;
        }

        if (serialized.isSVG) {
          node = doc.createElementNS('http://www.w3.org/2000/svg', tagName);
        } else {
          node = doc.createElement(tagName);
        }

        // 设置属性
        if (serialized.attributes) {
          const element = node as Element;
          for (const [name, value] of Object.entries(serialized.attributes)) {
            // 跳过运行时属性标记
            if (name.startsWith('rr_')) continue;
            try {
              element.setAttribute(name, value);
            } catch {
              // 某些属性名可能不合法
            }
          }
        }

        parent.appendChild(node);
        this.nodeMap.set(serialized.id, node);

        // 重建子节点
        if (serialized.children) {
          for (const child of serialized.children) {
            this.rebuildNode(child, node, doc);
          }
        }

        return node;
      }

      case 'text': {
        node = doc.createTextNode(serialized.textContent || '');
        parent.appendChild(node);
        this.nodeMap.set(serialized.id, node);
        return node;
      }

      case 'comment': {
        node = doc.createComment(serialized.textContent || '');
        parent.appendChild(node);
        this.nodeMap.set(serialized.id, node);
        return node;
      }

      default:
        return null;
    }
  }

  // ─── 增量应用 ───

  /**
   * 应用时间轴条目
   */
  private applyEntry(entry: TimelineEntry): void {
    if (entry.type === 'mutation' && entry.mutation) {
      this.applyMutation(entry.mutation);
    } else if (entry.type === 'interaction' && entry.interaction) {
      this.config.callbacks.onInteraction?.(entry.interaction);
    }
  }

  /**
   * 应用单个 Mutation
   */
  private applyMutation(mutation: IncrementalMutation): void {
    const doc = this.getTargetDocument();
    if (!doc) return;

    switch (mutation.type) {
      case 'add': {
        if (!mutation.addedNode || mutation.parentId === undefined) break;
        const parentNode = this.nodeMap.get(mutation.parentId);
        if (!parentNode) break;

        const newNode = this.rebuildNode(mutation.addedNode, parentNode, doc);
        if (!newNode) break;

        // 如果有 afterId，插入到指定位置
        if (mutation.afterId !== undefined && mutation.afterId !== null) {
          const afterNode = this.nodeMap.get(mutation.afterId);
          if (afterNode && afterNode.nextSibling) {
            parentNode.insertBefore(newNode, afterNode.nextSibling);
          }
          // 如果 afterNode 是最后一个，appendChild 已经处理
        }
        break;
      }

      case 'remove': {
        if (mutation.removedNodeId === undefined) break;
        const removedNode = this.nodeMap.get(mutation.removedNodeId);
        if (removedNode?.parentNode) {
          removedNode.parentNode.removeChild(removedNode);
          this.nodeMap.delete(mutation.removedNodeId);
        }
        break;
      }

      case 'attribute':
      case 'style': {
        const targetNode = this.nodeMap.get(mutation.targetId);
        if (!targetNode || !(targetNode instanceof Element)) break;
        if (!mutation.attribute) break;

        if (mutation.attribute.value === null) {
          targetNode.removeAttribute(mutation.attribute.name);
        } else {
          try {
            targetNode.setAttribute(mutation.attribute.name, mutation.attribute.value);
          } catch {
            // 无效属性名
          }
        }
        break;
      }

      case 'text': {
        const textNode = this.nodeMap.get(mutation.targetId);
        if (!textNode) break;
        textNode.textContent = mutation.text ?? '';
        break;
      }
    }
  }

  // ─── 时间轴控制 ───

  /**
   * 调度下一个时间轴事件
   */
  private scheduleNext(): void {
    if (this.state !== 'playing') return;
    if (this.currentIndex >= this.timeline.length) {
      // 播放完毕
      this.setState('idle');
      this.stopProgressUpdates();
      this.config.callbacks.onEnd?.();
      return;
    }

    const nextEntry = this.timeline[this.currentIndex];
    const delay = (nextEntry.timestamp - this.currentTime) / this.speed;
    const safeDelay = Math.max(0, delay);

    this.playTimer = setTimeout(() => {
      if (this.state !== 'playing') return;

      this.applyEntry(nextEntry);
      this.currentTime = nextEntry.timestamp;
      this.currentIndex++;
      this.scheduleNext();
    }, safeDelay);
  }

  /**
   * 取消已调度的事件
   */
  private cancelScheduled(): void {
    if (this.playTimer !== null) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
  }

  /**
   * 启动进度更新定时器
   */
  private startProgressUpdates(): void {
    this.stopProgressUpdates();
    this.progressTimer = setInterval(() => {
      this.config.callbacks.onTimeUpdate?.(
        this.currentTime - this.startTime,
        this.getTotalTime(),
      );
    }, 100);
  }

  /**
   * 停止进度更新定时器
   */
  private stopProgressUpdates(): void {
    if (this.progressTimer !== null) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  /**
   * 设置播放状态并触发回调
   */
  private setState(state: PlayerState): void {
    this.state = state;
    this.config.callbacks.onStateChange?.(state);
  }

  /**
   * 获取目标文档（iframe 内的 document）
   */
  private getTargetDocument(): Document | null {
    if (this.iframe) {
      return this.iframe.contentDocument;
    }
    return document;
  }
}
