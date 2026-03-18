import type {
  Plugin,
  MonitorInterface,
  SanitizeConfig,
  IncrementalMutation,
  UserInteractionEvent,
  ReplayData,
} from '@monitor/types';
import { logger } from '@monitor/utils';
import { Sanitizer } from './sanitizer';
import { NodeIdManager, createSnapshot } from './snapshot';
import { MutationRecorder } from './mutation';
import { EventRecorder } from './recorder';
import type { EventRecorderConfig } from './recorder';
import { ReplayCompressor } from './compressor';
import type { CompressorConfig } from './compressor';

/**
 * ReplayPlugin 配置
 */
export interface ReplayPluginConfig {
  /** 隐私脱敏配置 */
  sanitize?: Partial<SanitizeConfig>;
  /** 事件录制配置 */
  events?: Partial<EventRecorderConfig>;
  /** 压缩配置 */
  compression?: Partial<CompressorConfig>;
  /** 数据 flush 间隔（ms），默认 5000 */
  flushInterval?: number;
  /** 是否在启动时自动开始录制，默认 true */
  autoStart?: boolean;
  /** 最大 mutation 缓冲数量，超过立即 flush，默认 500 */
  maxMutationBuffer?: number;
  /** 最大 interaction 缓冲数量，超过立即 flush，默认 200 */
  maxInteractionBuffer?: number;
}

/**
 * ReplayPlugin — Session Replay 录制插件
 *
 * 功能：
 * 1. 创建页面初始 DOM 快照
 * 2. 通过 MutationObserver 录制 DOM 增量变化
 * 3. 录制用户交互事件（点击、滚动、输入等）
 * 4. 所有数据经过隐私脱敏处理
 * 5. 定期将录制数据通过 Monitor.captureEvent 上报
 *
 * 生命周期：
 * install → start recording → periodic flush → stop recording → uninstall
 */
export class ReplayPlugin implements Plugin {
  readonly name = 'replay';
  readonly version = '0.1.0';

  private monitor: MonitorInterface | null = null;
  private sanitizer: Sanitizer;
  private idManager: NodeIdManager;
  private mutationRecorder: MutationRecorder | null = null;
  private eventRecorder: EventRecorder | null = null;
  private compressor: ReplayCompressor;
  private config: Required<ReplayPluginConfig>;

  // 数据缓冲区
  private mutationBuffer: IncrementalMutation[] = [];
  private interactionBuffer: UserInteractionEvent[] = [];
  private snapshotSent: boolean = false;

  // flush 定时器
  private flushTimerId: ReturnType<typeof setInterval> | null = null;

  private recording: boolean = false;

  constructor(config: ReplayPluginConfig = {}) {
    this.config = {
      sanitize: config.sanitize || {},
      events: config.events || {},
      compression: config.compression || {},
      flushInterval: config.flushInterval ?? 5000,
      autoStart: config.autoStart ?? true,
      maxMutationBuffer: config.maxMutationBuffer ?? 500,
      maxInteractionBuffer: config.maxInteractionBuffer ?? 200,
    };

    this.sanitizer = new Sanitizer(this.config.sanitize);
    this.idManager = new NodeIdManager();
    this.compressor = new ReplayCompressor(this.config.compression);
  }

  /**
   * 安装插件
   */
  install(monitor: MonitorInterface): void {
    this.monitor = monitor;

    logger.info('[ReplayPlugin] Installed');

    if (this.config.autoStart) {
      this.startRecording();
    }
  }

  /**
   * 卸载插件
   */
  uninstall(): void {
    this.stopRecording();
    this.monitor = null;

    logger.info('[ReplayPlugin] Uninstalled');
  }

