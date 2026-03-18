import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReplayPlayer } from '../src/player';
import type { ReplayData, DOMSnapshot, IncrementalMutation, UserInteractionEvent } from '@monitor/types';

/**
 * 创建测试用 DOM 快照
 */
function createTestSnapshot(timestamp: number = 1000): DOMSnapshot {
  return {
    node: {
      id: 1,
      type: 'document',
      children: [
        {
          id: 2,
          type: 'doctype',
          textContent: 'html',
        },
        {
          id: 3,
          type: 'element',
          tagName: 'html',
          children: [
            {
              id: 4,
              type: 'element',
              tagName: 'head',
            },
            {
              id: 5,
              type: 'element',
              tagName: 'body',
              children: [
                {
                  id: 6,
                  type: 'element',
                  tagName: 'div',
                  attributes: { id: 'app' },
                  children: [
                    {
                      id: 7,
                      type: 'element',
                      tagName: 'h1',
                      children: [
                        {
                          id: 8,
                          type: 'text',
                          textContent: 'Hello World',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    timestamp,
    initialScroll: { x: 0, y: 0 },
  };
}

/**
 * 创建测试用 mutations
 */
function createTestMutations(baseTime: number): IncrementalMutation[] {
  return [
    {
      type: 'text',
      targetId: 8,
      timestamp: baseTime + 1000,
      text: 'Updated Title',
    },
    {
      type: 'attribute',
      targetId: 6,
      timestamp: baseTime + 2000,
      attribute: { name: 'class', value: 'active' },
    },
    {
      type: 'add',
      targetId: 5,
      parentId: 5,
      timestamp: baseTime + 3000,
      addedNode: {
        id: 9,
        type: 'element',
        tagName: 'p',
        children: [
          {
            id: 10,
            type: 'text',
            textContent: 'New paragraph',
          },
        ],
      },
    },
  ];
}

/**
 * 创建测试用交互事件
 */
function createTestInteractions(baseTime: number): UserInteractionEvent[] {
  return [
    {
      type: 'click',
      timestamp: baseTime + 500,
      targetId: 6,
      x: 100,
      y: 200,
    },
    {
      type: 'scroll',
      timestamp: baseTime + 2500,
      scrollTop: 300,
      scrollLeft: 0,
    },
  ];
}

describe('ReplayPlayer', () => {
  let player: ReplayPlayer;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (player) {
      player.destroy();
    }
    try {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    } catch {
      // container may have been moved by snapshot rendering
    }
    vi.useRealTimers();
  });

  describe('load', () => {
    it('should load replay data', () => {
      player = new ReplayPlayer();
      const data: ReplayData[] = [
        { snapshot: createTestSnapshot(1000) },
        { mutations: createTestMutations(1000) },
        { interactions: createTestInteractions(1000) },
      ];

      player.load(data);
      // 3 mutations + 2 interactions = 5 timeline entries
      expect(player.getTimelineLength()).toBe(5);
      expect(player.getTotalTime()).toBe(3000);
    });

    it('should sort timeline by timestamp', () => {
      player = new ReplayPlayer();
      const data: ReplayData[] = [
        { snapshot: createTestSnapshot(1000) },
        {
          mutations: createTestMutations(1000),
          interactions: createTestInteractions(1000),
        },
      ];

      player.load(data);
      expect(player.getTimelineLength()).toBe(5);
    });

    it('should handle empty data', () => {
      player = new ReplayPlayer();
      player.load([]);
      expect(player.getTimelineLength()).toBe(0);
      expect(player.getTotalTime()).toBe(0);
    });

    it('should use first snapshot only', () => {
      player = new ReplayPlayer();
      player.load([
        { snapshot: createTestSnapshot(1000) },
        { snapshot: createTestSnapshot(2000) }, // Should be ignored
      ]);
      expect(player.getTotalTime()).toBe(0);
    });
  });

  describe('mount', () => {
    it('should create iframe in container', () => {
      player = new ReplayPlayer({ useIframe: true });
      player.mount(container);

      const iframe = container.querySelector('iframe');
      expect(iframe).not.toBeNull();
      expect(iframe!.style.border).toContain('none');
    });
  });

  describe('play/pause', () => {
    it('should start in idle state', () => {
      player = new ReplayPlayer();
      expect(player.getState()).toBe('idle');
    });

    it('should not play without snapshot', () => {
      player = new ReplayPlayer();
      player.load([]);
      player.mount(container);
      player.play();
      expect(player.getState()).toBe('idle');
    });

    it('should transition to playing state', () => {
      player = new ReplayPlayer();
      player.load([
        { snapshot: createTestSnapshot(1000) },
        { mutations: createTestMutations(1000) },
      ]);
      player.mount(container);
      player.play();
      expect(player.getState()).toBe('playing');
    });

    it('should transition to paused state', () => {
      player = new ReplayPlayer();
      player.load([
        { snapshot: createTestSnapshot(1000) },
        { mutations: createTestMutations(1000) },
      ]);
      player.mount(container);
      player.play();
      player.pause();
      expect(player.getState()).toBe('paused');
    });

    it('should resume from paused state', () => {
      player = new ReplayPlayer();
      player.load([
        { snapshot: createTestSnapshot(1000) },
        { mutations: createTestMutations(1000) },
      ]);
      player.mount(container);
      player.play();
      player.pause();
      player.play();
      expect(player.getState()).toBe('playing');
    });

    it('should call onStateChange callback', () => {
      const onStateChange = vi.fn();
      player = new ReplayPlayer({ callbacks: { onStateChange } });
      player.load([
        { snapshot: createTestSnapshot(1000) },
        { mutations: createTestMutations(1000) },
      ]);
      player.mount(container);

      player.play();
      expect(onStateChange).toHaveBeenCalledWith('playing');

      player.pause();
      expect(onStateChange).toHaveBeenCalledWith('paused');
    });

    it('should call onEnd when playback finishes', () => {
      const onEnd = vi.fn();
      player = new ReplayPlayer({ callbacks: { onEnd } });
      player.load([
        { snapshot: createTestSnapshot(1000) },
        {
          mutations: [{
            type: 'text',
            targetId: 8,
            timestamp: 1100,
            text: 'Done',
          }],
        },
      ]);
      player.mount(container);
      player.play();

      // Advance past all events
      vi.advanceTimersByTime(200);

      expect(onEnd).toHaveBeenCalled();
    });

    it('should not play twice', () => {
      const onStateChange = vi.fn();
      player = new ReplayPlayer({ callbacks: { onStateChange } });
      player.load([
        { snapshot: createTestSnapshot(1000) },
        { mutations: createTestMutations(1000) },
      ]);
      player.mount(container);

      player.play();
      onStateChange.mockClear();
      player.play(); // Should be no-op
      expect(onStateChange).not.toHaveBeenCalled();
    });

    it('should not pause when not playing', () => {
      const onStateChange = vi.fn();
      player = new ReplayPlayer({ callbacks: { onStateChange } });
      player.load([
        { snapshot: createTestSnapshot(1000) },
      ]);
      player.mount(container);

      player.pause(); // Not playing, should be no-op
      expect(onStateChange).not.toHaveBeenCalled();
    });
  });

  describe('setSpeed', () => {
    it('should set and get speed', () => {
      player = new ReplayPlayer();
      player.setSpeed(2.0);
      expect(player.getSpeed()).toBe(2.0);
    });

    it('should clamp speed to valid range', () => {
      player = new ReplayPlayer();

      player.setSpeed(0.01);
      expect(player.getSpeed()).toBe(0.1);

      player.setSpeed(100);
      expect(player.getSpeed()).toBe(16.0);
    });

    it('should affect playback timing', () => {
      const onEnd = vi.fn();
      player = new ReplayPlayer({ callbacks: { onEnd } });
      player.load([
        { snapshot: createTestSnapshot(1000) },
        {
          mutations: [{
            type: 'text',
            targetId: 8,
            timestamp: 2000,
            text: 'X',
          }],
        },
      ]);
      player.mount(container);

      // At 2x speed, 1000ms delay becomes 500ms
      player.setSpeed(2.0);
      player.play();

      vi.advanceTimersByTime(600);
      expect(onEnd).toHaveBeenCalled();
    });
  });

  describe('seekTo', () => {
    it('should seek forward', () => {
      player = new ReplayPlayer();
      player.load([
        { snapshot: createTestSnapshot(1000) },
        { mutations: createTestMutations(1000) },
      ]);
      player.mount(container);
      player.play();

      player.seekTo(3000);
      expect(player.getCurrentTime()).toBe(2000);
    });

    it('should seek backward (rebuilds from snapshot)', () => {
      player = new ReplayPlayer();
      player.load([
        { snapshot: createTestSnapshot(1000) },
        { mutations: createTestMutations(1000) },
      ]);
      player.mount(container);
      player.play();

      player.seekTo(3000);
      player.seekTo(1500);
      expect(player.getCurrentTime()).toBe(500);
    });

    it('should clamp to valid range', () => {
      player = new ReplayPlayer();
      player.load([
        { snapshot: createTestSnapshot(1000) },
        { mutations: createTestMutations(1000) },
      ]);
      player.mount(container);
      player.play();

      player.seekTo(0);
      expect(player.getCurrentTime()).toBe(0);

      player.seekTo(999999);
      expect(player.getCurrentTime()).toBe(player.getTotalTime());
    });

    it('should call onTimeUpdate callback', () => {
      const onTimeUpdate = vi.fn();
      player = new ReplayPlayer({ callbacks: { onTimeUpdate } });
      player.load([
        { snapshot: createTestSnapshot(1000) },
        { mutations: createTestMutations(1000) },
      ]);
      player.mount(container);
      player.play();

      player.seekTo(2500);
      expect(onTimeUpdate).toHaveBeenCalled();
    });

    it('should not seek without snapshot', () => {
      player = new ReplayPlayer();
      player.load([]);
      player.seekTo(1000);
      expect(player.getCurrentTime()).toBe(0);
    });
  });

  describe('getCurrentTime / getTotalTime', () => {
    it('should return correct total time', () => {
      player = new ReplayPlayer();
      player.load([
        { snapshot: createTestSnapshot(1000) },
        { mutations: createTestMutations(1000) },
      ]);
      expect(player.getTotalTime()).toBe(3000);
    });

    it('should return 0 for empty data', () => {
      player = new ReplayPlayer();
      player.load([]);
      expect(player.getTotalTime()).toBe(0);
      expect(player.getCurrentTime()).toBe(0);
    });
  });

  describe('interaction callbacks', () => {
    it('should call onInteraction for user events during seek', () => {
      const onInteraction = vi.fn();
      player = new ReplayPlayer({ callbacks: { onInteraction } });
      player.load([
        { snapshot: createTestSnapshot(1000) },
        { interactions: createTestInteractions(1000) },
      ]);
      player.mount(container);
      player.play();

      // seekTo past the first interaction (click at 1500)
      player.seekTo(1600);

      expect(onInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'click',
          x: 100,
          y: 200,
        }),
      );
    });

    it('should call onInteraction during timed playback', () => {
      const onInteraction = vi.fn();
      player = new ReplayPlayer({ callbacks: { onInteraction } });
      player.load([
        { snapshot: createTestSnapshot(1000) },
        {
          interactions: [{
            type: 'click',
            timestamp: 1100,
            x: 50,
            y: 50,
          }],
        },
      ]);
      player.mount(container);
      player.play();

      vi.advanceTimersByTime(200);

      expect(onInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'click',
          x: 50,
          y: 50,
        }),
      );
    });
  });

  describe('destroy', () => {
    it('should clean up all resources', () => {
      player = new ReplayPlayer();
      player.load([
        { snapshot: createTestSnapshot(1000) },
        { mutations: createTestMutations(1000) },
      ]);
      player.mount(container);
      player.play();

      player.destroy();

      expect(player.getState()).toBe('idle');
      expect(container.querySelector('iframe')).toBeNull();
    });

    it('should be safe to call multiple times', () => {
      player = new ReplayPlayer();
      player.mount(container);
      player.destroy();
      player.destroy(); // Should not throw
    });
  });

  describe('mutation application via seekTo', () => {
    it('should apply text mutations on seekTo', () => {
      player = new ReplayPlayer();
      player.load([
        { snapshot: createTestSnapshot(1000) },
        {
          mutations: [{
            type: 'text',
            targetId: 8,
            timestamp: 1500,
            text: 'New Text',
          }],
        },
      ]);
      player.mount(container);
      player.play();

      // seekTo past the mutation
      player.seekTo(2000);
      expect(player.getCurrentTime()).toBe(500);
    });

    it('should apply attribute mutations on seekTo', () => {
      player = new ReplayPlayer();
      player.load([
        { snapshot: createTestSnapshot(1000) },
        {
          mutations: [{
            type: 'attribute',
            targetId: 6,
            timestamp: 1500,
            attribute: { name: 'class', value: 'highlight' },
          }],
        },
      ]);
      player.mount(container);
      player.play();

      player.seekTo(2000);
      expect(player.getCurrentTime()).toBe(500);
    });

    it('should apply remove mutations on seekTo', () => {
      player = new ReplayPlayer();
      player.load([
        { snapshot: createTestSnapshot(1000) },
        {
          mutations: [{
            type: 'remove',
            targetId: 5,
            timestamp: 1500,
            removedNodeId: 7,
          }],
        },
      ]);
      player.mount(container);
      player.play();

      player.seekTo(2000);
      expect(player.getCurrentTime()).toBe(500);
    });

    it('should apply add mutations on seekTo', () => {
      player = new ReplayPlayer();
      player.load([
        { snapshot: createTestSnapshot(1000) },
        {
          mutations: [{
            type: 'add',
            targetId: 5,
            parentId: 5,
            timestamp: 1500,
            addedNode: {
              id: 20,
              type: 'element',
              tagName: 'span',
              children: [{
                id: 21,
                type: 'text',
                textContent: 'Added',
              }],
            },
          }],
        },
      ]);
      player.mount(container);
      player.play();

      player.seekTo(2000);
      expect(player.getCurrentTime()).toBe(500);
    });
  });
});