  /**
   * 开始录制
   */
  startRecording(): void {
    if (this.recording) return;
    if (!this.monitor) return;

    logger.info('[ReplayPlugin] Start recording');

    // 1. 创建初始 DOM 快照
    try {
      const snapshot = createSnapshot(document, this.idManager, this.sanitizer);
      this.emitReplayEvent({ snapshot });
      this.snapshotSent = true;
    } catch (error) {
      logger.error('[ReplayPlugin] Failed to create snapshot:', error as Error);
      return;
    }

    // 2. 启动 MutationObserver 录制
    this.mutationRecorder = new MutationRecorder(
      (mutations) => this.onMutations(mutations),
      this.idManager,
      this.sanitizer,
    );
    this.mutationRecorder.start(document);

    // 3. 启动用户交互事件录制
    this.eventRecorder = new EventRecorder(
      (event) => this.onInteraction(event),
      this.idManager,
      this.sanitizer,
      this.config.events,
    );
    this.eventRecorder.start(document);

    // 4. 启动定时 flush
    this.flushTimerId = setInterval(() => {
      this.flush();
    }, this.config.flushInterval);

    this.recording = true;
  }

  /**
   * 停止录制
   */
  stopRecording(): void {
    if (!this.recording) return;

    logger.info('[ReplayPlugin] Stop recording');

    // 停止 mutation 录制
    if (this.mutationRecorder) {
      this.mutationRecorder.stop();
      this.mutationRecorder = null;
    }

    // 停止事件录制
    if (this.eventRecorder) {
      this.eventRecorder.stop();
      this.eventRecorder = null;
    }

    // 清除 flush 定时器
    if (this.flushTimerId !== null) {
      clearInterval(this.flushTimerId);
      this.flushTimerId = null;
    }

    // 最终 flush
    this.flush();

    // 重置状态
    this.idManager.reset();
    this.snapshotSent = false;
    this.recording = false;
  }

  /**
   * 获取是否正在录制
   */
  isRecording(): boolean {
    return this.recording;
  }

  /**
   * 手动 flush 缓冲区
   */
  flush(): void {
    if (this.mutationBuffer.length === 0 && this.interactionBuffer.length === 0) {
      return;
    }

    const data: ReplayData = {};

    if (this.mutationBuffer.length > 0) {
      data.mutations = this.mutationBuffer;
      this.mutationBuffer = [];
    }

    if (this.interactionBuffer.length > 0) {
      data.interactions = this.interactionBuffer;
      this.interactionBuffer = [];
    }

    this.emitReplayEvent(data);
  }

  /**
   * 获取压缩器实例（用于测试）
   */
  getCompressor(): ReplayCompressor {
    return this.compressor;
  }

  /**
   * Mutation 回调
   */
  private onMutations(mutations: IncrementalMutation[]): void {
    this.mutationBuffer.push(...mutations);

    // 超过缓冲上限时立即 flush
    if (this.mutationBuffer.length >= this.config.maxMutationBuffer) {
      this.flush();
    }
  }

  /**
   * 用户交互事件回调
   */
  private onInteraction(event: UserInteractionEvent): void {
    this.interactionBuffer.push(event);

    // 超过缓冲上限时立即 flush
    if (this.interactionBuffer.length >= this.config.maxInteractionBuffer) {
      this.flush();
    }
  }

  /**
   * 通过 Monitor 上报 replay 事件
   */
  private emitReplayEvent(data: ReplayData): void {
    if (!this.monitor) return;

    this.monitor.captureEvent({
      type: 'replay',
      data,
    } as unknown as Partial<import('@monitor/types').BaseEvent>);
  }
}

// 导出子模块（供高级用户直接使用）
export { Sanitizer } from './sanitizer';
export { NodeIdManager, serializeNode, createSnapshot } from './snapshot';
export { MutationRecorder } from './mutation';
export type { MutationCallback } from './mutation';
export { EventRecorder } from './recorder';
export type { InteractionCallback, EventRecorderConfig } from './recorder';
export { ReplayCompressor } from './compressor';
export type { CompressResult, CompressorConfig } from './compressor';
export { ReplayPlayer } from './player';
export type { PlayerState, PlayerCallbacks, PlayerConfig } from './player';
